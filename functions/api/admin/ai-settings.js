// 管理者専用: 外部AI(xAI Grok)の設定
// GET /api/admin/ai-settings → 現在の設定(APIキーはマスク表示のみ)と今日の利用回数
// PUT /api/admin/ai-settings → body: { apiKey?, model?, dailyLimit? } 指定された項目だけ更新
//   apiKey が空・未指定なら、保存済みのキーをそのまま維持します。

import { requireAdmin, json } from "../../_lib/session.js";
import { redact, clip } from "../../_lib/debug-trace.js";
import {
  MAX_DAILY_LIMIT,
  loadAiSettings,
  saveAiSettings,
  getUsedToday,
} from "../../_lib/app-settings.js";

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(env, request);
  if (auth.error) return auth.error;

  // 復号できるか(SETTINGS_ENC_KEYが変わっていないか)の確認のため decrypt: true。キー自体は返さない。
  const settings = await loadAiSettings(env, { decrypt: true });
  const usedToday = await getUsedToday(env);

  return json({
    configured: settings.hasKey && !settings.keyError,
    keyHint: settings.keyHint,
    keyError: settings.keyError,
    encryptionReady: !!env.SETTINGS_ENC_KEY,
    model: settings.model,
    dailyLimit: settings.dailyLimit,
    usedToday,
  });
}

export async function onRequestPut({ request, env }) {
  const auth = await requireAdmin(env, request);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "リクエストが不正です" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return json({ error: "リクエストが不正です" }, { status: 400 });
  }

  const updates = {};

  if (typeof body.apiKey === "string" && body.apiKey.trim()) {
    const apiKey = body.apiKey.trim();
    if (apiKey.length < 8 || apiKey.length > 300 || /\s/.test(apiKey)) {
      return json({ error: "APIキーの形式が正しくありません" }, { status: 400 });
    }
    if (!env.SETTINGS_ENC_KEY) {
      return json({ error: "サーバーに SETTINGS_ENC_KEY が設定されていないため、APIキーを保存できません" }, { status: 500 });
    }
    updates.apiKey = apiKey;
  }

  if (body.model !== undefined) {
    if (typeof body.model !== "string" || !/^[A-Za-z0-9._:\-]{1,80}$/.test(body.model)) {
      return json({ error: "モデル名が正しくありません" }, { status: 400 });
    }
    updates.model = body.model;
  }

  if (body.dailyLimit !== undefined) {
    const limit = Number(body.dailyLimit);
    if (!Number.isInteger(limit) || limit < 0 || limit > MAX_DAILY_LIMIT) {
      return json({ error: `1日の上限は0〜${MAX_DAILY_LIMIT}の整数で入力してください` }, { status: 400 });
    }
    updates.dailyLimit = limit;
  }

  if (!Object.keys(updates).length) {
    return json({ error: "変更する内容がありません" }, { status: 400 });
  }

  try {
    await saveAiSettings(env, updates);
  } catch (e) {
    // 暗号化の失敗・DBエラーなど。管理者専用APIなので、画面の「ログをダウンロード」用に原因(detail)も返す
    console.error("saveAiSettings failed: " + (e && e.message));
    return json({
      error: "設定の保存に失敗しました",
      detail: { name: e && e.name, message: clip(redact(e && e.message, [updates.apiKey]), 500) },
    }, { status: 500 });
  }
  return json({ ok: true });
}
