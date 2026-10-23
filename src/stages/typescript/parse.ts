import ts from "typescript";
import { makeFinding, snippetAt, type Stage } from "../../core/stage.js";

/** Syntax-only parse. Any error is fatal: later tools would produce noise on broken input. */
export const parseStage: Stage = {
  id: "ts.parse",
  kind: "parse",
  languages: ["typescript", "javascript"],
  canFix: false,
  defaultEnabled: true,
  available: async () => ({ ok: true }),
  async run(ctx) {
    const out = ts.transpileModule(ctx.code, {
      fileName: ctx.filePath,
      reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.Preserve, allowJs: true, noEmit: true },
    });
    const sf = ts.createSourceFile(ctx.filePath, ctx.code, ts.ScriptTarget.Latest, false);
    const findings = (out.diagnostics ?? [])
      .filter((d) => d.category === ts.DiagnosticCategory.Error)
      .map((d) => {
        const start = d.start ?? 0;
        const pos = sf.getLineAndCharacterOfPosition(start);
        const end = sf.getLineAndCharacterOfPosition(start + (d.length ?? 0));
        const location = { line: pos.line + 1, column: pos.character + 1, endLine: end.line + 1, endColumn: end.character + 1 };
        return makeFinding({
          ruleId: `parse/TS${d.code}`,
          source: "typescript",
          category: "syntax",
          severity: "critical",
          message: `Syntax error: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`,
          location,
          snippet: snippetAt(ctx.code, location),
        });
      });
    return { findings, fatal: findings.length > 0 };
  },
};
