// POST /api/ai/create-recipe(ログイン必須)
// body: { ingredients: string, mood: string, count: 1|2|3, targets: { protein: 78, veg: 600, ... } }
// → { dishes: [{ name, type, ingredients, ingredientDetails, steps, nutrition, nutritionCheck, protein?, veg?, ... }], nutritionOk, targetCheck }
//
// 栄養量はAIに答えさせず、AIが返した食材と重さから、日本食品標準成分表(D1の foods テーブル)をもとに計算します。
//   nutrition       … 1品ぶんの { calories, protein, fat, salt, fiber, carbs, veg }
//   nutritionCheck  … 計算に入れられなかった食材 { unmatched, missing }
//   protein など    … 目標に選んだ指標だけ、nutrition と同じ値を入れる(従来の表示と互換)
//   nutritionOk     … 栄養計算に成功したか(成分表のテーブルが無いなどで失敗してもレシピは返す)
//   targetCheck     … 全品の合計が目標の±5%に収まったか { ok, tolerancePct, attempts, results: [{ id, target, total, min, max, diffPct, ok }] }
//                     (栄養計算に失敗したときは入らない)
//
// 計算した合計が目標の±5%に入らないときは、計算結果(食材ごとの内訳つき)をAIに伝えて作り直させます。
// 最大 MAX_ATTEMPTS 回(最初の1回を含む)まで試し、収まらなければ、目標に最も近かった結果を返します。
// 作り直しの呼び出しは、利用回数としては最初の1回にまとめて数えます(ユーザーの操作1回=1回)。
//
// 管理者が設定したAPIキー・モデルをサーバー側で使ってxAIを呼びます(キーはブラウザに渡りません)。
// アプリ全体の1日の利用上限に達している場合は 429 を返します。
// 最初のAI呼び出しや返答の検証に失敗した場合は、消費した1回分を戻します。

import { getSessionUser, checkOrigin, json } from "../../_lib/session.js";
import { loadAiSettings, reserveUsage, refundUsage } from "../../_lib/app-settings.js";
import {
  parseCreateRequest, buildPrompt, buildRetryPrompt, checkTargets, maxTokensFor, parseDishes, TOLERANCE,
} from "../../_lib/recipe-prompt.js";
import { attachNutrition } from "../../_lib/nutrition.js";

const AI_TIMEOUT_MS = 60000;      // AIの1回の呼び出しの上限
const MAX_ATTEMPTS = 3;           // 目標の±5%に収まらないとき、最大で何回まで作る(最初の1回を含む)
const RETRY_START_LIMIT_MS = 50000; // 開始から、これを過ぎていたら作り直しはせず、今ある最良の結果を返す(待ち時間が長くなりすぎないように)

// xAIを1回呼ぶ。成功: { content } / HTTPエラー: { status } / 通信失敗・タイムアウト・空の返答は例外
async function callAi(ai, messages, count) {
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
        max_tokens: maxTokensFor(count),
        messages,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { status: res.status };

    const data = await res.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error("no text content in response");
    return { content };
  } finally {
    clearTimeout(timer);
  }
}

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

  try {
    const messages = [{ role: "user", content: buildPrompt(req) }];
    const startedAt = Date.now();
    let best = null; // これまでで目標に最も近かった結果 { dishes, nutritionOk, check }
    let attempts = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let content;
      let dishes;
      try {
        const r = await callAi(ai, messages, req.count);
        if (r.status) {
          if (best) break; // 作り直しの途中で失敗したら、ここまでの最良の結果を返す
          await refundUsage(env, reservation.day);
          console.error("xAI request failed: status " + r.status);
          if (r.status === 401 || r.status === 403) {
            return json({ error: "AIの設定に問題があります。管理者に連絡してください" }, { status: 503 });
          }
          return json({ error: "レシピの作成に失敗しました。もう一度お試しください" }, { status: 502 });
        }
        content = r.content;
        dishes = parseDishes(content, req);
      } catch (e) {
        if (!best) throw e; // 最初の1回の失敗は、従来どおりエラー扱い(下の catch で利用回数を戻す)
        console.error("retry " + attempt + " failed: " + (e && e.message));
        break;
      }
      attempts = attempt; // 解析まで成功した回数

      // 栄養量は成分表から計算する。失敗してもAIのレシピ自体は返す(利用回数も戻さない)。
      let nutritionOk = true;
      try {
        await attachNutrition(env, dishes, req.metrics.map((m) => m.id));
      } catch (e) {
        nutritionOk = false;
        console.error("nutrition failed: " + (e && e.message));
      }
      if (!nutritionOk) {
        // 計算できないので、目標に収まったか確かめようがない。作り直しはしない
        if (!best) best = { dishes, nutritionOk: false, check: null };
        break;
      }

      const check = checkTargets(dishes, req.metrics);
      if (!best || check.worst < best.check.worst) best = { dishes, nutritionOk: true, check };
      if (check.ok) break;
      if (attempt === MAX_ATTEMPTS || Date.now() - startedAt > RETRY_START_LIMIT_MS) break;

      // 計算結果(合計と食材ごとの内訳)を伝えて、作り直してもらう
      messages.push({ role: "assistant", content });
      messages.push({ role: "user", content: buildRetryPrompt(req, dishes, check) });
    }

    const result = { dishes: best.dishes, nutritionOk: best.nutritionOk };
    if (best.check) {
      result.targetCheck = {
        ok: best.check.ok,
        tolerancePct: Math.round(TOLERANCE * 100),
        attempts,
        results: best.check.results.map(({ id, target, total, min, max, diffPct, ok }) => ({
          id, target, total, min, max, diffPct: Math.round(diffPct * 10) / 10, ok,
        })),
      };
    }
    return json(result);
  } catch (e) {
    await refundUsage(env, reservation.day);
    console.error("create-recipe failed: " + (e && e.message));
    return json({ error: "レシピの作成に失敗しました。もう一度お試しください" }, { status: 502 });
  }
}
