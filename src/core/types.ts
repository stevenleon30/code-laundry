import { z } from "zod";

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export const Severity = z.enum(SEVERITIES);
export type Severity = z.infer<typeof Severity>;

export const severityRank: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export const Language = z.enum(["typescript", "javascript"]);
export type Language = z.infer<typeof Language>;

export const Mode = z.enum(["check", "fix", "strict"]);
export type Mode = z.infer<typeof Mode>;

export const Category = z.enum([
  "syntax",
  "format",
  "lint",
  "type",
  "security",
  "secret",
  "dependency",
  "hallucinated-dependency",
  "slop",
  "pipeline",
]);
export type Category = z.infer<typeof Category>;

export const Location = z.object({
  line: z.number().int().min(1),
  column: z.number().int().min(1),
  endLine: z.number().int().min(1).optional(),
  endColumn: z.number().int().min(1).optional(),
});
export type Location = z.infer<typeof Location>;

export const Finding = z.object({
  id: z.string(),
  ruleId: z.string(),
  source: z.string().describe("Tool or stage that produced the finding"),
  category: Category,
  severity: Severity,
  message: z.string(),
  location: Location.optional(),
  fixable: z.boolean(),
  fixed: z.boolean(),
  fixedBy: z.enum(["tool", "llm"]).optional(),
  snippet: z.string().optional(),
});
export type Finding = z.infer<typeof Finding>;

export const StageStatus = z.enum(["ran", "skipped", "failed"]);

export const StageRun = z.object({
  id: z.string(),
  status: StageStatus,
  reason: z.string().optional(),
  durationMs: z.number(),
  findings: z.number().int(),
  changedCode: z.boolean(),
  notes: z.array(z.string()).optional(),
});
export type StageRun = z.infer<typeof StageRun>;

export const Verdict = z.enum(["pass", "fixed", "reject"]);
export type Verdict = z.infer<typeof Verdict>;

export const LaunderResult = z.object({
  verdict: Verdict,
  verdictReasons: z.array(z.string()),
  language: Language,
  cleanedCode: z.string(),
  findings: z.array(Finding),
  diff: z.string(),
  stagesRun: z.array(StageRun),
  durationMs: z.number(),
});
export type LaunderResult = z.infer<typeof LaunderResult>;
