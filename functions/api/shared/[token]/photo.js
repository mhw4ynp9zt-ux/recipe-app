// GET /api/shared/:token/photo → 共有されたレシピの写真(ログイン不要)
import { json } from "../../../_lib/session.js";
import { TOKEN_RE, withMediaTables } from "../../../_lib/share.js";
import { base64ToBytes, imageHeaders } from "../../../_lib/photo.js";

export async function onRequestGet({ env, params }) {
  if (!TOKEN_RE.test(String(params.token || ""))) return json({ error: "共有リンクが見つかりません" }, { status: 404 });
  return withMediaTables(async () => {
    const row = await env.DB.prepare("SELECT photo_mime, photo_data FROM recipe_shares WHERE token = ?").bind(params.token).first();
    if (!row || !row.photo_mime || !row.photo_data) return json({ error: "写真がありません" }, { status: 404 });
    return new Response(base64ToBytes(row.photo_data), { headers: imageHeaders(row.photo_mime, "no-store") });
  });
}
