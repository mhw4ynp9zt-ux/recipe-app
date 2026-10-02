// ==== レシピ作成の「所要時間」まわりの小さな部品(通信はしない) ====
// config.js の TIME_LIMIT_OPTIONS に依存します。create-ai.js が使います。
//   ・選んだ所要時間を、この端末に覚えておく(readTimeLimit / writeTimeLimit)
//   ・AIが返した各品の目安時間が、指定の上限を超えているかを調べる(overLimitIndexes)

const TIME_LIMIT_KEY = 'recipeRouletteTimeLimitV1';

// 目安時間として使える値か(1〜240の整数。数値型のみ)
function validMinutes(v){
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 240;
}

// 上限(maxMinutes)を超えている品の番号(0始まり)。上限が選択肢にない・指定なしのときや、目安時間が無効な品は対象外
function overLimitIndexes(dishes, maxMinutes){
  const out = [];
  if(!Array.isArray(dishes) || !TIME_LIMIT_OPTIONS.includes(maxMinutes)) return out;
  dishes.forEach((d, i) => {
    if(d && validMinutes(d.minutes) && d.minutes > maxMinutes) out.push(i);
  });
  return out;
}

// 覚えておいた所要時間(分)。選択肢にある値の文字列だけ復元し、それ以外・読めないときは null(指定なし)
function readTimeLimit(storage){
  try {
    const raw = storage.getItem(TIME_LIMIT_KEY);
    const n = Number(raw);
    return TIME_LIMIT_OPTIONS.includes(n) && raw === String(n) ? n : null;
  } catch(e){
    return null;
  }
}

// 所要時間を覚える。minutes が null(指定なし)なら覚えた値を消す。保存できなくても何もしない
function writeTimeLimit(storage, minutes){
  try {
    if(minutes === null || minutes === undefined) storage.removeItem(TIME_LIMIT_KEY);
    else storage.setItem(TIME_LIMIT_KEY, String(minutes));
  } catch(e){ /* 保存できない環境では、次回の復元だけできない */ }
}
