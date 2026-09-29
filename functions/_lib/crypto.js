// APIキーをD1に保存するときの暗号化・復号(AES-GCM)。
// 鍵は環境変数(secret)の SETTINGS_ENC_KEY から作ります。
// SETTINGS_ENC_KEY は `openssl rand -base64 32` などで作った長いランダム文字列にしてください。
// この値を変えると、保存済みのAPIキーは復号できなくなります(その場合は再入力すればOKです)。

async function getKey(env) {
  if (!env.SETTINGS_ENC_KEY) {
    throw new Error("SETTINGS_ENC_KEY is not set");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(env.SETTINGS_ENC_KEY)
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(str) {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// 保存形式: "v1:<iv(base64)>:<暗号文(base64)>"
async function encryptString(env, plain) {
  const key = await getKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plain)
  );
  return `v1:${toBase64(iv)}:${toBase64(new Uint8Array(cipher))}`;
}

async function decryptString(env, stored) {
  const parts = String(stored).split(":");
  if (parts.length !== 3 || parts[0] !== "v1") {
    throw new Error("unsupported ciphertext format");
  }
  const key = await getKey(env);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(parts[1]) },
    key,
    fromBase64(parts[2])
  );
  return new TextDecoder().decode(plain);
}

export { encryptString, decryptString };
