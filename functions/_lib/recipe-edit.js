// レシピの自作・編集: 入力の検査と、レシピの組み立て。AIも外部APIも呼ばない(外部通信をしない)。
import { GENRES, ROLES, MAINS } from "./taxonomy.js";
import { attachNutrition, METRIC_IDS } from "./nutrition.js";
import { getSessionUser, checkOrigin, json } from "./session.js";

export const LIMITS = {
  name: 60,
  type: 20,
  ingredientRows: 30,
  ingredientName: 40,
  food: 100,
  grams: 5000,
  manual: 100000,
  steps: 30,
  step: 300,
};

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export function validateIngredients(raw) {
  const fields = {};
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > LIMITS.ingredientRows) {
    return { ok: false, fields: { ingredients: `食材は1〜${LIMITS.ingredientRows}行で入力してください` } };
  }
  const value = raw.map((row, i) => {
    const r = isObj(row) ? row : {};
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!name || name.length > LIMITS.ingredientName) {
      fields[`ingredients.${i}.name`] = `1〜${LIMITS.ingredientName}文字で入力してください`;
    }
    if (!isNum(r.grams) || r.grams < 0 || r.grams > LIMITS.grams) {
      fields[`ingredients.${i}.grams`] = `0〜${LIMITS.grams}の数値で入力してください`;
    }
    const ing = { name, grams: r.grams };
    // food: AIが付けた成分表風の表記(任意)。照合の手がかりとして使う。空白だけ・null は無いものとして扱う
    if (r.food != null) {
      const food = typeof r.food === "string" ? r.food.trim() : null;
      if (food === null || food.length > LIMITS.food) {
        fields[`ingredients.${i}.food`] = `${LIMITS.food}文字までで入力してください`;
      } else if (food) {
        ing.food = food;
      }
    }
    if (isObj(r.manual)) {
      const manual = {};
      METRIC_IDS.forEach((id) => {
        if (!(id in r.manual)) return;
        const v = r.manual[id];
        if (!isNum(v) || v < 0 || v > LIMITS.manual) {
          fields[`ingredients.${i}.manual.${id}`] = `0〜${LIMITS.manual}の数値で入力してください`;
        } else {
          manual[id] = v;
        }
      });
      if (Object.keys(manual).length > 0) ing.manual = manual;
    }
    return ing;
  });
  return Object.keys(fields).length ? { ok: false, fields } : { ok: true, value };
}

export function validateDraft(raw) {
  const d = isObj(raw) ? raw : {};
  const fields = {};

  const name = typeof d.name === "string" ? d.name.trim() : "";
  if (!name || name.length > LIMITS.name) fields.name = `1〜${LIMITS.name}文字で入力してください`;

  let type = "その他";
  if (d.type != null && typeof d.type !== "string") {
    fields.type = `${LIMITS.type}文字までで入力してください`;
  } else if (typeof d.type === "string" && d.type.trim()) {
    type = d.type.trim();
    if (type.length > LIMITS.type) fields.type = `${LIMITS.type}文字までで入力してください`;
  }

  const ing = validateIngredients(d.ingredients);
  if (!ing.ok) Object.assign(fields, ing.fields);

  // 空のステップは取り除いてから検査する(欄のキーの番号は、送られた配列での位置)
  const rawSteps = Array.isArray(d.steps) ? d.steps : [];
  const steps = [];
  rawSteps.forEach((s, i) => {
    const t = typeof s === "string" ? s.trim() : "";
    if (!t) return;
    if (t.length > LIMITS.step) fields[`steps.${i}`] = `1〜${LIMITS.step}文字で入力してください`;
    steps.push(t);
  });
  if (steps.length < 1 || steps.length > LIMITS.steps) {
    fields.steps = `作り方は1〜${LIMITS.steps}ステップで入力してください`;
  }

  // 系統・役割・主材料(省略可)。未指定・null・空文字・空白だけは「無し」。選択肢にない値・文字列以外はエラー
  const picks = {};
  [["genre", GENRES], ["role", ROLES], ["main", MAINS]].forEach(([key, options]) => {
    const v = d[key];
    if (v == null) return;
    if (typeof v !== "string") { fields[key] = "選択肢から選んでください"; return; }
    const s = v.trim();
    if (!s) return;
    if (options.includes(s)) picks[key] = s;
    else fields[key] = "選択肢から選んでください";
  });

  if (Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, value: { name, type, ingredients: ing.value, steps, ...picks } };
}

// 成分表との照合と栄養計算。入力の行は書き換えない。
export async function calcIngredients(env, ingredients) {
  const pseudo = { ingredientDetails: ingredients.map((ing) => ({ ...ing })) };
  const [dish] = await attachNutrition(env, [pseudo], METRIC_IDS);
  // 手入力が計算に使われなかった行(成分表に照合できた行・グラム0の行)からは manual を外す
  const ingredientDetails = dish.ingredientDetails.map((ing) => {
    if (ing.match && ing.match.manual) return ing;
    const { manual, ...rest } = ing;
    return rest;
  });
  return { ingredientDetails, nutrition: dish.nutrition, nutritionCheck: dish.nutritionCheck };
}

export async function buildRecipe(env, draft, id) {
  const { ingredientDetails: calced, nutrition, nutritionCheck } = await calcIngredients(env, draft.ingredients);
  const ingredientDetails = calced.map((ing) => ({ ...ing, amount: ing.grams > 0 ? `${ing.grams}g` : "" }));
  const recipe = {
    id,
    name: draft.name,
    type: draft.type,
    ingredients: ingredientDetails.map((ing) => (ing.amount ? `${ing.name} ${ing.amount}` : ing.name)),
    ingredientDetails,
    steps: draft.steps,
    nutrition,
    nutritionCheck,
  };
  METRIC_IDS.forEach((m) => { recipe[m] = nutrition[m]; });
  // 系統・役割・主材料は、draft に値があるときだけ入れる
  ["genre", "role", "main"].forEach((k) => { if (draft[k]) recipe[k] = draft[k]; });
  return recipe;
}

// 3つのAPI共通の入口: 401(未ログイン)→ 403(Origin不一致)→ 400(JSON不正)→ 400(検査エラー)。
// 成功なら { user, value }、失敗なら { response } を返す。validate は validateIngredients のように { ok, value | fields } を返す関数。
export async function readEditRequest(request, env, validate, pick = (body) => body) {
  const user = await getSessionUser(env, request);
  if (!user) return { response: json({ error: "ログインが必要です" }, { status: 401 }) };
  if (!checkOrigin(request, env)) return { response: json({ error: "不正なリクエストです" }, { status: 403 }) };
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return { response: json({ error: "リクエストが不正です" }, { status: 400 }) };
  }
  const checked = validate(pick(body));
  if (!checked.ok) {
    return { response: json({ error: "入力内容を確認してください", fields: checked.fields }, { status: 400 }) };
  }
  return { user, value: checked.value };
}
