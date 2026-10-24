import type { LanguageModule } from "../../core/stage.js";
import { defaultFilename, detect, resolveLanguage } from "./detect.js";
import { formatStage } from "./format.js";
import { lintStage } from "./lint.js";
import { secretsStage } from "../shared/secrets.js";
import { depsStage } from "./deps.js";
import { parseStage } from "./parse.js";
import { semgrepStage } from "./semgrep.js";
import { slopStage } from "./slop.js";
import { typecheckStage } from "./typecheck.js";

/**
 * TypeScript and JavaScript. Stage order here is pipeline order; consecutive
 * analysis-only stages (typecheck, semgrep, secrets, deps) run in parallel.
 */
export const typescriptModule: LanguageModule = {
  id: "typescript",
  languages: ["typescript", "javascript"],
  resolveLanguage,
  defaultFilename,
  detect,
  stages: [parseStage, formatStage, lintStage, typecheckStage, semgrepStage, secretsStage, depsStage, slopStage],
};
