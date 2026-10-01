// 管理者専用: POST /api/admin/ai-test
// body: { apiKey?: string }
//   apiKey があればそのキーで、なければサーバーに保存済みのキーで xAI の /v1/models を呼びます。
//   → { models: ["grok-...", ...] }
// 呼び出しはサーバーから行うので、保存済みのキーがブラウザに渡ることはありません。
// 失敗時は、画面の「ログをダウンロード」用に detail(xAIの応答本文・例外の内容)も返します。
// この API は管理者専用で、detail からも APIキーは伏せ字にして返します。

import { requireAdmin, json } from "../../_lib/session.js";
import { loadAiSettings } from "../../_lib/app-settings.js";
import { redact, clip } from "../../_lib/debug-trace.js";

export async function onRequestPost({ request, env }) {
  const auth = await requireAdmin(env, request);
  if (auth.error) return auth.error;

  let body = {};
  try {
    body = await request.json();
  } catch (e) { /* bodyなしでも可(保存済みキーでテストする) */ }

  let apiKey = body && typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey) {
    const settings = await loadAiSettings(env, { decrypt: true });
    if (settings.keyError) {
      return json({ error: "保存済みのAPIキーを復号できません。APIキーを再入力して保存してください" }, { status: 400 });
    }
    apiKey = settings.apiKey || "";
  }
  if (!apiKey) {
    return json({ error: "APIキーが未設定です。入力してから接続テストしてください" }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch("https://api.x.ai/v1/models", {
      headers: { Authorization: "Bearer " + apiKey },
      signal: controller.signal,
    });
    if (!res.ok) {
      const message = (res.status === 401 || res.status === 403)
        ? "APIキーが正しくないか、権限がありません"
        : `xAI APIがエラーを返しました(${res.status})`;
      let upstreamBody = "";
      try { upstreamBody = await res.text(); } catch (e) { /* 本文が読めなくても status は返す */ }
      return json({
        error: message,
        detail: { upstreamStatus: res.status, upstreamBody: clip(redact(upstreamBody, [apiKey]), 1000) },
      }, { status: 502 });
    }
    const data = await res.json();
    const models = (data.data || []).map((m) => m.id).filter(Boolean).sort();
    if (!models.length) {
      return json({
        error: "利用できるモデルが見つかりませんでした",
        detail: { upstreamStatus: res.status, upstreamBody: clip(redact(JSON.stringify(data), [apiKey]), 1000) },
      }, { status: 502 });
    }
    return json({ models });
  } catch (e) {
    return json({
      error: "xAI APIに接続できませんでした。時間をおいて再度お試しください",
      detail: { name: e && e.name, message: clip(redact(e && e.message, [apiKey]), 500) },
    }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
