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
//   debug           … 【管理者のときだけ】失敗・警告の詳細(どの段階で何が起きたか)。エラー応答にも、
//                     作り直しや栄養計算の失敗など問題があった成功応答にも入る。一般ユーザーには一切返さない。
//                     APIキーは含まれない(debug-trace.js が伏せ字にする)。画面の「ログをダウンロード」に含まれる。
//
// 計算した合計が目標の±5%に入らないときは、計算結果(食材ごとの内訳つき)をAIに伝えて作り直させます。
// 最大 MAX_ATTEMPTS 回(最初の1回を含む)まで試し、収まらなければ、目標に最も近かった結果を返します。
// 作り直しの呼び出しは、利用回数としては最初の1回にまとめて数えます(ユーザーの操作1回=1回)。
//
// 管理者が設定したAPIキー・モデルをサーバー側で使ってxAIを呼びます(キーはブラウザに渡りません)。
// アプリ全体の1日の利用上限に達している場合は 429 を返します。
// 最初のAI呼び出しや返答の検証に失敗した場合は、消費した1回分を戻します。

import { getSessionUser, checkOrigin, json, isAdminUser } from "../../_lib/session.js";
import { loadAiSettings, reserveUsage, refundUsage } from "../../_lib/app-settings.js";
import {
  parseCreateRequest, buildPrompt, buildRetryPrompt, checkTargets, maxTokensFor, parseDishes, TOLERANCE,
} from "../../_lib/recipe-prompt.js";
import { attachNutrition } from "../../_lib/nutrition.js";
import { createTrace } from "../../_lib/debug-trace.js";

const AI_TIMEOUT_MS = 60000;      // AIの1回の呼び出しの上限
const MAX_ATTEMPTS = 3;           // 目標の±5%に収まらないとき、最大で何回まで作る(最初の1回を含む)
const RETRY_START_LIMIT_MS = 50000; // 開始から、これを過ぎていたら作り直しはせず、今ある最良の結果を返す(待ち時間が長くなりすぎないように)

// xAIを1回呼ぶ。成功: { content } / HTTPエラー: { status, body } / 通信失敗・タイムアウト・空の返答は例外
// body は xAI が返したエラー本文(管理者向けのデバッグ情報にだけ使う。一般ユーザーには返さない)
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
    if (!res.ok) {
      let body = "";
      try { body = await res.text(); } catch (e) { /* 本文が読めなくても status は返す */ }
      return { status: res.status, body };
    }

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

  // 管理者のときだけ、失敗の詳細(debug)を応答に付ける。判定はここ(サーバー側)だけで行う。
  const trace = createTrace(isAdminUser(env, user));
  const fail = (message, status) => {
    const body = { error: message };
    if (trace.enabled) body.debug = trace.dump();
    return json(body, { status });
  };

  let body;
  try {
    body = await request.json();
  } catch (e) {
    trace.error("request_json_error", e);
    return fail("リクエストが不正です", 400);
  }

  // 入力チェックは回数を消費する前に行う(不正な入力で1日の枠を減らさない)
  const parsed = parseCreateRequest(body);
  if (parsed.error) {
    trace.add("request_invalid", { message: parsed.error }, "error");
    return fail(parsed.error, 400);
  }
  const req = parsed.value;

  let ai;
  try {
    ai = await loadAiSettings(env, { decrypt: true });
  } catch (e) {
    console.error("loadAiSettings failed: " + (e && e.message));
    trace.error("load_settings_failed", e);
    return fail("サーバーでエラーが発生しました。もう一度お試しください", 500);
  }
  if (ai.apiKey) trace.addSecret(ai.apiKey);
  trace.add("start", {
    model: ai.model, hasKey: ai.hasKey, keyError: ai.keyError, dailyLimit: ai.dailyLimit,
    count: req.count,
    targets: req.metrics.map((m) => m.id + "=" + m.target + m.unit),
    ingredientsChars: req.ingredients.length, moodChars: req.mood.length,
  });
  if (!ai.apiKey) {
    trace.add("no_api_key", { reason: ai.keyError ? "保存済みのAPIキーを復号できません(SETTINGS_ENC_KEYが変わった可能性)" : "APIキーが未設定です" }, "error");
    return fail("AI機能がまだ設定されていません。管理者に連絡してください", 503);
  }

  let reservation;
  try {
    reservation = await reserveUsage(env, ai.dailyLimit);
  } catch (e) {
    console.error("reserveUsage failed: " + (e && e.message));
    trace.error("reserve_usage_failed", e);
    return fail("サーバーでエラーが発生しました。もう一度お試しください", 500);
  }
  if (!reservation.ok) {
    trace.add("daily_limit", { dailyLimit: ai.dailyLimit }, "error");
    return fail("本日のAI利用回数の上限に達しました。明日またお試しください", 429);
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
          trace.add("ai_http_error", { attempt, status: r.status, body: r.body }, best ? "warn" : "error");
          if (best) break; // 作り直しの途中で失敗したら、ここまでの最良の結果を返す
          await refundUsage(env, reservation.day);
          console.error("xAI request failed: status " + r.status);
          if (r.status === 401 || r.status === 403) {
            return fail("AIの設定に問題があります。管理者に連絡してください", 503);
          }
          return fail("レシピの作成に失敗しました。もう一度お試しください", 502);
        }
        content = r.content;
        trace.add("ai_response", { attempt, chars: content.length });
        dishes = parseDishes(content, req);
      } catch (e) {
        // 通信失敗・タイムアウト・空の返答・返答の形式不正。AIの返答が取れていれば本文の先頭も残す(原因調査用)
        trace.error("ai_or_parse_error", e, { attempt, rawContent: content }, best ? "warn" : "error");
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
        trace.error("nutrition_error", e, { attempt });
      }
      if (!nutritionOk) {
        // 計算できないので、目標に収まったか確かめようがない。作り直しはしない
        if (!best) best = { dishes, nutritionOk: false, check: null };
        break;
      }

      const check = checkTargets(dishes, req.metrics);
      trace.add("target_check", {
        attempt, ok: check.ok, worstPct: Math.round(check.worst * 10) / 10,
        results: check.results.map((r) => r.id + ": 目標" + r.target + " / 合計" + r.total + " (" + (r.diffPct > 0 ? "+" : "") + r.diffPct.toFixed(1) + "%)" + (r.ok ? "" : " NG")),
        unmatched: [...new Set(dishes.flatMap((d) => (d.nutritionCheck && d.nutritionCheck.unmatched) || []))],
      }, check.ok ? "info" : "warn");
      if (!best || check.worst < best.check.worst) best = { dishes, nutritionOk: true, check };
      if (check.ok) break;
      if (attempt === MAX_ATTEMPTS || Date.now() - startedAt > RETRY_START_LIMIT_MS) {
        trace.add("retry_stopped", {
          reason: attempt === MAX_ATTEMPTS ? "作り直しの上限(" + MAX_ATTEMPTS + "回)に達した" : "待ち時間の上限を超えた",
          elapsedMs: Date.now() - startedAt,
        }, "warn");
        break;
      }

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
    // 管理者には、問題(作り直しの失敗・栄養計算の失敗・目標に収まらなかった等)があったときだけ詳細を付ける
    if (trace.hasProblems()) result.debug = trace.dump();
    return json(result);
  } catch (e) {
    await refundUsage(env, reservation.day);
    console.error("create-recipe failed: " + (e && e.message));
    trace.error("create_recipe_failed", e, { refunded: true });
    return fail("レシピの作成に失敗しました。もう一度お試しください", 502);
  }
}
