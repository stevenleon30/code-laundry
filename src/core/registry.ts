import { typescriptModule } from "../stages/typescript/index.js";
import type { LanguageModule } from "./stage.js";
import type { Language } from "./types.js";

/**
 * The only place languages plug in. Adding Python means adding a module here;
 * the pipeline, verdict, repair loop, MCP server and CLI stay unchanged.
 */
export const LANGUAGE_MODULES: readonly LanguageModule[] = [typescriptModule];

export function resolveModule(
  code: string,
  filename: string | undefined,
  hint: Language | undefined,
): { module: LanguageModule; language: Language } | undefined {
  for (const module of LANGUAGE_MODULES) {
    if (hint && !module.languages.includes(hint)) continue;
    const language = module.resolveLanguage(code, filename, hint);
    if (language) return { module, language };
  }
  return undefined;
}
