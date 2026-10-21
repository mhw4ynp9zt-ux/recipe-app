// レシピの取り込み(URL・貼り付けテキスト → 編集シートの下書き)。
// 【重要】AI(xAI・有料)は一切呼びません。取り込みはすべて決まったルールでの文字の読み取りです。
//   ・URL: ページのHTMLを取得し、schema.org の Recipe(JSON-LD)を読む
//   ・テキスト: 「材料」「作り方」の見出しで区切って読む
// 取り込んだ結果は栄養を計算せず、グラム数が読み取れなかった食材は空欄のまま返す(編集シートで利用者が確認・入力する)。
// 外部へ出る通信は fetchPageHtml の「利用者が指定したURLのページの取得」だけで、行き先は検査してから使う。

export const IMPORT_LIMITS = {
  html: 1500000,       // 読み込むHTMLの上限(バイト)
  text: 20000,         // 貼り付けテキストの上限(文字)
  timeoutMs: 8000,
  redirects: 3,
  ingredientRows: 30,
  ingredientName: 40,
  steps: 30,
  step: 300,
  name: 60,
};

export class ImportError extends Error {
  constructor(message, status = 400, code = "bad_request") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ---------- URLの検査(サーバーが内部のアドレスへ接続させられないように) ----------

const BLOCKED_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home", ".corp", ".intranet", ".private"];

export function isBlockedHost(hostname) {
  const h = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h.includes(":") || h.startsWith("[")) return true;                 // IPv6のアドレス
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return true;                       // IPv4のアドレス
  if (/^(0x[0-9a-f]+|\d+)$/i.test(h)) return true;                       // 数字だけ・16進のアドレス表記
  if (!h.includes(".")) return true;                                     // localhost・社内の短い名前
  if (BLOCKED_SUFFIXES.some((s) => h.endsWith(s))) return true;
  return false;
}

// 成功: { ok: true, url: URL }  失敗: { ok: false, error }
export function validateImportUrl(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || s.length > 2000) return { ok: false, error: "URLを入力してください" };
  let url;
  try {
    url = new URL(s);
  } catch (e) {
    return { ok: false, error: "URLの形式が正しくありません" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "http:// か https:// で始まるURLを入力してください" };
  if (url.username || url.password) return { ok: false, error: "このURLは取り込めません" };
  if (url.port) return { ok: false, error: "このURLは取り込めません" };
  if (isBlockedHost(url.hostname)) return { ok: false, error: "このURLは取り込めません" };
  return { ok: true, url };
}

// ---------- ページの取得 ----------

function pickCharset(contentType, headBytes) {
  const m = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType || "");
  if (m) return m[1];
  const head = new TextDecoder("latin1").decode(headBytes.slice(0, 4096));
  const m2 = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head);
  return m2 ? m2[1] : "utf-8";
}

async function readLimited(res, maxBytes) {
  if (!res.body || typeof res.body.getReader !== "function") {
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.length > maxBytes ? buf.slice(0, maxBytes) : buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total >= maxBytes) {
      try { await reader.cancel(); } catch (e) { /* 無視 */ }
      break;
    }
  }
  const out = new Uint8Array(Math.min(total, maxBytes));
  let off = 0;
  for (const c of chunks) {
    const room = out.length - off;
    if (room <= 0) break;
    out.set(c.length > room ? c.subarray(0, room) : c, off);
    off += Math.min(c.length, room);
  }
  return out;
}

