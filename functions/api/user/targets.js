// GET /api/user/targets → 目標の目安(基準表の値と、自分で設定した値を合わせた、いま使う目標)
// PUT /api/user/targets → 保存。body: { profile: { sex, age, activity, purpose, heightCm, weightKg, special }, overrides: { protein: 104, ... }, showNumbers }
// AIは呼びません(基準表の値を引くだけ)。詳しくは functions/_lib/targets.js と docs/KONDATE.md を参照。
import { getSessionUser, checkOrigin, json } from "../../_lib/session.js";
import { buildTargets, loadTargets, saveTargets, parseTargetsRequest } from "../../_lib/targets.js";

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });
  let stored;
  try {
    stored = await loadTargets(env, user.id);
  } catch (e) {
    console.error("loadTargets failed: " + (e && e.message));
    return json({ error: "サーバーでエラーが発生しました。もう一度お試しください" }, { status: 500 });
  }
  if (stored.missingTable) return json({ error: "この機能はまだ準備中です(管理者がデータベースの更新を行うと使えます)", unavailable: true }, { status: 503 });
  const built = buildTargets(stored);
  if (!built.ok) {
    // 入力が未設定(まだ目標を作っていない)・基準表を引けない: 保存済みの入力だけ返し、目標は空にする
    return json({ ...stored, mode: stored.profile.special ? "manual" : "standard", standard: null, effective: {}, notices: [], bmi: null, configured: false, hint: built.error }, { headers: { "Cache-Control": "no-store" } });
  }
  return json({ ...built, configured: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function onRequestPut({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });
  if (!checkOrigin(request, env)) return json({ error: "不正なリクエストです" }, { status: 403 });
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "リクエストが不正です" }, { status: 400 }); }
  const parsed = parseTargetsRequest(body);
  if (parsed.error) return json({ error: parsed.error }, { status: 400 });
  const built = buildTargets(parsed.value);
  if (!built.ok) return json({ error: built.error }, { status: 400 });
  try {
    await saveTargets(env, user.id, parsed.value);
  } catch (e) {
    console.error("saveTargets failed: " + (e && e.message));
    return json({ error: "保存できませんでした。もう一度お試しください" }, { status: 500 });
  }
  return json({ ...built, configured: true });
}
