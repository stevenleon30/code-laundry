import type { LanguageModule } from "../../core/stage.js";
import { defaultFilename, detect, resolveLanguage } from "./detect.js";
import { formatStage } from "./format.js";
import { lintStage } from "./lint.js";
import { parseStage } from "./parse.js";
import { typecheckStage } from "./typecheck.js";

/** TypeScript and JavaScript. Stage order here is pipeline order. */
export const typescriptModule: LanguageModule = {
  id: "typescript",
  languages: ["typescript", "javascript"],
  resolveLanguage,
  defaultFilename,
  detect,
  stages: [parseStage, formatStage, lintStage, typecheckStage],
};
