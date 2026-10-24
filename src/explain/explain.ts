import { z } from "zod";
import { Category, Location, Severity, severityRank } from "../core/types.js";
import { explanationFor } from "./kb.js";

export const ExplainInputFinding = z.object({
  ruleId: z.string(),
  message: z.string(),
  severity: Severity,
  category: Category.optional(),
  location: Location.optional(),
  fixed: z.boolean().optional(),
});

export const ExplainedFinding = z.object({
  ruleId: z.string(),
  severity: Severity,
  location: Location.optional(),
  title: z.string(),
  message: z.string(),
  why: z.string(),
  howToFix: z.string(),
  fixed: z.boolean(),
});

export const ExplainResult = z.object({
  summary: z.string(),
  explanations: z.array(ExplainedFinding),
});
export type ExplainResult = z.infer<typeof ExplainResult>;

export function explainFindings(findings: z.infer<typeof ExplainInputFinding>[]): ExplainResult {
  const sorted = [...findings].sort(
    (a, b) => Number(a.fixed ?? false) - Number(b.fixed ?? false) || severityRank[b.severity] - severityRank[a.severity],
  );
  const explanations = sorted.map((f) => {
    const e = explanationFor(f.ruleId, f.category);
    return {
      ruleId: f.ruleId,
      severity: f.severity,
      ...(f.location ? { location: f.location } : {}),
      title: e.title,
      message: f.message,
      why: e.why,
      howToFix: e.fix,
      fixed: f.fixed ?? false,
    };
  });
  const open = explanations.filter((e) => !e.fixed);
  const blocking = open.filter((e) => e.severity === "critical" || e.severity === "high");
  const summary =
    findings.length === 0
      ? "No findings."
      : `${open.length} open finding(s), ${blocking.length} critical/high; ${findings.length - open.length} already fixed. ` +
        (blocking.length > 0
          ? `Fix first: ${[...new Set(blocking.map((b) => b.title))].join("; ")}.`
          : "Nothing blocking remains.");
  return { summary, explanations };
}