// 利用者が指定したページのHTMLを取得する。リダイレクトは、行き先も検査しながら数回まで追う。
// fetchImpl はテストで差し替える(本番は globalThis.fetch)
export async function fetchPageHtml(rawUrl, { fetchImpl = globalThis.fetch } = {}) {
  let current = validateImportUrl(rawUrl);
  if (!current.ok) throw new ImportError(current.error, 400, "bad_url");
  let url = current.url;
  for (let hop = 0; hop <= IMPORT_LIMITS.redirects; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), IMPORT_LIMITS.timeoutMs);
    let res;
    try {
      res = await fetchImpl(url.toString(), {
        method: "GET",
        redirect: "manual",
        signal: ctrl.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; RecipeRouletteImporter/1.0)",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "ja,en;q=0.8",
        },
      });
    } catch (e) {
      clearTimeout(timer);
      throw new ImportError("ページを取得できませんでした。時間をおいてもう一度お試しください", 502, "fetch_failed");
    }
    try {
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new ImportError("ページを取得できませんでした", 502, "fetch_failed");
        let next;
        try { next = new URL(loc, url); } catch (e) { throw new ImportError("ページを取得できませんでした", 502, "fetch_failed"); }
        const v = validateImportUrl(next.toString());
        if (!v.ok) throw new ImportError("このURLは取り込めません", 400, "bad_url");
        url = v.url;
        continue;
      }
      if (!res.ok) throw new ImportError(`ページを取得できませんでした(${res.status})`, 502, "fetch_failed");
      const type = res.headers.get("content-type") || "";
      if (type && !/html|xml/i.test(type)) throw new ImportError("レシピのページ(HTML)ではありません", 422, "not_html");
      const bytes = await readLimited(res, IMPORT_LIMITS.html);
      let html;
      try {
        html = new TextDecoder(pickCharset(type, bytes)).decode(bytes);
      } catch (e) {
        html = new TextDecoder("utf-8").decode(bytes);
      }
      return { html, finalUrl: url.toString() };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new ImportError("リダイレクトが多すぎて取得できませんでした", 502, "fetch_failed");
}

