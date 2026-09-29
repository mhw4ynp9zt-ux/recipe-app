// POST /api/ai/create-recipe(ログイン必須)
// body: { ingredients: string, mood: string, count: 1|2|3, targets: { protein: 78, veg: 600, ... } }
// → { dishes: [{ name, type, ingredients, steps, protein?, veg?, ... }] }
//
// 管理者が設定したAPIキー・モデルをサーバー側で使ってxAIを呼びます(キーはブラウザに渡りません)。
// アプリ全体の1日の利用上限に達している場合は 429 を返します。
// AIの呼び出しや返答の検証に失敗した場合は、消費した1回分を戻します。

import { getSessionUser, checkOrigin, json } from "../../_lib/session.js";
import { loadAiSettings, reserveUsage, refundUsage } from "../../_lib/app-settings.js";
import { parseCreateRequest, buildPrompt, maxTokensFor, parseDishes } from "../../_lib/recipe-prompt.js";

const AI_TIMEOUT_MS = 60000;

export async function onRequestPost({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) {
    return json({ error: "AIでレシピを作成するにはログインが必要です" }, { status: 401 });
  }
  if (!checkOrigin(request, env)) {
    return json({ error: "不正なリクエストです" }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "リクエストが不正です" }, { status: 400 });
  }

  // 入力チェックは回数を消費する前に行う(不正な入力で1日の枠を減らさない)
  const parsed = parseCreateRequest(body);
  if (parsed.error) return json({ error: parsed.error }, { status: 400 });
  const req = parsed.value;

  const ai = await loadAiSettings(env, { decrypt: true });
  if (!ai.apiKey) {
    return json({ error: "AI機能がまだ設定されていません。管理者に連絡してください" }, { status: 503 });
  }

  const reservation = await reserveUsage(env, ai.dailyLimit);
  if (!reservation.ok) {
    return json({ error: "本日のAI利用回数の上限に達しました。明日またお試しください" }, { status: 429 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + ai.apiKey,
      },
      body: JSON.stringify({
        model: ai.model,
        max_tokens: maxTokensFor(req.count),
        messages: [{ role: "user", content: buildPrompt(req) }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      await refundUsage(env, reservation.day);
      console.error("xAI request failed: status " + res.status);
      if (res.status === 401 || res.status === 403) {
        return json({ error: "AIの設定に問題があります。管理者に連絡してください" }, { status: 503 });
      }
      return json({ error: "レシピの作成に失敗しました。もう一度お試しください" }, { status: 502 });
    }

    const data = await res.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error("no text content in response");

    const dishes = parseDishes(content, req);
    return json({ dishes });
  } catch (e) {
    await refundUsage(env, reservation.day);
    console.error("create-recipe failed: " + (e && e.message));
    return json({ error: "レシピの作成に失敗しました。もう一度お試しください" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
