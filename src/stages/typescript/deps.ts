import ts from "typescript";
import { checkDependencies, type DepRequest, readDeclaredDependencies } from "../../deps/check.js";
import { packageNameFromSpecifier } from "../../deps/names.js";
import type { Stage } from "../../core/stage.js";

/** Every bare import/require, with the location of its first occurrence. */
export function importRequests(code: string): DepRequest[] {
  const info = ts.preProcessFile(code, true, true);
  const sf = ts.createSourceFile("x.ts", code, ts.ScriptTarget.Latest, false);
  const seen = new Map<string, DepRequest>();
  for (const f of info.importedFiles) {
    const name = packageNameFromSpecifier(f.fileName);
    if (!name || seen.has(name)) continue;
    const pos = sf.getLineAndCharacterOfPosition(f.pos);
    seen.set(name, { name, location: { line: pos.line + 1, column: pos.character + 1 } });
  }
  return [...seen.values()];
}

export const depsStage: Stage = {
  id: "ts.deps",
  kind: "deps",
  languages: ["typescript", "javascript"],
  canFix: false,
  defaultEnabled: true,
  available: async () => ({ ok: true }),
  async run(ctx) {
    const requests = importRequests(ctx.code);
    if (requests.length === 0) return { findings: [], notes: ["no package imports"] };
    const declared = ctx.projectRoot ? await readDeclaredDependencies(ctx.projectRoot) : undefined;
    const res = await checkDependencies(requests, {
      config: ctx.config,
      mode: ctx.mode,
      ...(ctx.projectRoot ? { projectRoot: ctx.projectRoot } : {}),
      ...(declared ? { declared } : {}),
    });
    const allUnknown = res.packages.length > 0 && res.packages.every((p) => p.status === "unknown");
    if (allUnknown) return { findings: [], skipped: `npm registry unreachable: ${res.unavailable[0] ?? "unknown error"}`, notes: res.notes };
    return { findings: res.findings, notes: [`checked ${res.packages.length} package(s)`, ...res.notes] };
  },
};
