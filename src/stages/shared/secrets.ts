import { readFile } from "node:fs/promises";
import path from "node:path";
import { run, which, withTempFile } from "../../core/exec.js";
import { KNOWN_SECRET_PATTERNS } from "../../core/redact.js";
import { makeFinding, type Stage } from "../../core/stage.js";
import type { Finding, Location } from "../../core/types.js";

interface RawSecret {
  rule: string;
  value: string;
  location: Location;
  source: "gitleaks" | "builtin";
  description: string;
}

/** Values that are obviously placeholders, not credentials. The slop stage reports these. */
const PLACEHOLDER = /^(?:x+|\*+|\.+|<[^>]*>|\$\{[^}]*\}|(?:your|my|insert|enter|replace|put)[-_ ]?.*|.*(?:here|example|placeholder|changeme|dummy|sample|todo|xxx).*|test|password|secret|null|undefined|none)$/i;

function entropy(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** `password = "..."`, `apiKey: '...'`, `const SECRET_TOKEN = "..."`. */
const ASSIGNMENT =
  /\b([A-Za-z0-9_]*(?:api[-_]?key|apikey|secret|token|passw(?:or)?d|pwd|auth|credential|private[-_]?key|access[-_]?key|client[-_]?secret)[A-Za-z0-9_]*)\s*[:=]\s*(["'`])([^"'`\n]{8,200})\2/gi;

/** Credentials embedded in connection strings: scheme://user:pass@host */
const URL_CREDENTIALS = /\b[a-z][a-z0-9+.-]*:\/\/([^\s:/@"'`]+):([^\s@/"'`]{3,})@[^\s"'`]+/gi;

function lineCol(code: string, index: number): { line: number; column: number } {
  const before = code.slice(0, index);
  const line = before.split("\n").length;
  return { line, column: index - before.lastIndexOf("\n") };
}

export function builtinScan(code: string): RawSecret[] {
  const out: RawSecret[] = [];
  for (const [rule, re] of KNOWN_SECRET_PATTERNS) {
    for (const m of code.matchAll(new RegExp(re.source, re.flags))) {
      out.push({ rule, value: m[0], location: lineCol(code, m.index ?? 0), source: "builtin", description: rule.replace(/-/g, " ") });
    }
  }
  for (const m of code.matchAll(ASSIGNMENT)) {
    const name = m[1] ?? "";
    const value = m[3] ?? "";
    if (PLACEHOLDER.test(value) || /\s/.test(value.trim()) || value.includes("${")) continue;
    if (entropy(value) < 3.0) continue;
    const valueIndex = (m.index ?? 0) + m[0].indexOf(value);
    out.push({ rule: "generic-secret", value, location: lineCol(code, valueIndex), source: "builtin", description: `hardcoded value assigned to "${name}"` });
  }
  for (const m of code.matchAll(URL_CREDENTIALS)) {
    const pass = m[2] ?? "";
    if (PLACEHOLDER.test(pass) || pass.startsWith("$")) continue;
    const idx = (m.index ?? 0) + m[0].indexOf(`:${pass}@`) + 1;
    out.push({ rule: "url-credentials", value: pass, location: lineCol(code, idx), source: "builtin", description: "password embedded in a connection URL" });
  }
  return out;
}

interface GitleaksFinding {
  RuleID: string;
  Description: string;
  StartLine: number;
  StartColumn: number;
  EndLine: number;
  EndColumn: number;
  Secret: string;
}

async function gitleaksScan(bin: string, filename: string, code: string): Promise<RawSecret[]> {
  return withTempFile(filename, code, async (dir, file) => {
    const report = path.join(dir, "gitleaks-report.json");
    const res = await run(
      bin,
      ["dir", file, "--report-format", "json", "--report-path", report, "--no-banner", "--no-color", "--exit-code", "0", "--log-level", "error"],
      { cwd: dir, timeoutMs: 60_000 },
    );
    if (res.code !== 0) throw new Error(`gitleaks exit ${res.code}: ${res.stderr.slice(0, 200)}`);
    const parsed = JSON.parse(await readFile(report, "utf8")) as GitleaksFinding[];
    return parsed.map((g) => ({
      rule: g.RuleID,
      value: g.Secret,
      location: { line: g.StartLine, column: Math.max(1, g.StartColumn), endLine: g.EndLine, endColumn: Math.max(1, g.EndColumn) },
      source: "gitleaks" as const,
      description: g.Description,
    }));
  });
}

/**
 * Hardcoded secrets. gitleaks when installed, plus built-in patterns (always). Secret
 * values never appear in findings: they are handed to the pipeline's redactor only.
 */
export const secretsStage: Stage = {
  id: "secrets",
  kind: "security",
  languages: ["typescript", "javascript"],
  canFix: false,
  defaultEnabled: true,
  available: async () => ({ ok: true }),
  async run(ctx) {
    const notes: string[] = [];
    const raw = builtinScan(ctx.code);
    const bin = await which("gitleaks", "CODELAUNDRY_GITLEAKS");
    if (bin) {
      raw.push(...(await gitleaksScan(bin, path.basename(ctx.filePath), ctx.code)));
    } else {
      notes.push("gitleaks not installed; built-in secret patterns only");
    }
    // One finding per line; prefer gitleaks' rule naming when both matched.
    const byLine = new Map<number, RawSecret>();
    for (const s of raw.sort((a, b) => Number(a.source === "builtin") - Number(b.source === "builtin"))) {
      if (!byLine.has(s.location.line)) byLine.set(s.location.line, s);
    }
    const findings: Finding[] = [...byLine.values()]
      .sort((a, b) => a.location.line - b.location.line)
      .map((s) =>
        makeFinding({
          ruleId: `secrets/${s.rule}`,
          source: s.source,
          category: "secret",
          severity: "critical",
          message: `Hardcoded secret: ${s.description}. Move it to configuration (e.g. process.env) and rotate it; treat it as leaked.`,
          location: s.location,
          snippet: ctx.code.split("\n")[s.location.line - 1]?.slice(0, 200),
        }),
      );
    return { findings, secrets: raw.map((s) => ({ value: s.value, rule: s.rule })), notes };
  },
};
