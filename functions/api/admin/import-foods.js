// 管理者専用: 日本食品標準成分表をD1に取り込む(import-foods.html から使う)
// GET  /api/admin/import-foods → { total: 現在の登録件数 }
// POST /api/admin/import-foods → body: { init?: true, rows: [[...], ...] }  100件ずつ送る

import { requireAdmin, json } from "../../_lib/session.js";
import { importFoodsChunk, countFoods } from "../../_lib/foods-import.js";
import { redact, clip } from "../../_lib/debug-trace.js";

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(env, request);
  if (auth.error) return auth.error;
  return json({ total: await countFoods(env) });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAdmin(env, request);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "リクエストが不正です" }, { status: 400 });
  }

  try {
    const result = await importFoodsChunk(env, body);
    if (result.error) return json({ error: result.error }, { status: 400 });
    return json(result);
  } catch (e) {
    console.error("import-foods failed: " + (e && e.message));
    // 管理者専用APIなので、画面の「ログをダウンロード」用に原因(detail)も返す
    return json({
      error: "取り込みに失敗しました",
      detail: { name: e && e.name, message: clip(redact(e && e.message), 500) },
    }, { status: 500 });
  }
}
