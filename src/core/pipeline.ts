import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { type LaundryConfig, loadConfig, matchesPattern } from "./config.js";
import { unifiedDiff } from "./diff.js";
import { Redactor } from "./redact.js";
import { resolveModule } from "./registry.js";
import { type Detected, makeFinding, type Stage, type StageContext, type StageKind, VERIFY_KINDS } from "./stage.js";
import type { Finding, Language, LaunderResult, Mode, StageRun } from "./types.js";
import { computeVerdict } from "./verdict.js";

export interface LaunderInput {
  code: string;
  language?: Language;
  filename?: string;
  projectRoot?: string;
  configPath?: string;
  mode: Mode;
  /** Pre-loaded config; skips reading .codelaundry.json. */
  config?: LaundryConfig;
  signal?: AbortSignal;
}

export class UnsupportedLanguageError extends Error {}

const VIRTUAL_ROOT = path.join(os.tmpdir(), "codelaundry-virtual");

/** Where tools "see" the file. Never written to. Clamped inside projectRoot. */
export function virtualPath(filename: string, projectRoot: string | undefined): string {
  if (!projectRoot) return path.join(VIRTUAL_ROOT, path.basename(filename));
  const resolved = path.resolve(projectRoot, filename);
  const rel = path.relative(projectRoot, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return path.join(projectRoot, path.basename(filename));
  return resolved;
}

export interface StageRunContext {
  config: LaundryConfig;
  mode: Mode;
  filePath: string;
  projectRoot?: string;
  detected: Detected;
  signal?: AbortSignal;
  redactor: Redactor;
}

export interface StagesResult {
  code: string;
  findings: Finding[];
  stagesRun: StageRun[];
  fatal: boolean;
}

const UNAVAILABLE_IS_BLOCKING_IN_STRICT: readonly StageKind[] = ["security", "deps"];

function isEnabled(stage: Stage, config: LaundryConfig): boolean {
  return config.stages[stage.id] ?? stage.defaultEnabled;
}

function applyConfig(findings: Finding[], config: LaundryConfig): Finding[] {
  return findings
    .filter((f) => !matchesPattern(f.ruleId, config.ignoreRules))
    .map((f) => {
      const sev = config.severityOverrides[f.ruleId];
      return sev ? { ...f, severity: sev } : f;
    });
}

interface OneResult {
  run: StageRun;
  findings: Finding[];
  code?: string;
  fatal: boolean;
}

async function runOne(stage: Stage, rc: StageRunContext, code: string, allowFix: boolean): Promise<OneResult> {
  const t = performance.now();
  const done = (r: Omit<StageRun, "id" | "durationMs">, findings: Finding[] = [], extra: Partial<OneResult> = {}): OneResult => ({
    run: { id: stage.id, durationMs: Math.round(performance.now() - t), ...r },
    findings,
    fatal: false,
    ...extra,
  });

  if (!isEnabled(stage, rc.config)) return done({ status: "skipped", reason: "disabled by config", findings: 0, changedCode: false });
  const avail = await stage.available();
  if (!avail.ok) {
    return done({ status: "skipped", reason: avail.reason, findings: 0, changedCode: false }, unavailableFinding(stage, avail.reason, rc.mode));
  }
  const ctx: StageContext = {
    code,
    filePath: rc.filePath,
    ...(rc.projectRoot ? { projectRoot: rc.projectRoot } : {}),
    mode: rc.mode,
    allowFix: allowFix && stage.canFix,
    config: rc.config,
    detected: rc.detected,
    ...(rc.signal ? { signal: rc.signal } : {}),
  };
  try {
    const out = await stage.run(ctx);
    for (const s of out.secrets ?? []) rc.redactor.add(s.value, s.rule);
    const notes = out.notes?.length ? { notes: out.notes } : {};
    if (out.skipped) {
      return done({ status: "skipped", reason: out.skipped, findings: 0, changedCode: false, ...notes }, unavailableFinding(stage, out.skipped, rc.mode));
    }
    const findings = applyConfig(out.findings, rc.config);
    const changed = ctx.allowFix && out.code !== undefined && out.code !== code;
    return done({ status: "ran", findings: findings.length, changedCode: changed, ...notes }, findings, {
      ...(changed && out.code !== undefined ? { code: out.code } : {}),
      fatal: Boolean(out.fatal),
    });
  } catch (err) {
    const reason = `stage error: ${(err as Error).message.split("\n")[0]}`;
    return done({ status: "failed", reason, findings: 0, changedCode: false }, unavailableFinding(stage, reason, rc.mode));
  }
}

/** Analysis-only stages after the parse can run concurrently on the same code. */
const parallelizable = (s: Stage) => !s.canFix && s.kind !== "parse";

/**
 * Run stages in order, threading code through fixing stages. Consecutive
 * analysis-only stages run in parallel. Used for the main pass and, with
 * allowFix=false, for re-verification.
 */
export async function runStages(stages: readonly Stage[], rc: StageRunContext, code: string, allowFix: boolean): Promise<StagesResult & { changedAfterAnalysis: boolean }> {
  const findings: Finding[] = [];
  const stagesRun: StageRun[] = [];
  let current = code;
  let fatal = false;
  let analysisRan = false;
  let changedAfterAnalysis = false;
  const applicable = stages.filter((s) => s.languages.includes(rc.detected.language));

  for (let i = 0; i < applicable.length; ) {
    const stage = applicable[i] as Stage;
    const batch = [stage];
    if (parallelizable(stage)) while (i + batch.length < applicable.length && parallelizable(applicable[i + batch.length] as Stage)) batch.push(applicable[i + batch.length] as Stage);
    i += batch.length;

    if (fatal) {
      for (const s of batch) stagesRun.push({ id: s.id, status: "skipped", reason: "not run: input has syntax errors", durationMs: 0, findings: 0, changedCode: false });
      continue;
    }
    const results = await Promise.all(batch.map((s) => runOne(s, rc, current, allowFix)));
    for (const [j, r] of results.entries()) {
      stagesRun.push(r.run);
      findings.push(...r.findings);
      if (r.code !== undefined) {
        current = r.code;
        if (analysisRan) changedAfterAnalysis = true;
      }
      if (r.fatal) fatal = true;
      if (r.run.status === "ran" && !(batch[j] as Stage).canFix && (batch[j] as Stage).kind !== "parse") analysisRan = true;
    }
  }
  return { code: current, findings, stagesRun, fatal, changedAfterAnalysis };
}

/** A missing security/deps tool must never look like a clean result in strict mode. */
function unavailableFinding(stage: Stage, reason: string, mode: Mode): Finding[] {
  if (mode !== "strict" || !UNAVAILABLE_IS_BLOCKING_IN_STRICT.includes(stage.kind)) return [];
  return [
    makeFinding({
      ruleId: "laundry/stage-unavailable",
      source: "code-laundry",
      category: "pipeline",
      severity: "high",
      message: `Required stage ${stage.id} did not run in strict mode: ${reason}`,
    }),
  ];
}

export interface PreparedRun {
  rc: StageRunContext;
  stages: readonly Stage[];
  language: Language;
  filename: string;
  detectRun: StageRun;
}

export async function prepare(input: LaunderInput): Promise<PreparedRun> {
  const config = input.config ?? (await loadConfig({ ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}), ...(input.configPath ? { configPath: input.configPath } : {}) }));
  const resolved = resolveModule(input.code, input.filename, input.language);
  if (!resolved) {
    throw new UnsupportedLanguageError(`Unsupported language for ${input.filename ?? "input"} (supported: typescript, javascript)`);
  }
  const { module, language } = resolved;
  let filename = input.filename ?? module.defaultFilename(language, input.code);
  if (!path.extname(filename)) filename += path.extname(module.defaultFilename(language, input.code));
  const projectRoot = input.projectRoot ? path.resolve(input.projectRoot) : undefined;
  const filePath = virtualPath(filename, projectRoot);

  const t = performance.now();
  const detected = await module.detect(input.code, filePath, language, projectRoot);
  const detectRun: StageRun = {
    id: `${module.id}.detect`,
    status: "ran",
    durationMs: Math.round(performance.now() - t),
    findings: 0,
    changedCode: false,
    notes: [
      `language=${language}${detected.jsx ? " (jsx)" : ""}`,
      ...(detected.frameworks.length ? [`frameworks=${detected.frameworks.join(",")}`] : []),
      ...Object.entries(detected.projectConfigs).map(([k, v]) => `${k}=${v}`),
    ],
  };
  return {
    rc: {
      config,
      mode: input.mode,
      filePath,
      ...(projectRoot ? { projectRoot } : {}),
      detected,
      ...(input.signal ? { signal: input.signal } : {}),
      redactor: new Redactor(),
    },
    stages: module.stages,
    language,
    filename,
    detectRun,
  };
}

