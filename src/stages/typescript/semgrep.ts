import path from "node:path";
import { fileURLToPath } from "node:url";
import { run, which, withTempFile } from "../../core/exec.js";
import { makeFinding, snippetAt, type Stage } from "../../core/stage.js";
import { type Finding, Severity } from "../../core/types.js";

export const RULES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "rules", "semgrep");

interface SemgrepResult {
  check_id: string;
  start: { line: number; col: number };
  end: { line: number; col: number };
  extra: { message: string; severity: string; metadata?: { laundry_severity?: string; cwe?: string } };
}

interface SemgrepOutput {
  results: SemgrepResult[];
  errors: Array<{ message?: string; long_msg?: string; level?: string }>;
}

function severityOf(r: SemgrepResult): Severity {
  const parsed = Severity.safeParse(r.extra.metadata?.laundry_severity);
  if (parsed.success) return parsed.data;
  return r.extra.severity === "ERROR" ? "high" : r.extra.severity === "WARNING" ? "medium" : "low";
}

export const semgrepStage: Stage = {
  id: "ts.semgrep",
  kind: "security",
  languages: ["typescript", "javascript"],
  canFix: false,
  defaultEnabled: true,
  async available() {
    return (await which("semgrep", "CODELAUNDRY_SEMGREP"))
      ? { ok: true }
      : { ok: false, reason: "semgrep not installed (pip install semgrep); injection/crypto/SSRF rules not checked" };
  },
  async run(ctx) {
    const bin = (await which("semgrep", "CODELAUNDRY_SEMGREP")) ?? "semgrep";
    const ruleFile = path.join(RULES_DIR, "typescript.yml");
    const out = await withTempFile(path.basename(ctx.filePath), ctx.code, (dir, file) =>
      run(
        bin,
        ["scan", "--config", ruleFile, "--json", "--quiet", "--metrics=off", "--disable-version-check", "--timeout", "20", file],
        { cwd: dir, timeoutMs: 90_000 },
      ),
    );
    if (out.timedOut) throw new Error("semgrep timed out");
    let parsed: SemgrepOutput;
    try {
      parsed = JSON.parse(out.stdout) as SemgrepOutput;
    } catch {
      throw new Error(`semgrep produced no JSON (exit ${out.code}): ${out.stderr.slice(0, 200)}`);
    }
    const fatalErrors = parsed.errors.filter((e) => e.level === "error");
    if (fatalErrors.length > 0 && parsed.results.length === 0) {
      throw new Error(`semgrep error: ${(fatalErrors[0]?.message ?? fatalErrors[0]?.long_msg ?? "unknown").slice(0, 200)}`);
    }

    const seen = new Set<string>();
    const findings: Finding[] = [];
    for (const r of parsed.results) {
      const rule = r.check_id.split(".").pop() ?? r.check_id;
      const key = `${rule}:${r.start.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const location = { line: r.start.line, column: r.start.col, endLine: r.end.line, endColumn: r.end.col };
      const cwe = r.extra.metadata?.cwe;
      findings.push(
        makeFinding({
          ruleId: `semgrep/${rule}`,
          source: "semgrep",
          category: "security",
          severity: severityOf(r),
          message: `${r.extra.message.trim()}${cwe ? ` (${cwe})` : ""}`,
          location,
          snippet: snippetAt(ctx.code, location),
        }),
      );
    }
    return { findings, ...(fatalErrors.length ? { notes: [`semgrep reported ${fatalErrors.length} error(s)`] } : {}) };
  },
};
