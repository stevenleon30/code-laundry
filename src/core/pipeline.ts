import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { type LaundryConfig, loadConfig, matchesPattern } from "./config.js";
import { unifiedDiff } from "./diff.js";
import { Redactor } from "./redact.js";
import { resolveModule } from "./registry.js";
import { type Detected, makeFinding, type Stage, type StageContext, type StageKind } from "./stage.js";
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

/**
 * Run stages in order, threading code through fixing stages. Used for the main
 * pass and (with allowFix=false and verify kinds only) for re-verification.
 */
export async function runStages(stages: readonly Stage[], rc: StageRunContext, code: string, allowFix: boolean): Promise<StagesResult> {
  const findings: Finding[] = [];
  const stagesRun: StageRun[] = [];
  let current = code;
  let fatal = false;

  for (const stage of stages) {
    if (!stage.languages.includes(rc.detected.language)) continue;
    const t = performance.now();
    const record = (r: Omit<StageRun, "id" | "durationMs">) =>
      stagesRun.push({ id: stage.id, durationMs: Math.round(performance.now() - t), ...r });

    if (fatal) {
      record({ status: "skipped", reason: "not run: input has syntax errors", findings: 0, changedCode: false });
      continue;
    }
    if (!isEnabled(stage, rc.config)) {
      record({ status: "skipped", reason: "disabled by config", findings: 0, changedCode: false });
      continue;
    }
    const avail = await stage.available();
    if (!avail.ok) {
      record({ status: "skipped", reason: avail.reason, findings: 0, changedCode: false });
      findings.push(...unavailableFinding(stage, avail.reason, rc.mode));
      continue;
    }

    const ctx: StageContext = {
      code: current,
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
      if (out.skipped) {
        record({ status: "skipped", reason: out.skipped, findings: 0, changedCode: false, ...(out.notes?.length ? { notes: out.notes } : {}) });
        findings.push(...unavailableFinding(stage, out.skipped, rc.mode));
        continue;
      }
      const stageFindings = applyConfig(out.findings, rc.config);
      findings.push(...stageFindings);
      const changed = ctx.allowFix && out.code !== undefined && out.code !== current;
      if (changed && out.code !== undefined) current = out.code;
      record({
        status: "ran",
        findings: stageFindings.length,
        changedCode: changed,
        ...(out.notes?.length ? { notes: out.notes } : {}),
      });
      if (out.fatal) fatal = true;
    } catch (err) {
      const reason = `stage error: ${(err as Error).message.split("\n")[0]}`;
      record({ status: "failed", reason, findings: 0, changedCode: false });
      findings.push(...unavailableFinding(stage, reason, rc.mode));
    }
  }
  return { code: current, findings, stagesRun, fatal };
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

export async function launder(input: LaunderInput): Promise<LaunderResult> {
  const t0 = performance.now();
  const prep = await prepare(input);
  const { rc } = prep;
  const allowFix = input.mode !== "check";

  const main = await runStages(prep.stages, rc, input.code, allowFix);
  const findings = main.findings;
  const stagesRun = [prep.detectRun, ...main.stagesRun];
  const cleanedCode = allowFix ? main.code : input.code;

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
