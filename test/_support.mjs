// 写真・共有・取り込みのテスト共通部品。
// 【重要】実際のAI(xAI・有料)も外部サイトも呼びません。
//   ・D1の代わりに、メモリ上のSQLite(node:sqlite)で db/schema.sql を実際に流して使う
//   ・globalThis.fetch を「見張り役」に差し替え、許可していない通信は即エラー、AI(x.ai)への通信は理由つきで即エラー
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function createEnv({ extraSql = [] } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(fs.readFileSync(path.join(root, "db/schema.sql"), "utf8"));
  extraSql.forEach((s) => sqlite.exec(s));
  const wrap = (sql, args) => {
    const st = sqlite.prepare(sql);
    return {
      first: async () => st.get(...args) ?? null,
      all: async () => ({ results: st.all(...args) }),
      run: async () => ({ meta: { changes: Number(st.run(...args).changes) } }),
    };
  };
  const DB = { prepare: (sql) => ({ bind: (...args) => wrap(sql, args), ...wrap(sql, []) }) };
  // AIのキー・設定は一切渡さない(万一AIの経路に入っても動かない)
  return { env: { DB, ORIGIN: "https://recipe.test" }, sqlite };
}

export async function loginAs(env, sqlite, name) {
  const id = "u-" + name;
  sqlite.prepare("INSERT OR IGNORE INTO users (id, username, display_name) VALUES (?, ?, ?)").run(id, name, name);
  const { createSession } = await import("../functions/_lib/session.js");
  const cookie = await createSession(env, id);
  return { id, cookie: cookie.split(";")[0] };
}

export function saveRecipe(sqlite, userId, recipe) {
  sqlite.prepare("INSERT INTO recipes (id, user_id, data) VALUES (?, ?, ?)").run(recipe.id, userId, JSON.stringify(recipe));
}

export async function call(handler, env, { method = "GET", url = "https://recipe.test/x", cookie, body, params = {}, headers = {}, rawBody } = {}) {
  const h = { ...headers };
  if (cookie) h.Cookie = cookie;
  if (body !== undefined || rawBody !== undefined) h["Content-Type"] = "application/json";
  const req = new Request(url, { method, headers: h, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const res = await handler({ request: req, env, params });
  return res;
}

export async function callJson(handler, env, opts) {
  const res = await call(handler, env, opts);
  let data = null;
  try { data = await res.clone().json(); } catch (e) { /* JSONでない応答 */ }
  return { status: res.status, data, res };
}

// ---- 外部通信の見張り役 ----
const realFetch = globalThis.fetch;
export function installFetchGuard(handlers = {}) {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    calls.push(u.toString());
    if (/(^|\.)x\.ai$/i.test(u.hostname) || /chat\/completions/.test(u.pathname)) {
      throw new Error("【課金事故の防止】AI(xAI)への通信が試みられました: " + u);
    }
    const h = handlers[u.hostname];
    if (!h) throw new Error("【想定外の外部通信】許可していない通信が試みられました: " + u);
    return h(u, init);
  };
  return {
    calls,
    restore() { globalThis.fetch = realFetch; },
  };
}

export function makeRunner(title) {
  let passed = 0;
  console.log(title);
  return {
    ok(name) { passed++; console.log("  ✓ " + name); },
    done() { console.log(`\n${passed} 件OK`); },
  };
}

export const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
export const PNG_URL = "data:image/png;base64," + PNG_B64;
export const jpegUrl = (extra = 16) => "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(extra).fill(1)]).toString("base64");
export const webpUrl = () => "data:image/webp;base64," + Buffer.from("RIFF\x10\x00\x00\x00WEBPVP8 ", "latin1").toString("base64");