// ---------- 文字の整え ----------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => safeChar(parseInt(h, 16), m))
    .replace(/&#(\d+);/g, (m, d) => safeChar(parseInt(d, 10), m))
    .replace(/&([a-z]+|#39);/gi, (m, n) => (n.toLowerCase() in ENTITIES ? ENTITIES[n.toLowerCase()] : m));
}
function safeChar(code, fallback) {
  try { return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : fallback; } catch (e) { return fallback; }
}
function cleanText(v) {
  if (typeof v !== "string") return "";
  return decodeEntities(v.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|li|div)>/gi, "\n").replace(/<[^>]*>/g, ""))
    .replace(/[ \t 　]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

// ---------- 材料1行の読み取り ----------

const ZERO_WORDS = /(少々|適量|適宜|ひとつまみ|一つまみ|少量|少し|お好みで|好みで|お好み|ちょっと)/;
const UNIT_FACTOR = { kg: 1000, g: 1, グラム: 1, ml: 1, cc: 1, ミリリットル: 1, L: 1000, l: 1000, リットル: 1000 };
const GRAM_RE = /(\d+(?:\.\d+)?(?:\/\d+)?)(?:\s*[~〜～\-ー]\s*(\d+(?:\.\d+)?(?:\/\d+)?))?\s*(kg|グラム|ミリリットル|リットル|ml|cc|g|L)(?![A-Za-z])/i;
const COUNT_RE = /\d+(?:\.\d+)?(?:\/\d+)?\s*(?:と\s*\d+\/\d+\s*)?(?:個|本|枚|切れ|切|片|玉|丁|袋|缶|束|パック|房|株|尾|杯|かけ|パッケージ|合|膳|玉)分?/g;
const SPOON_RE = /(?:大さじ|小さじ|カップ|ｶｯﾌﾟ)\s*\d+(?:\.\d+)?(?:\/\d+)?(?:\s*と\s*\d+\/\d+)?(?:杯)?/g;

function numberOf(tok) {
  if (tok.includes("/")) {
    const [a, b] = tok.split("/").map(Number);
    return b ? a / b : NaN;
  }
  return Number(tok);
}

// 戻り値: { name, grams: 数値|null, line }  材料として読めない行(見出しなど)は null
export function parseIngredientLine(raw) {
  let line = String(raw == null ? "" : raw).normalize("NFKC").replace(/⁄/g, "/").trim();
  if (!line) return null;
  const original = line;
  line = line.replace(/^[・･●○■□▪▶▷◆◇*＊\-–—\s]+/, "").replace(/^[A-D][\s:.、．]+/, "").trim();
  if (!line) return null;
  // 「【A】」「＜調味料＞」のような見出しの行(数字も量の言葉もない短い行)
  if (line.length <= 20 && !/\d/.test(line) && !ZERO_WORDS.test(line) && /^[【\[<＜(（■●▼◆◎]/.test(line) && /[】\]>＞)）:：]$/.test(line)) return null;

  let grams = null;
  let rest = line;
  const m = GRAM_RE.exec(line);
  if (m) {
    const a = numberOf(m[1]);
    const b = m[2] ? numberOf(m[2]) : null;
    const unit = m[3] === "L" ? "L" : m[3].toLowerCase();
    const factor = UNIT_FACTOR[unit] ?? UNIT_FACTOR[m[3]];
    const value = b != null && Number.isFinite(b) ? (a + b) / 2 : a;
    if (Number.isFinite(value) && factor) grams = Math.round(value * factor * 10) / 10;
    rest = line.slice(0, m.index) + " " + line.slice(m.index + m[0].length);
  } else if (ZERO_WORDS.test(line)) {
    grams = 0;
  }
  rest = rest
    .replace(ZERO_WORDS, " ")
    .replace(COUNT_RE, " ")
    .replace(SPOON_RE, " ")
    .replace(/[(（]\s*約?\s*[)）]/g, " ")
    .replace(/約/g, " ")
    .replace(/[:：…・,，、]+\s*$/g, "")
    .replace(/^[:：…・,，、\s]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // 量を取り除いたあとに残る、空の括弧
  rest = rest.replace(/[(（]\s*[)）]/g, "").replace(/\s+/g, " ").trim().replace(/[:：…・,，、]+$/g, "").trim();
  if (!rest) return null;
  return { name: rest.slice(0, IMPORT_LIMITS.ingredientName), grams, line: original.slice(0, 120) };
}

// ---------- 作り方・料理名の整え ----------

function splitLongStep(text, max) {
  if (text.length <= max) return [text];
  const out = [];
  let buf = "";
  text.split(/(?<=[。!!?？])/).forEach((sentence) => {
    if (buf && (buf + sentence).length > max) { out.push(buf); buf = ""; }
    buf += sentence;
    while (buf.length > max) { out.push(buf.slice(0, max)); buf = buf.slice(max); }
  });
  if (buf) out.push(buf);
  return out;
}

function finishDraft({ name, ingredients, steps, sourceUrl }) {
  const warnings = [];
  let ing = ingredients.filter(Boolean);
  if (ing.length > IMPORT_LIMITS.ingredientRows) {
    ing = ing.slice(0, IMPORT_LIMITS.ingredientRows);
    warnings.push(`材料が多いため、先頭の${IMPORT_LIMITS.ingredientRows}行だけを取り込みました`);
  }
  let st = [];
  steps.forEach((s) => { splitLongStep(s, IMPORT_LIMITS.step).forEach((p) => st.push(p)); });
  if (st.length > IMPORT_LIMITS.steps) {
    st = st.slice(0, IMPORT_LIMITS.steps);
    warnings.push(`作り方が多いため、先頭の${IMPORT_LIMITS.steps}ステップだけを取り込みました`);
  }
  const draft = {
    name: (name || "取り込んだレシピ").slice(0, IMPORT_LIMITS.name),
    type: "",
    ingredients: ing,
    steps: st,
  };
  if (sourceUrl) draft.sourceUrl = String(sourceUrl).slice(0, 500);
  return { draft, warnings };
}

// ---------- JSON-LD(schema.org の Recipe)の読み取り ----------

function collectRecipeNodes(node, out, depth) {
  if (depth > 6 || node == null) return;
  if (Array.isArray(node)) { node.forEach((n) => collectRecipeNodes(n, out, depth + 1)); return; }
  if (typeof node !== "object") return;
  const types = [].concat(node["@type"] || []).map((t) => String(t).toLowerCase());
  if (types.includes("recipe")) out.push(node);
  Object.keys(node).forEach((k) => {
    if (k !== "@type" && node[k] && typeof node[k] === "object") collectRecipeNodes(node[k], out, depth + 1);
  });
}

function instructionTexts(v, out) {
  if (v == null) return;
  if (typeof v === "string") {
    cleanText(v).split("\n").map((l) => l.trim()).filter(Boolean).forEach((l) => out.push(l));
    return;
  }
  if (Array.isArray(v)) { v.forEach((x) => instructionTexts(x, out)); return; }
  if (typeof v === "object") {
    if (Array.isArray(v.itemListElement)) { instructionTexts(v.itemListElement, out); return; }
    const t = v.text || v.name;
    if (typeof t === "string") instructionTexts(t, out);
  }
}

export function extractRecipeFromHtml(html, sourceUrl) {
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  const recipes = [];
  let m;
  while ((m = re.exec(html))) {
    const body = m[1].replace(/^\s*<!--/, "").replace(/-->\s*$/, "").replace(/^\s*\/\/\s*<!\[CDATA\[|\/\/\s*\]\]>\s*$/g, "").trim();
    if (!body) continue;
    try {
      collectRecipeNodes(JSON.parse(body), recipes, 0);
    } catch (e) { /* 読めないブロックは飛ばす */ }
  }
  const node = recipes.find((r) => r.recipeIngredient || r.ingredients) || recipes[0];
  if (!node) {
    throw new ImportError("このページからレシピの情報を読み取れませんでした。レシピ本文をコピーして「テキスト」から取り込んでください", 422, "no_recipe");
  }
  const rawIng = [].concat(node.recipeIngredient || node.ingredients || []);
  const ingredients = rawIng
    .map((x) => (typeof x === "string" ? cleanText(x).replace(/\n/g, " ") : ""))
    .filter(Boolean)
    .map(parseIngredientLine);
  const steps = [];
  instructionTexts(node.recipeInstructions, steps);
  const name = cleanText(typeof node.name === "string" ? node.name : "");
  if (!ingredients.some(Boolean) && !steps.length) {
    throw new ImportError("このページからレシピの情報を読み取れませんでした。レシピ本文をコピーして「テキスト」から取り込んでください", 422, "no_recipe");
  }
  return finishDraft({ name, ingredients, steps, sourceUrl });
}

// ---------- 貼り付けテキストの読み取り ----------

const WRAP_EDGE = /^[【\[［<＜(（■●▼◆◎★☆□▪・\s]+|[】\]］>＞)）:：\s]+$/g;
const ING_HEAD = /^(材料|ざいりょう|ingredients?)[】\]］>＞)）:：]*(?:[\s(（].*)?$/i;
const STEP_HEAD = /^(作り方|つくり方|作りかた|手順|作り方・手順|directions?|instructions?|method)[】\]］>＞)）:：]*(?:[\s(（].*)?$/i;
const STOP_HEAD = /^(ポイント|コツ|メモ|備考|アレンジ|栄養|point|memo|note)[】\]］>＞)）:：]*(?:[\s(（].*)?$/i;
const STEP_NUMBER = /^(?:\(?\d+[).．、]\s*|手順\s*\d+\s*[:：]?\s*|step\s*\d+\s*[:：]?\s*|[①-⑳❶-❿]\s*)/i;

export function parseRecipeText(raw, sourceUrl) {
  const text = String(raw == null ? "" : raw)
    .replace(/[①-⑳]/g, (c) => c.charCodeAt(0) - 0x245f + ") ")   // ①②… → 「1) 」(NFKCで数字だけになる前に印を付ける)
    .replace(/[❶-❿]/g, (c) => c.charCodeAt(0) - 0x2775 + ") ")
    .normalize("NFKC").replace(/\r/g, "").slice(0, IMPORT_LIMITS.text);
  const lines = text.split("\n").map((l) => l.trim());
  let mode = "title";
  let name = "";
  let sawIngredients = false;
  const ingredients = [];
  const steps = [];
  for (const line of lines) {
    if (!line) continue;
    if (/^#|^https?:\/\/\S+$/i.test(line)) continue; // ハッシュタグ・URLだけの行
    const core = line.replace(WRAP_EDGE, "");
    if (core.length <= 25 && ING_HEAD.test(core)) { mode = "ing"; sawIngredients = true; continue; }
    if (core.length <= 25 && STEP_HEAD.test(core)) { mode = "step"; continue; }
    if (core.length <= 25 && STOP_HEAD.test(core)) { mode = "stop"; continue; }
    if (mode === "title") {
      if (!name) name = line.replace(/^[【\[［].*?[】\]］]\s*/, "").replace(WRAP_EDGE, "").trim() || core;
    } else if (mode === "ing") {
      ingredients.push(parseIngredientLine(line));
    } else if (mode === "step") {
      const s = line.replace(STEP_NUMBER, "").trim();
      if (s) steps.push(s);
    }
  }
  if (!sawIngredients || !ingredients.some(Boolean)) {
    throw new ImportError("「材料」の見出しと材料の行が見つかりませんでした。【材料】【作り方】のような見出しを付けて貼り付けてください", 422, "no_recipe");
  }
  return finishDraft({ name, ingredients, steps, sourceUrl });
}

// URLからレシピを読み取る(取得 → JSON-LD)。AIは呼ばない
export async function importFromUrl(rawUrl, opts) {
  const { html, finalUrl } = await fetchPageHtml(rawUrl, opts);
  return extractRecipeFromHtml(html, finalUrl);
}
