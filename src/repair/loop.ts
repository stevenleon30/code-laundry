import { performance } from "node:perf_hooks";
import type { PreparedRun, StagesResult } from "../core/pipeline.js";
import type { Stage } from "../core/stage.js";
import { type Finding, severityRank, type StageRun } from "../core/types.js";
import { explanationFor } from "../explain/kb.js";
import { getRepairClient, type RepairClient } from "./llm.js";
import { allowedWindows, applyEdits, numbered } from "./patch.js";

/** Categories the LLM is never asked to fix. Secrets are never sent to it at all. */
const NOT_REPAIRABLE = new Set(["syntax", "secret", "pipeline", "format", "hallucinated-dependency", "dependency"]);

export const isRepairable = (f: Finding) => !f.fixed && f.location !== undefined && !NOT_REPAIRABLE.has(f.category);

/** Lower is better: blocking findings dominate, then everything else by severity. */
function score(findings: readonly Finding[]): number {
  return findings.filter((f) => !f.fixed).reduce((n, f) => n + (severityRank[f.severity] >= severityRank.high ? 1000 : severityRank[f.severity]), 0);
}

export interface RepairOutcome {
  code: string;
  findings: Finding[];
  run: StageRun;
}

export interface RepairDeps {
  /** Fixing stages (format, lint) applied to each candidate before verification. */
  fixers: readonly Stage[];
  runStages: (stages: readonly Stage[], code: string, allowFix: boolean) => Promise<StagesResult>;
  reverify: (code: string) => Promise<StagesResult>;
}

/**
 * LLM repair: send only the flagged ranges (plus context) to the model, apply its
 * range-checked edits, re-run the deterministic stages, and keep the result only if
 * the findings got better. At most `maxIterations` rounds; stops when nothing improves.
 */
export async function repairLoop(prep: PreparedRun, code: string, findings: Finding[], deps: RepairDeps): Promise<RepairOutcome | undefined> {
  const { config } = prep.rc;
  if (config.stages.repair === false) return undefined;
  if (!findings.some(isRepairable)) return undefined;
  const t = performance.now();
  const done = (status: StageRun["status"], notes: string[], reason?: string): StageRun => ({
    id: "repair",
    status,
    durationMs: Math.round(performance.now() - t),
    findings: 0,
    changedCode: false,
    ...(reason ? { reason } : {}),
    ...(notes.length ? { notes } : {}),
  });

  const { client, reason } = getRepairClient(config.repair.model);
  if (!client) return { code, findings, run: done("skipped", [], reason) };

  const notes: string[] = [];
  let best = { code, findings, score: score(findings) };
  for (let i = 1; i <= config.repair.maxIterations; i++) {
    const targets = best.findings.filter(isRepairable);
    if (targets.length === 0) break;
    const attempt = await attemptOnce(client, prep, best.code, targets, notes, i);
    if (!attempt) break;
    const fixed = await deps.runStages(deps.fixers, attempt, true);
    const verify = await deps.reverify(fixed.code);
    if (verify.fatal) {
      notes.push(`round ${i}: repair produced unparseable code; discarded`);
      break;
    }
    const s = score(verify.findings);
    if (s >= best.score) {
      notes.push(`round ${i}: findings did not decrease (${best.score} → ${s}); discarded`);
      break;
    }
    notes.push(`round ${i}: score ${best.score} → ${s}`);
    best = { code: fixed.code, findings: verify.findings, score: s };
  }

  if (best.code === code) return { code, findings, run: { ...done("ran", notes), findings: 0 } };

  // Findings present before repair and gone after it are marked fixed by the LLM.
  const after = new Map<string, number>();
  for (const f of best.findings) after.set(f.ruleId, (after.get(f.ruleId) ?? 0) + 1);
  const resolved: Finding[] = [];
  const before = new Map<string, Finding[]>();
  for (const f of findings.filter((x) => !x.fixed)) before.set(f.ruleId, [...(before.get(f.ruleId) ?? []), f]);
  for (const [ruleId, list] of before) {
    const n = Math.max(0, list.length - (after.get(ruleId) ?? 0));
    for (const f of list.slice(0, n)) resolved.push({ ...f, fixed: true, fixedBy: "llm" });
  }
  const merged = [...findings.filter((f) => f.fixed), ...resolved, ...best.findings];
  return { code: best.code, findings: merged, run: { ...done("ran", notes), findings: resolved.length, changedCode: true } };
}

async function attemptOnce(client: RepairClient, prep: PreparedRun, code: string, targets: Finding[], notes: string[], round: number): Promise<string | undefined> {
  const lineCount = code.split("\n").length;
  const windows = allowedWindows(
    targets.map((f) => ({ startLine: f.location?.line ?? 1, endLine: f.location?.endLine ?? f.location?.line ?? 1 })),
    prep.rc.config.repair.contextLines,
    lineCount,
  );
  const r = prep.rc.redactor;
  let edits;
  try {
    edits = await client.proposeEdits({
      filename: prep.filename,
      language: prep.language,
      // Redaction is a backstop: secret findings are never targets, but a window may still contain one.
      windows: windows.map((w) => ({ ...w, text: r.redact(numbered(code, w)) })),
      findings: targets.map((f) => ({
        id: f.id,
        ruleId: f.ruleId,
        severity: f.severity,
        message: r.redact(f.message),
        line: f.location?.line ?? 1,
        guidance: explanationFor(f.ruleId, f.category).fix,
      })),
    });
  } catch (err) {
    notes.push(`round ${round}: ${client.id} failed: ${(err as Error).message.split("\n")[0]}`);
    return undefined;
  }
  // Never let a redaction placeholder leak into code.
  const usable = edits.edits.filter((e) => !e.replacement.includes("[REDACTED:"));
  const result = applyEdits(code, usable, windows);
  for (const rej of result.rejected) notes.push(`round ${round}: rejected edit ${rej.edit.startLine}-${rej.edit.endLine}: ${rej.reason}`);
  if (edits.unfixable.length) notes.push(`round ${round}: model marked ${edits.unfixable.length} finding(s) unfixable`);
  if (result.applied === 0) {
    notes.push(`round ${round}: no applicable edits`);
    return undefined;
  }
  return result.code;
}
