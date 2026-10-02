// ==== レシピ編集の状態管理(画面には触らない) ====
// 編集シート(js/recipe-edit.js)が使う、下書き・栄養プレビュー・保存の状態を持ちます。
//
//  ・プレビューは AI を使わない calc API(POST /api/recipes/calc)だけを呼びます。
//    入力が止まって CALC_DELAY_MS 後にだけ送り、送るペイロードが同じなら再計算しません。
//  ・計算のたびに連番を増やし、最新の連番の応答だけを反映します(古い応答は捨てる)。
//  ・save は saving 中は何もせず { ok: false, ignored: true } を返します(二重タップ対策)。
//  ・グラム数・手入力は入力欄の文字列のまま持ち、送る直前に数値にします。
//  ・編集では、AIが付けた food(成分表風の表記)と元の名前を行に覚えておき、名前が元のままの間だけ送ります
//    (照合の手がかり。手動の候補選びではない)。名前を変えた行・追加した行には付けません。
//  ・通信・保存の失敗は deps.logError(step, err, extra) に "edit-calc" / "edit-save" で記録します。
//    計算の400(入力の誤り)は記録せず、欄ごとのエラー(fieldErrors)として画面の行に戻します。
//    計算で付けた欄のエラーは、次の計算が始まるか成功したときに消します(保存で付いたエラーには触れません)。
//  ・preview.error は計算の失敗の案内文(失敗していなければ空文字)。
//  ・fetch / setTimeout / clearTimeout は deps から受け取ります(テストで差し替えるため)。

const CALC_DELAY_MS = 800;

