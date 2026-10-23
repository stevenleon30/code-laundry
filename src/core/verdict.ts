import type { LaundryConfig } from "./config.js";
import type { Finding, Mode, Verdict } from "./types.js";

export interface VerdictResult {
  verdict: Verdict;
  reasons: string[];
}

/**
 * - reject: any unfixed finding at a rejecting severity, a syntax error, a detected
 *   secret, or a hallucinated dependency (each configurable).
 * - pass:   nothing found.
 * - fixed:  issues were found and none that would reject remain.
 *
 * Unfixed findings below the reject threshold do not block; they stay in `findings`
 * as warnings. With nothing fixed and only such warnings, the verdict is `pass`.
 */
export function computeVerdict(findings: readonly Finding[], config: LaundryConfig, mode: Mode): VerdictResult {
  const t = config.thresholds;
  const rejectSeverities = new Set(mode === "strict" ? [...t.rejectOn, ...t.strictRejectOn] : t.rejectOn);
  const unfixed = findings.filter((f) => !f.fixed);
  const reasons: string[] = [];

  if (t.rejectOnSyntaxError && unfixed.some((f) => f.category === "syntax")) reasons.push("syntax error");
  // A secret is never "fixed" by laundering: it has already leaked into generated code.
  if (t.rejectOnSecret && findings.some((f) => f.category === "secret")) reasons.push("secret detected");
  if (t.rejectOnHallucinatedDependency && unfixed.some((f) => f.category === "hallucinated-dependency")) {
    reasons.push("hallucinated dependency");
  }
  const blocking = unfixed.filter((f) => rejectSeverities.has(f.severity));
  if (blocking.length > 0) {
    const bySev = new Map<string, number>();
    for (const f of blocking) bySev.set(f.severity, (bySev.get(f.severity) ?? 0) + 1);
    reasons.push(`unfixed ${[...bySev].map(([s, n]) => `${n} ${s}`).join(", ")} finding(s)`);
  }

  if (reasons.length > 0) return { verdict: "reject", reasons };
  if (findings.length === 0) return { verdict: "pass", reasons: ["no findings"] };
  const fixedCount = findings.filter((f) => f.fixed).length;
  if (fixedCount === 0) {
    return { verdict: "pass", reasons: [`${unfixed.length} non-blocking warning(s)`] };
  }
  const tail = unfixed.length > 0 ? `; ${unfixed.length} non-blocking warning(s) remain` : "";
  return { verdict: "fixed", reasons: [`${fixedCount} finding(s) fixed${tail}`] };
}
