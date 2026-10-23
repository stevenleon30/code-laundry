import ts from "typescript";
import { makeFinding, snippetAt, type Stage } from "../../core/stage.js";
import type { Finding, Severity } from "../../core/types.js";
import { getProgram, loadTsProject, toLocation } from "./program.js";

/** Module-resolution errors: meaningless without a project (no node_modules); deps stage covers existence. */
const UNRESOLVED_MODULE_CODES = new Set([2307, 7016, 2875, 2792]);

/** Errors that only exist because of strict-mode flags we impose when there is no project tsconfig. */
const STRICTNESS_CODES = new Set([7005, 7006, 7008, 7019, 7031, 7034, 7053, 2531, 2532, 2533, 2564, 18046, 18047, 18048, 18049]);

/** For plain JS we only trust a few checkJs diagnostics; the rest are noisy inference failures. */
const JS_TRUSTED_CODES = new Set([2304, 2552, 2588, 2349, 2554, 2555, 2339, 2551, 2300, 2451]);

function severityFor(code: number, hasProjectTsconfig: boolean): Severity {
  if (STRICTNESS_CODES.has(code)) return hasProjectTsconfig ? "high" : "medium";
  return "high";
}

export const typecheckStage: Stage = {
  id: "ts.typecheck",
  kind: "typecheck",
  languages: ["typescript", "javascript"],
  canFix: false,
  defaultEnabled: true,
  available: async () => ({ ok: true }),
  async run(ctx) {
    const notes: string[] = [];
    const project = loadTsProject(ctx.projectRoot, ctx.detected.projectConfigs.tsconfig);
    if (project.configError) notes.push(`project tsconfig unusable (${project.configError}); used defaults`);
    else if (project.tsconfigPath) notes.push(`using ${project.tsconfigPath}`);
    else notes.push("no project tsconfig; using strict defaults (strictness errors reported as medium)");

    const isJs = ctx.detected.language === "javascript";
    const { program, sourceFile } = getProgram(ctx.filePath, ctx.code, project, isJs ? { checkJs: true } : {});
    const diagnostics = program.getSemanticDiagnostics(sourceFile);
    const hasProject = Boolean(project.tsconfigPath);

    const findings: Finding[] = [];
    for (const d of diagnostics) {
      if (d.category !== ts.DiagnosticCategory.Error) continue;
      if (UNRESOLVED_MODULE_CODES.has(d.code) && !ctx.projectRoot) continue;
      if (isJs && !JS_TRUSTED_CODES.has(d.code)) continue;
      const location = d.start !== undefined ? toLocation(sourceFile, d.start, d.length ?? 0) : undefined;
      const unresolved = UNRESOLVED_MODULE_CODES.has(d.code);
      findings.push(
        makeFinding({
          ruleId: `tsc/TS${d.code}`,
          source: "tsc",
          category: unresolved ? "dependency" : "type",
          severity: severityFor(d.code, hasProject),
          message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
          ...(location ? { location } : {}),
          snippet: snippetAt(ctx.code, location),
        }),
      );
    }
    return { findings, notes };
  },
};
