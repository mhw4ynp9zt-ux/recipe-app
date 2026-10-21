// 料理の写真の検査。AIも外部APIも呼ばない(外部通信をしない)。
// 端末で縮小した画像を「data:image/jpeg;base64,…」の形で受け取り、種類・大きさ・中身(先頭のバイト列)を確かめる。

export const PHOTO_MAX_BYTES = 400 * 1024; // 画像本体の上限(base64にする前)
export const PHOTO_MAX_REQUEST_CHARS = Math.ceil((PHOTO_MAX_BYTES * 4) / 3) + 200; // 本文(JSON)の上限の目安

const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

function sniffMime(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  return null;
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// 成功: { ok: true, mime, b64, size }  失敗: { ok: false, error }
export function parseImageDataUrl(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl) return { ok: false, error: "画像が指定されていません" };
  if (dataUrl.length > PHOTO_MAX_REQUEST_CHARS) return { ok: false, error: "画像が大きすぎます" };
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) return { ok: false, error: "JPEG・PNG・WebPの画像を選んでください" };
  const [, mime, b64] = m;
  let bytes;
  try {
    bytes = base64ToBytes(b64);
  } catch (e) {
    return { ok: false, error: "画像を読み取れませんでした" };
  }
  if (bytes.length > PHOTO_MAX_BYTES) return { ok: false, error: "画像が大きすぎます" };
  if (sniffMime(bytes) !== mime) return { ok: false, error: "画像を読み取れませんでした" };
  return { ok: true, mime, b64, size: bytes.length };
}

// 画像を返すレスポンス用のヘッダー(<img> で表示するだけ。スクリプトとして解釈させない)
export function imageHeaders(mime, cache) {
  return {
    "Content-Type": mime,
    "Cache-Control": cache,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
}
