// ユーザーごとの月間のAI利用回数(週プラン・写真の栄養計算)。アプリ全体の1日の上限(app-settings.js)とは別に数える。
// このファイルはAIを呼ばない。回数を数えるだけ。上限の判定と加算は1つのSQLで同時に行うので、同時アクセスでも超えない。

export const MONTHLY_CAPS = { week: 12, photo: 40 };

export function monthJst(now = Date.now()) {
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 7);
}

// 確保できたら { ok: true, month }。上限なら { ok: false }
export async function reserveMonthly(env, userId, kind, cap = MONTHLY_CAPS[kind], now = Date.now()) {
  const month = monthJst(now);
  if (!(cap > 0)) return { ok: false, month };
  const res = await env.DB.prepare(
    `INSERT INTO ai_usage_user (user_id, month, kind, used) VALUES (?, ?, ?, 1)
     ON CONFLICT(user_id, month, kind) DO UPDATE SET used = used + 1 WHERE used < ?`
  ).bind(userId, month, kind, cap).run();
  return { ok: !!(res.meta && res.meta.changes > 0), month };
}

export async function refundMonthly(env, userId, kind, month) {
  try {
    await env.DB.prepare("UPDATE ai_usage_user SET used = MAX(used - 1, 0) WHERE user_id = ? AND month = ? AND kind = ?").bind(userId, month, kind).run();
  } catch (e) { console.error("refundMonthly failed"); }
}

export async function usedMonthly(env, userId, kind, now = Date.now()) {
  try {
    const row = await env.DB.prepare("SELECT used FROM ai_usage_user WHERE user_id = ? AND month = ? AND kind = ?").bind(userId, monthJst(now), kind).first();
    return row ? row.used : 0;
  } catch (e) { return 0; }
}
