// /api/ai/jobs/{jobId}(ログイン必須。作った本人だけ)
//
// GET  … 状況を返す(読むだけ。AIは呼ばないので、何回呼んでも費用は発生しません)
//        { jobId, status: "running"|"done"|"error", stage, progress(0〜100), stalled, result?, error? }
//        result は完成したとき、従来の create-recipe の応答と同じ形({ dishes, nutritionOk, targetCheck, debug? })
//        stalled: true は「実行中なのに誰も処理していない」(通信が切れた)。画面側が POST で続きを動かす
// POST … ジョブを最後まで動かす(AI呼び出し→栄養計算→必要なら作り直し)。終わったときの状況を返す。
//        他のリクエストが実行中なら何もせず、今の状況だけを返す(AIは重ねて呼ばない)。
//        1つのジョブでAIを呼べる回数には上限があります(recipe-job.js の MAX_AI_CALLS)。

import { getSessionUser, checkOrigin, json } from "../../../_lib/session.js";
import { getJobState, runJobRequest } from "../../../_lib/recipe-job.js";
import { defaultDeps } from "../../../_lib/recipe-job-deps.js";

const NO_STORE = { "Cache-Control": "no-store" };

export async function onRequestGet({ request, env, params }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401, headers: NO_STORE });
  const r = await getJobState(env, user, params.id, defaultDeps);
  return json(r.body, { status: r.status, headers: NO_STORE });
}

export async function onRequestPost({ request, env, params, waitUntil }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401, headers: NO_STORE });
  if (!checkOrigin(request, env)) return json({ error: "不正なリクエストです" }, { status: 403, headers: NO_STORE });
  const r = await runJobRequest(env, user, params.id, defaultDeps, { waitUntil });
  return json(r.body, { status: r.status, headers: NO_STORE });
}
