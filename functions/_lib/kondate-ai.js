// 週プラン・写真の栄養計算で、外部のAI(xAI)につなぐ【唯一の】ファイル(+ app-settings.js の利用回数)。
// 【課金の注意】ここの callAi を呼ぶと、実際にAIの料金が発生する。テストでは必ず偽物の fetch を渡すこと
//   (test/_support.mjs の見張り役は、x.ai への通信が試みられた時点でテストを失敗させる)。
// 回数の決まり: ユーザーごとの月間の上限(kondate-usage.js)+ アプリ全体の1日の上限(app-settings.js)。失敗したら両方とも戻す。

import { loadAiSettings, reserveUsage, refundUsage } from "./app-settings.js";
import { reserveMonthly, refundMonthly } from "./kondate-usage.js";
import { parseDishes } from "./recipe-prompt.js";
import { loadExcludedFoods, findExcludedHits } from "./excluded-foods.js";
import { loadPersonalNotes } from "./personal-notes.js";

const AI_URL = "https://api.x.ai/v1/chat/completions";
export const AI_TIMEOUT_MS = 90 * 1000;

export function makeAiDeps(env, { fetch: fetchImpl, timeoutMs } = {}) {
  let settings = null;
  const getSettings = async (decrypt) => {
    if (!settings || (decrypt && !settings.apiKey && settings.hasKey && !settings.keyError)) settings = await loadAiSettings(env, { decrypt });
    return settings;
  };
  // messages を1回だけ送る。再試行はしない。返り値: { content } / { status, body }
  const post = async (messages, maxTokens) => {
    const ai = await getSettings(true);
    if (!ai.apiKey) return { status: 503, body: "no-key" };
    const doFetch = fetchImpl || globalThis.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || AI_TIMEOUT_MS);
    try {
      const res = await doFetch(AI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + ai.apiKey },
        body: JSON.stringify({ model: ai.model, max_tokens: maxTokens, messages }),
        signal: controller.signal,
      });
      if (!res.ok) return { status: res.status, body: "" }; // 本文は読まない・残さない(画像やキーが混ざらないように)
      const data = await res.json();
      const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      return content ? { content } : { status: 502, body: "empty" };
    } catch (e) {
      return { status: 504, body: "network" };
    } finally { clearTimeout(timer); }
  };
  return {
    parseDishes,
    loadExcluded: loadExcludedFoods, findExcludedHits, loadNotes: loadPersonalNotes,
    reserveMonthly, refundMonthly,
    reserveGlobal: async (e) => { const ai = await getSettings(false); return reserveUsage(e, ai.dailyLimit); },
    refundGlobal: refundUsage,
    callAi: (prompt, count) => post([{ role: "user", content: prompt }], Math.min(8000, 1800 * count + 800)),
    callVision: (prompt, dataUrl) => post([{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: dataUrl } }] }], 1800),
  };
}
