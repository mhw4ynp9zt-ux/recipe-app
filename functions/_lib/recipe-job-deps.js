// recipe-job.js が使う本番の部品(プロンプト・栄養計算・AI設定・利用回数・管理者判定)をまとめたもの。
// テストでは、これの代わりに偽物を recipe-job.js へ渡す(実際のAIを呼ばないため)。
import {
  parseCreateRequest, buildPrompt, buildRetryPrompt, checkTargets, maxTokensFor, parseDishes, TOLERANCE,
} from "./recipe-prompt.js";
import { attachNutrition } from "./nutrition.js";
import { createTrace } from "./debug-trace.js";
import { loadAiSettings, reserveUsage, refundUsage } from "./app-settings.js";
import { isAdminUser } from "./session.js";

export const defaultDeps = {
  parseCreateRequest, buildPrompt, buildRetryPrompt, checkTargets, maxTokensFor, parseDishes, TOLERANCE,
  attachNutrition, createTrace, loadAiSettings, reserveUsage, refundUsage, isAdminUser,
};
