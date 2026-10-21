// GET /api/shared/:token → 共有されたレシピを見る(ログイン不要。トークンを知っている人だけが見られる)
// 返すのは共有時に抜き出した項目だけ。共有した人の情報は含まれない。AIも外部APIも呼ばない。
import { json } from "../../_lib/session.js";
import { TOKEN_RE, withMediaTables } from "../../_lib/share.js";

export async function onRequestGet({ env, params }) {
  if (!TOKEN_RE.test(String(params.token || ""))) return json({ error: "共有リンクが見つかりません" }, { status: 404 });
  return withMediaTables(async () => {
    const row = await env.DB.prepare(
      "SELECT snapshot, photo_mime, updated_at FROM recipe_shares WHERE token = ?"
    ).bind(params.token).first();
    if (!row) return json({ error: "共有リンクが見つかりません(共有が止められた可能性があります)" }, { status: 404 });
    return json(
      {
        recipe: JSON.parse(row.snapshot),
        photoUrl: row.photo_mime ? `/api/shared/${params.token}/photo?v=${row.updated_at}` : null,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  });
}
