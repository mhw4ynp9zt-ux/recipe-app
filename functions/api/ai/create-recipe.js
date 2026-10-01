// POST /api/ai/create-recipe(ログイン必須)
// body: { ingredients: string, mood: string, count: 1|2|3, targets: { protein: 78, veg: 600, ... } }
// → { jobId, resumed, status: "running", progress: 0 }
//
// ここでは「作成ジョブを作るだけ」で、AIは呼びません(=この呼び出しだけでは費用は発生しません)。
// 実際の作成は POST /api/ai/jobs/{jobId}、進捗・結果の取得は GET /api/ai/jobs/{jobId} です。
// 仕組みと費用を抑えるための決まりは functions/_lib/recipe-job.js の冒頭を参照してください。
//
// 入力チェックに通ったあと、アプリ全体の1日の利用回数を1回分確保します(上限に達していれば 429)。
// 作成に失敗したジョブは、確保した1回分を戻します。
// 同じユーザーの実行中のジョブがあれば、新しく作らずそのジョブを返します(resumed: true)。
// 管理者のときだけ、失敗の応答に debug(原因の詳細)が付きます。

import { getSessionUser, checkOrigin, json } from "../../_lib/session.js";
import { startJob } from "../../_lib/recipe-job.js";
import { defaultDeps } from "../../_lib/recipe-job-deps.js";

export async function onRequestPost({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) {
    return json({ error: "AIでレシピを作成するにはログインが必要です" }, { status: 401 });
  }
  if (!checkOrigin(request, env)) {
    return json({ error: "不正なリクエストです" }, { status: 403 });
  }

  let body = null;
  try {
    body = await request.json();
  } catch (e) { /* 読めなければ null のまま(startJob が 400 を返す) */ }

  const r = await startJob(env, user, body, defaultDeps);
  return json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}
