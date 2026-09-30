// POST /api/ai/create-recipe(ログイン必須)
// body: { ingredients: string, mood: string, count: 1|2|3, targets: { protein: 78, veg: 600, ... } }
//
// 成功時は AI の生成をそのまま流す「ストリーミング」で返します(Content-Type: application/x-ndjson)。
// 1行に1つのJSONイベントが届きます:
//   { "type": "start" }                      AIへの接続が完了した
//   { "type": "thinking" }                   AIが考え中(推論トークンを出している間、約1秒ごと)
//   { "type": "delta", "text": "..." }       レシピ本文(JSON文字列)の続き
//   { "type": "done", "dishes": [...] }      検証済みの最終結果(画面にはこれを使う)
//   { "type": "error", "error": "..." }      途中で失敗した(回数は払い戻し済み)
// AIへ接続する前の失敗(未ログイン・上限到達など)は、従来どおりJSONとHTTPステータスで返します。
//
// 管理者が設定したAPIキー・モデルをサーバー側で使ってxAIを呼びます(キーはブラウザに渡りません)。
// AIの呼び出しや返答の検証に失敗した場合は、消費した1回分を戻します。

import { getSessionUser, checkOrigin, json } from "../../_lib/session.js";
import { loadAiSettings, reserveUsage, refundUsage } from "../../_lib/app-settings.js";
import { parseCreateRequest, buildPrompt, maxTokensFor, parseDishes } from "../../_lib/recipe-prompt.js";

const AI_TIMEOUT_MS = 90000;

// ==== モデルごとの「推論の深さ」 ====
// grok-4.5 / 4.6 は初期値が high(じっくり考える)で、これが待ち時間の一番の原因です。
// レシピ作成には深い推論は不要なので low に下げます(grok-4.5 は low が最小)。
// grok-4.3 は "none"(推論なし)にも対応しているので、最速にしたい場合は "none" に変えてください。
// grok-4.20-*-reasoning / non-reasoning はこの指定を受け付けないので送りません。
// 一覧にないモデルは指定を送らず、xAIの初期値のままにします。
function reasoningEffortFor(model) {
  const m = String(model || "");
  if (/^grok-4\.20/.test(m)) return null;
  if (/^grok-4\.3($|-)/.test(m)) return "low";
  if (/^grok-4\.[56]($|-)/.test(m)) return "low";
  return null;
}

function callXai(ai, req, signal, effort) {
  const body = {
    model: ai.model,
    max_tokens: maxTokensFor(req.count),
    stream: true,
    messages: [{ role: "user", content: buildPrompt(req) }],
  };
  if (effort) body.reasoning_effort = effort;
  return fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + ai.apiKey,
    },
    body: JSON.stringify(body),
    signal,
  });
}

export async function onRequestPost({ request, env, waitUntil }) {
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

  // ---- 1. xAIへ接続(ここまでの失敗は従来どおりJSONで返す) ----
  let res;
  try {
    const effort = reasoningEffortFor(ai.model);
    res = await callXai(ai, req, controller.signal, effort);
    // モデルが reasoning_effort に対応していなかった場合は、指定なしで1回だけやり直す
    if (res.status === 400 && effort) {
      console.error("xAI rejected reasoning_effort for " + ai.model + "; retrying without it");
      res = await callXai(ai, req, controller.signal, null);
    }
  } catch (e) {
    clearTimeout(timer);
    await refundUsage(env, reservation.day);
    console.error("xAI connect failed: " + (e && e.message));
    return json({ error: "レシピの作成に失敗しました。もう一度お試しください" }, { status: 502 });
  }

  if (!res.ok || !res.body) {
    clearTimeout(timer);
    await refundUsage(env, reservation.day);
    console.error("xAI request failed: status " + res.status);
    if (res.status === 401 || res.status === 403) {
      return json({ error: "AIの設定に問題があります。管理者に連絡してください" }, { status: 503 });
    }
    return json({ error: "レシピの作成に失敗しました。もう一度お試しください" }, { status: 502 });
  }

  // ---- 2. 生成中の内容をブラウザへ中継する ----
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = (obj) => writer.write(encoder.encode(JSON.stringify(obj) + "\n"));

  async function pump() {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let lastThinkingAt = 0;
    try {
      await send({ type: "start" });
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let chunk;
          try { chunk = JSON.parse(payload); } catch (e) { continue; }
          const delta = (chunk.choices && chunk.choices[0] && chunk.choices[0].delta) || {};
          if (delta.reasoning_content) {
            // 推論の中身は送らず、「考え中」の合図だけを約1秒ごとに送る
            const now = Date.now();
            if (now - lastThinkingAt > 1000) {
              lastThinkingAt = now;
              await send({ type: "thinking" });
            }
          }
          if (typeof delta.content === "string" && delta.content) {
            content += delta.content;
            await send({ type: "delta", text: delta.content });
          }
        }
      }
      if (!content) throw new Error("no text content in response");
      const dishes = parseDishes(content, req);
      await send({ type: "done", dishes });
    } catch (e) {
      controller.abort();
      await refundUsage(env, reservation.day);
      console.error("create-recipe stream failed: " + (e && e.message));
      try {
        await send({ type: "error", error: "レシピの作成に失敗しました。もう一度お試しください" });
      } catch (e2) { /* ブラウザ側が切断済み */ }
    } finally {
      clearTimeout(timer);
      try { await writer.close(); } catch (e) { /* 切断済み */ }
    }
  }

  const job = pump();
  if (typeof waitUntil === "function") waitUntil(job);

  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // 圧縮による溜め込みを避け、届いた分からすぐ画面に流す
      "Content-Encoding": "identity",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
