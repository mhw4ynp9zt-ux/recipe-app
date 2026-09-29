// AI設定(モデル・APIキー・1日の上限)と、1日の利用回数カウントの共通処理。
// APIキーは暗号化してD1(app_settings)に保存し、画面には一切返しません。

import { encryptString, decryptString } from "./crypto.js";

const DEFAULT_AI_MODEL = "grok-4.5";
const DEFAULT_DAILY_LIMIT = 50;
const MAX_DAILY_LIMIT = 10000;

const KEY_MODEL = "ai_model";
const KEY_LIMIT = "ai_daily_limit";
const KEY_API_ENC = "ai_api_key_enc"; // 暗号化したAPIキー
const KEY_API_HINT = "ai_api_key_hint"; // 画面表示用のマスク済み文字列(例: xai-****abcd)

function maskKey(apiKey) {
  return apiKey.length >= 12 ? apiKey.slice(0, 4) + "****" + apiKey.slice(-4) : "****";
}

async function getSettings(env, keys) {
  const placeholders = keys.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM app_settings WHERE key IN (${placeholders})`
  ).bind(...keys).all();
  const map = {};
  results.forEach((row) => { map[row.key] = row.value; });
  return map;
}

// decrypt: true のときだけAPIキーを復号して apiKey に入れる(呼び出し側はサーバー内でのみ使うこと)
async function loadAiSettings(env, { decrypt = false } = {}) {
  const map = await getSettings(env, [KEY_MODEL, KEY_LIMIT, KEY_API_ENC, KEY_API_HINT]);
  const limit = parseInt(map[KEY_LIMIT], 10);
  const result = {
    model: map[KEY_MODEL] || DEFAULT_AI_MODEL,
    dailyLimit: Number.isFinite(limit) && limit >= 0 ? limit : DEFAULT_DAILY_LIMIT,
    hasKey: !!map[KEY_API_ENC],
    keyHint: map[KEY_API_HINT] || "",
    apiKey: null,
    keyError: false,
  };
  if (decrypt && result.hasKey) {
    try {
      result.apiKey = await decryptString(env, map[KEY_API_ENC]);
    } catch (e) {
      result.keyError = true;
      console.error("AI API key could not be decrypted");
    }
  }
  return result;
}

// updates: { apiKey?, model?, dailyLimit? }(指定された項目だけ更新)
async function saveAiSettings(env, updates) {
  const upsert = (key, value) =>
    env.DB.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).bind(key, String(value));

  const statements = [];
  if (updates.apiKey !== undefined) {
    statements.push(upsert(KEY_API_ENC, await encryptString(env, updates.apiKey)));
    statements.push(upsert(KEY_API_HINT, maskKey(updates.apiKey)));
  }
  if (updates.model !== undefined) statements.push(upsert(KEY_MODEL, updates.model));
  if (updates.dailyLimit !== undefined) statements.push(upsert(KEY_LIMIT, updates.dailyLimit));
  if (statements.length) await env.DB.batch(statements);
}

// ==== 1日の利用回数(アプリ全体で共通。日付は日本時間で区切る) ====

function todayJst() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function getUsedToday(env) {
  const row = await env.DB.prepare("SELECT used_count FROM ai_usage_daily WHERE day = ?")
    .bind(todayJst()).first();
  return row ? row.used_count : 0;
}

// 上限に達していなければ1回分を確保する(1つのSQLで判定と加算を同時に行うので、同時アクセスでも上限を超えません)
async function reserveUsage(env, limit) {
  const day = todayJst();
  if (limit <= 0) return { ok: false, day };
  const res = await env.DB.prepare(
    `INSERT INTO ai_usage_daily (day, used_count) VALUES (?, 1)
     ON CONFLICT(day) DO UPDATE SET used_count = used_count + 1 WHERE used_count < ?`
  ).bind(day, limit).run();
  return { ok: !!(res.meta && res.meta.changes > 0), day };
}

// AIの呼び出しに失敗した場合は、確保した1回分を戻す
async function refundUsage(env, day) {
  try {
    await env.DB.prepare(
      "UPDATE ai_usage_daily SET used_count = MAX(used_count - 1, 0) WHERE day = ?"
    ).bind(day).run();
  } catch (e) {
    console.error("refundUsage failed");
  }
}

export {
  DEFAULT_AI_MODEL,
  MAX_DAILY_LIMIT,
  loadAiSettings,
  saveAiSettings,
  getUsedToday,
  reserveUsage,
  refundUsage,
};