function createRecipeEditor(deps) {
  const GENERIC_ERROR = "サーバーでエラーが起きました。しばらくしてからもう一度お試しください";
  const NETWORK_ERROR = "通信に失敗しました。通信環境を確認してもう一度お試しください";
  const LOGIN_ERROR = "ログインが切れました。ログインし直してください";
  const FIELDS_ERROR = "入力内容を確認してください";

  const state = {
    mode: "new",
    recipeId: null,
    draft: { name: "", type: "", genre: "", role: "", main: "", ingredients: [], steps: [] },
    preview: { status: "idle", data: null, forKey: null, error: "" },
    fieldErrors: {},
    saving: false,
    saveError: "",
    dirty: false,
  };
  let initialJson = "";
  let timer = null;
  let seq = 0;
  let lastOk = null; // { key, data }
  let activeKey = null; // 送信中、またはタイマー待ちの計算のキー
  let calcFieldErrors = {}; // 計算の400で付けた欄のエラー(消すときに、保存のエラーと区別するため)

  // 選択肢(config.js の GENRES / ROLES / MAINS)にある文字列だけを返す。それ以外は ""
  // 選択肢(config.js の GENRES / ROLES / MAINS)にある文字列だけを返す。それ以外は ""
  const pickOption = (v, kind) => {
    const list = kind === "genre" ? (typeof GENRES !== "undefined" ? GENRES : null)
      : kind === "role" ? (typeof ROLES !== "undefined" ? ROLES : null)
      : (typeof MAINS !== "undefined" ? MAINS : null);
    return typeof v === "string" && list && list.indexOf(v) >= 0 ? v : "";
  };
  const blankRow = () => ({ name: "", grams: "", manual: {} });
  const isBlank = (s) => typeof s !== "string" || s.replace(/[\s　]/g, "") === "";
  const emit = () => { if (deps.onChange) deps.onChange(state); };
  const log = (step, err, extra) => { try { if (deps.logError) deps.logError(step, err, extra); } catch {} };

  // 画面の行 -> 送る食材。blank 名の行は除く。値が不正なら null。
  // map[送る位置] = 画面の行番号
  function buildIngredients() {
    const out = [];
    const map = [];
    for (let i = 0; i < state.draft.ingredients.length; i++) {
      const row = state.draft.ingredients[i];
      if (isBlank(row.name)) continue;
      if (isBlank(row.grams)) return null;
      const grams = Number(row.grams);
      if (!Number.isFinite(grams)) return null;
      const item = { name: row.name, grams };
      if (row.food && row.name.trim() === String(row.origName).trim()) item.food = row.food;
      const manual = {};
      for (const [id, v] of Object.entries(row.manual || {})) {
        if (isBlank(v)) continue;
        const n = Number(v);
        if (!Number.isFinite(n)) return null;
        manual[id] = n;
      }
      if (Object.keys(manual).length) item.manual = manual;
      out.push(item);
      map.push(i);
    }
    return { ingredients: out, map };
  }

  function updateDirty() {
    state.dirty = JSON.stringify(state.draft) !== initialJson;
  }

  function setPreview(status, data, forKey, error = "") {
    state.preview = { status, data, forKey, error };
  }

  // ingredients.<送った位置>.… を画面の行番号に戻す
  function remapFields(fields, map) {
    const out = {};
    for (const [k, v] of Object.entries(fields)) {
      const m = /^ingredients\.(\d+)(\..*)?$/.exec(k);
      const row = m ? map[Number(m[1])] : undefined;
      out[m && row !== undefined ? `ingredients.${row}${m[2] || ""}` : k] = v;
    }
    return out;
  }

  // 計算で付けた欄のエラーだけを消す(同じ欄に別の文言が入っていれば、それは残す)
  function clearCalcFieldErrors() {
    let fields = null;
    for (const [k, v] of Object.entries(calcFieldErrors)) {
      if (state.fieldErrors[k] !== v) continue;
      if (!fields) fields = { ...state.fieldErrors };
      delete fields[k];
    }
    if (fields) state.fieldErrors = fields;
    calcFieldErrors = {};
  }

  // 入力が変わるたびに呼ぶ。連番を進めて、保留中の応答を無効にする。
  function schedule() {
    const built = buildIngredients();
    const nextKey = built && built.ingredients.length ? JSON.stringify({ ingredients: built.ingredients }) : null;
    if (nextKey && nextKey === activeKey) return; // 同じ内容の計算が送信中かタイマー待ち
    seq++;
    activeKey = null;
    if (timer) { deps.clearTimeout(timer); timer = null; }
    if (!built) { setPreview("invalid", state.preview.data, null); return; }
    if (!built.ingredients.length) { setPreview("idle", state.preview.data, null); return; }
    const key = JSON.stringify({ ingredients: built.ingredients });
    if (lastOk && lastOk.key === key) { clearCalcFieldErrors(); setPreview("ok", lastOk.data, key); return; }
    if (state.preview.status === "error" && state.preview.forKey === key) return;
    setPreview("pending", state.preview.data, null);
    activeKey = key;
    timer = deps.setTimeout(() => { timer = null; runCalc(); }, CALC_DELAY_MS);
  }

  async function runCalc() {
    const built = buildIngredients();
    if (!built || !built.ingredients.length) return;
    const key = JSON.stringify({ ingredients: built.ingredients });
    const mySeq = ++seq;
    activeKey = key;
    clearCalcFieldErrors();
    setPreview("pending", state.preview.data, null);
    emit();
    try {
      const res = await deps.fetch("/api/recipes/calc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: key,
      });
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      if (mySeq !== seq) return;
      activeKey = null;
      if (res.status === 400) {
        // 入力の誤り: 欄ごとのエラーにする(エラーログには残さない)
        if (body && body.fields && typeof body.fields === "object") {
          calcFieldErrors = remapFields(body.fields, built.map);
          state.fieldErrors = { ...state.fieldErrors, ...calcFieldErrors };
        }
        setPreview("error", state.preview.data, key, FIELDS_ERROR);
      } else if (!res.ok || !body || typeof body !== "object") {
        const msg = (body && body.error) || GENERIC_ERROR;
        log("edit-calc", new Error(msg), { status: res.status });
        setPreview("error", state.preview.data, key, res.status === 401 ? LOGIN_ERROR : GENERIC_ERROR);
      } else {
        lastOk = { key, data: body };
        setPreview("ok", body, key);
      }
    } catch (err) {
      if (mySeq !== seq) return;
      activeKey = null;
      log("edit-calc", err, {});
      setPreview("error", state.preview.data, key, NETWORK_ERROR);
    }
    emit();
  }

  // 食材の変更: 栄養プレビューを計算し直す
  function changed() {
    updateDirty();
    schedule();
    emit();
  }
  // 料理名・種類・作り方の変更: プレビューには触らない
  function touched() {
    updateDirty();
    emit();
  }

  function start(opts) {
    if (timer) { deps.clearTimeout(timer); timer = null; }
    seq++;
    activeKey = null;
    lastOk = null;
    state.mode = opts.mode;
    state.fieldErrors = {};
    calcFieldErrors = {};
    state.saving = false;
    state.saveError = "";
    setPreview("idle", null, null);
    if (opts.mode === "edit") {
      const r = opts.recipe;
      state.recipeId = r.id;
      state.draft = {
        name: r.name || "",
        type: r.type || "",
        // 系統・役割・主材料: 選択肢にある値だけ読み込む(範囲外・欠けは ""=未設定・自動)
        genre: pickOption(r.genre, "genre"),
        role: pickOption(r.role, "role"),
        main: pickOption(r.main, "main"),
        ingredients: (r.ingredientDetails || []).map((d) => {
          const manual = {};
          for (const [id, v] of Object.entries(d.manual || {})) manual[id] = String(v);
          const row = { name: d.name || "", grams: d.grams == null ? "" : String(d.grams), manual };
          if (typeof d.food === "string" && d.food.trim()) { row.food = d.food; row.origName = row.name; }
          return row;
        }),
        steps: (r.steps || []).slice(),
      };
      if (!state.draft.ingredients.length) state.draft.ingredients.push(blankRow());
      if (!state.draft.steps.length) state.draft.steps.push("");
    } else {
      state.recipeId = null;
      state.draft = { name: "", type: "", genre: "", role: "", main: "", ingredients: [blankRow()], steps: [""] };
    }
    initialJson = JSON.stringify(state.draft);
    state.dirty = false;
    schedule();
    emit();
  }

  function retryCalc() {
    if (timer) { deps.clearTimeout(timer); timer = null; }
    return runCalc();
  }

  function canSave() {
    const d = state.draft;
    if (state.preview.status !== "ok") return false;
    const built = buildIngredients();
    if (!built || !built.ingredients.length) return false;
    if (state.preview.forKey !== JSON.stringify({ ingredients: built.ingredients })) return false;
    return !isBlank(d.name) && d.steps.some((s) => !isBlank(s));
  }

  async function save(kind) {
    if (state.saving) return { ok: false, ignored: true };
    const built = buildIngredients();
    if (!built || !built.ingredients.length) {
      state.saveError = FIELDS_ERROR;
      emit();
      return { ok: false, error: FIELDS_ERROR };
    }
    state.saving = true;
    state.saveError = "";
    state.fieldErrors = {};
    calcFieldErrors = {};
    emit();
    const overwrite = kind === "overwrite";
    const url = overwrite ? "/api/recipes/" + encodeURIComponent(state.recipeId) : "/api/recipes/custom";
    const payload = {
      name: state.draft.name,
      type: state.draft.type,
      ingredients: built.ingredients,
      steps: state.draft.steps.slice(),
    };
    // 系統・役割・主材料は、空でないものだけ送る
    ["genre", "role", "main"].forEach((k) => { if (state.draft[k]) payload[k] = state.draft[k]; });
    const fail = (result) => {
      state.saveError = result.error || "";
      state.saving = false;
      emit();
      return { ok: false, ...result };
    };
    try {
      const res = await deps.fetch(url, {
        method: overwrite ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      if (res.ok && body && body.recipe) {
        state.saving = false;
        initialJson = JSON.stringify(state.draft);
        state.dirty = false;
        emit();
        return { ok: true, recipe: body.recipe };
      }
      const status = res.status;
      let error = (body && typeof body.error === "string" && body.error) || GENERIC_ERROR;
      if (status === 401) error = LOGIN_ERROR;
      log("edit-save", new Error(error), { status });
      const result = { status, error };
      if (status === 400 && body && body.fields && typeof body.fields === "object") {
        const fields = remapFields(body.fields, built.map);
        result.fields = fields;
        state.fieldErrors = fields;
      }
      if (overwrite && status === 404) result.suggestCopy = true;
      return fail(result);
    } catch (err) {
      log("edit-save", err, {});
      return fail({ error: NETWORK_ERROR });
    }
  }

  const editor = {
    state,
    start,
    retryCalc,
    canSave,
    save,
    setName(s) { state.draft.name = s; touched(); },
    setType(s) { state.draft.type = s; touched(); },
    setGenre(s) { state.draft.genre = s; touched(); },
    setRole(s) { state.draft.role = s; touched(); },
    setMain(s) { state.draft.main = s; touched(); },
    addIngredient() { state.draft.ingredients.push(blankRow()); changed(); },
    updateIngredient(i, patch) {
      const row = state.draft.ingredients[i];
      if (!row) return;
      state.draft.ingredients[i] = { ...row, ...patch };
      changed();
    },
    removeIngredient(i) { state.draft.ingredients.splice(i, 1); changed(); },
    addStep() { state.draft.steps.push(""); touched(); },
    updateStep(i, s) { if (i >= 0 && i < state.draft.steps.length) { state.draft.steps[i] = s; touched(); } },
    removeStep(i) { state.draft.steps.splice(i, 1); touched(); },
  };
  return editor;
}
