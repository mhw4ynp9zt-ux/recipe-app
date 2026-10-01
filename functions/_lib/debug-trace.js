// 管理者だけに返す「デバッグ情報(エラーログ)」を集める共通処理。
// createTrace(false) で作ったものは何も記録せず、dump() も空を返すので、
// 一般ユーザーのリクエストでは内部の情報が漏れません。
// 管理者かどうかの判定は呼び出し側(isAdminUser)で行い、その結果を createTrace の引数に渡します。
//
// 記録する文字列は、APIキーなどの秘密を [REDACTED] に置き換え、長いものは切り詰めます。
// (AIの返答の本文など、原因調査に必要な情報は残しつつ、キーがログに混ざらないようにするため)

const MAX_TEXT = 2000;      // 1つの文字列の最大長
const MAX_EVENTS = 60;      // 1リクエストで記録するイベント数の上限
const MAX_DEPTH = 4;        // オブジェクトの入れ子の深さの上限

// 秘密(APIキーなど)を伏せ字にする。secrets は「この文字列そのもの」を消すための追加指定。
function redact(text, secrets = []) {
  let s = String(text === null || text === undefined ? "" : text);
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 8) s = s.split(secret).join("[REDACTED]");
  }
  return s
    .replace(/xai-[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]");
}

function clip(text, max = MAX_TEXT) {
  const s = String(text);
  return s.length > max ? s.slice(0, max) + "…(以降省略。全体で" + s.length + "文字)" : s;
}

// キー名そのものが秘密を表すものは、値を見ずに伏せる(hasKey のような無害な名前は対象外)
const SECRET_KEY_NAME = /^(api[-_]?key|authorization|cookie|password|token|secret)$/i;

function sanitize(value, secrets, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return clip(redact(value, secrets));
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MAX_DEPTH) return "(深すぎるため省略)";
  if (Array.isArray(value)) return value.slice(0, 30).map((v) => sanitize(v, secrets, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY_NAME.test(k) ? "[REDACTED]" : sanitize(v, secrets, depth + 1);
    }
    return out;
  }
  return clip(redact(String(value), secrets));
}

function createTrace(enabled, { secrets = [] } = {}) {
  const startedAt = Date.now();
  const knownSecrets = [...secrets];
  const events = [];
  let problems = 0;
  let dropped = 0;

  return {
    enabled: !!enabled,

    // ログに混ぜたくない文字列(復号したAPIキーなど)を後から登録する
    addSecret(secret) {
      if (typeof secret === "string" && secret) knownSecrets.push(secret);
    },

    // level: "info" | "warn" | "error"。warn と error は「問題あり」として数える。
    add(stage, data = {}, level = "info") {
      if (!enabled) return;
      if (level !== "info") problems++;
      if (events.length >= MAX_EVENTS) { dropped++; return; }
      events.push({ t: Date.now() - startedAt, level, stage, ...sanitize(data, knownSecrets) });
    },

    // 例外を1件記録する(name・message・stack)
    error(stage, e, extra = {}, level = "error") {
      this.add(stage, {
        ...extra,
        name: e && e.name,
        message: e && e.message ? e.message : String(e),
        stack: e && e.stack,
      }, level);
    },

    hasProblems() {
      return enabled && problems > 0;
    },

    dump() {
      if (!enabled) return undefined;
      const out = {
        startedAt: new Date(startedAt).toISOString(),
        elapsedMs: Date.now() - startedAt,
        events,
      };
      if (dropped) out.droppedEvents = dropped;
      return out;
    },
  };
}

export { createTrace, redact, clip, sanitize };