const VERIFY_KINDS_SET = new Set<StageKind>(VERIFY_KINDS);

/** Run the analysis stages (no fixing) on `code`. Used after fixes and by the repair loop. */
export function reverify(prep: PreparedRun, code: string): Promise<StagesResult> {
  return runStages(
    prep.stages.filter((s) => VERIFY_KINDS_SET.has(s.kind)),
    prep.rc,
    code,
    false,
  );
}

export async function launder(input: LaunderInput): Promise<LaunderResult> {
  const t0 = performance.now();
  const prep = await prepare(input);
  const { rc } = prep;
  const allowFix = input.mode !== "check";

  const main = await runStages(prep.stages, rc, input.code, allowFix);
  let findings = main.findings;
  const stagesRun = [prep.detectRun, ...main.stagesRun];
  let cleanedCode = allowFix ? main.code : input.code;

  // A fix applied after analysis stages ran makes their locations stale: re-verify the final code.
  if (allowFix && main.changedAfterAnalysis) {
    const verify = await reverify(prep, cleanedCode);
    stagesRun.push(...verify.stagesRun.map((s) => ({ ...s, id: `verify:${s.id}` })));
    if (verify.fatal) {
      // Deterministic fixers should never break the code; if one did, keep the input.
      const fallback = await runStages(prep.stages, rc, input.code, false);
      cleanedCode = input.code;
      findings = fallback.findings;
      stagesRun.push({ id: "laundry.revert", status: "ran", durationMs: 0, findings: 0, changedCode: false, notes: ["autofix produced unparseable code; reverted to input"] });
    } else {
      findings = [...main.findings.filter((f) => f.fixed), ...verify.findings];
    }
  }

  const { verdict, reasons } = computeVerdict(findings, rc.config, input.mode);
  const notRun = stagesRun.filter((s) => s.status !== "ran" && s.reason !== "disabled by config");
  if (notRun.length > 0) reasons.push(`${notRun.length} stage(s) skipped or failed: ${notRun.map((s) => s.id).join(", ")}`);

  const r = rc.redactor;
  return {
    verdict,
    verdictReasons: reasons.map((x) => r.redact(x)),
    language: prep.language,
    cleanedCode: r.redact(cleanedCode),
    findings: findings.map((f) => ({
      ...f,
      message: r.redact(f.message),
      ...(f.snippet !== undefined ? { snippet: r.redact(f.snippet) } : {}),
    })),
    diff: r.redact(unifiedDiff(input.code, cleanedCode, prep.filename)),
    stagesRun,
    durationMs: Math.round(performance.now() - t0),
  };
}
