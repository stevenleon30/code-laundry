/**
 * Eval runner: precision, recall, false-positive rate and repair success over the
 * labeled golden set in evals/cases. Exits 1 if thresholds.json is not met.
 *
 *   pnpm evals                 detection + repair
 *   pnpm evals --no-repair     detection only
 *   pnpm evals --filter sqli   only cases whose id contains "sqli"
 *   pnpm evals --json          machine-readable summary on stdout
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { which } from "../src/core/exec.js";
import { launder } from "../src/core/pipeline.js";
import { severityRank, type Finding, type LaunderResult } from "../src/core/types.js";
import { materializeSecrets } from "./synthetic-secrets.js";

const EVALS_DIR = path.dirname(fileURLToPath(import.meta.url));
// Registry lookups come from a recorded fixture so results don't depend on the network.
process.env.CODELAUNDRY_DEPS_FIXTURE ??= path.join(EVALS_DIR, "deps-fixture.json");

interface EvalCase {
  id: string;
  category: string;
  description: string;
  file: string;
  /** Rule patterns: `a|b` alternatives, trailing `*` = prefix. Each must match a distinct finding. */
  expect: string[];
  /** Extra findings that are acceptable (neither true nor false positives). */
  allow: string[];
  repairable: boolean;
  /** Written without running the tool on it first; reported separately, never tuned against. */
  holdout?: boolean;
}

interface Thresholds {
  minRecall: number;
  minPrecision: number;
  maxFalsePositiveRate: number;
  minRepairSuccess: number | null;
}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function matches(ruleId: string, pattern: string): boolean {
  return pattern.split("|").some((p) => (p.endsWith("*") ? ruleId.startsWith(p.slice(0, -1)) : ruleId === p));
}

/** Findings that count for precision: medium+ severity, excluding pipeline/format noise. */
const scored = (f: Finding) => severityRank[f.severity] >= severityRank.medium && f.category !== "pipeline" && f.category !== "format";

interface CaseResult {
  id: string;
  category: string;
  holdout: boolean;
  expected: number;
  matched: number;
  missed: string[];
  falsePositives: string[];
  verdict: string;
  repair?: { success: boolean; verdict: string; remaining: string[] };
  durationMs: number;
}

function score(c: EvalCase, r: LaunderResult): Pick<CaseResult, "matched" | "missed" | "falsePositives"> {
  const pool = r.findings.filter((f) => !f.fixed);
  const used = new Set<string>();
  const missed: string[] = [];
  for (const exp of c.expect) {
    const hit = pool.find((f) => !used.has(f.id) && matches(f.ruleId, exp));
    if (hit) used.add(hit.id);
    else missed.push(exp);
  }
  const falsePositives = pool
    // Extra instances of an expected rule (three `any`s when one is labeled) aren't false positives.
    .filter((f) => !used.has(f.id) && scored(f) && ![...c.allow, ...c.expect].some((a) => matches(f.ruleId, a)))
    .map((f) => `${f.ruleId}@${f.location?.line ?? "-"} (${f.severity})`);
  return { matched: c.expect.length - missed.length, missed, falsePositives };
}

async function loadCases(): Promise<EvalCase[]> {
  const dir = path.join(EVALS_DIR, "cases");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const cases = await Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(dir, f), "utf8")) as EvalCase));
  const filter = opt("--filter");
  return filter ? cases.filter((c) => c.id.includes(filter)) : cases;
}

async function runCase(c: EvalCase, withRepair: boolean): Promise<CaseResult> {
  const t = performance.now();
  const code = materializeSecrets(await readFile(path.join(EVALS_DIR, "cases", c.file), "utf8"));
  const detection = await launder({ code, filename: c.file, mode: "check" });
  const res: CaseResult = { id: c.id, category: c.category, holdout: Boolean(c.holdout), expected: c.expect.length, verdict: detection.verdict, ...score(c, detection), durationMs: 0 };
  if (withRepair && c.repairable) {
    const fixed = await launder({ code, filename: c.file, mode: "fix" });
    const remaining = fixed.findings.filter((f) => !f.fixed && c.expect.some((e) => matches(f.ruleId, e))).map((f) => f.ruleId);
    res.repair = { success: fixed.verdict !== "reject" && remaining.length === 0, verdict: fixed.verdict, remaining };
  }
  res.durationMs = Math.round(performance.now() - t);
  return res;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i] as T);
      }
    }),
  );
  return out;
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

async function main(): Promise<number> {
  const thresholds = JSON.parse(await readFile(path.join(EVALS_DIR, "thresholds.json"), "utf8")) as Thresholds;
  const withRepair = !flag("--no-repair");
  const cases = await loadCases();
  const missingTools = (await Promise.all(["semgrep", "gitleaks", "osv-scanner"].map(async (t) => ((await which(t)) ? undefined : t)))).filter(Boolean);
  if (missingTools.length) console.error(`warning: not installed: ${missingTools.join(", ")}; related cases will miss`);
  if (withRepair && !process.env.ANTHROPIC_API_KEY) console.error("note: ANTHROPIC_API_KEY not set; repair success reflects deterministic autofix only");

  const t0 = performance.now();
  const results = await mapLimit(cases, 4, (c) => runCase(c, withRepair));
  const bad = results.filter((r) => r.category !== "clean");
  const clean = results.filter((r) => r.category === "clean");

  const expected = bad.reduce((n, r) => n + r.expected, 0);
  const matched = bad.reduce((n, r) => n + r.matched, 0);
  const fps = results.reduce((n, r) => n + r.falsePositives.length, 0);
  const recall = expected ? matched / expected : 1;
  const precision = matched + fps ? matched / (matched + fps) : 1;
  const flaggedClean = clean.filter((r) => r.falsePositives.length > 0 || r.verdict === "reject");
  const fpr = clean.length ? flaggedClean.length / clean.length : 0;
  const repairable = results.filter((r) => r.repair);
  const repaired = repairable.filter((r) => r.repair?.success);
  const repairRate = repairable.length ? repaired.length / repairable.length : null;

  const ho = results.filter((r) => r.holdout);
  const hoBad = ho.filter((r) => r.category !== "clean");
  const hoExpected = hoBad.reduce((n, r) => n + r.expected, 0);
  const hoMatched = hoBad.reduce((n, r) => n + r.matched, 0);
  const hoFps = ho.reduce((n, r) => n + r.falsePositives.length, 0);
  const holdout = ho.length
    ? { cases: ho.length, recall: hoExpected ? hoMatched / hoExpected : 1, precision: hoMatched + hoFps ? hoMatched / (hoMatched + hoFps) : 1 }
    : undefined;

  const byCategory = new Map<string, { cases: number; expected: number; matched: number }>();
  for (const r of bad) {
    const e = byCategory.get(r.category) ?? { cases: 0, expected: 0, matched: 0 };
    e.cases++;
    e.expected += r.expected;
    e.matched += r.matched;
    byCategory.set(r.category, e);
  }

  const checks = [
    { name: "recall", value: recall, ok: recall >= thresholds.minRecall, limit: `>= ${pct(thresholds.minRecall)}` },
    { name: "precision", value: precision, ok: precision >= thresholds.minPrecision, limit: `>= ${pct(thresholds.minPrecision)}` },
    { name: "false-positive rate", value: fpr, ok: fpr <= thresholds.maxFalsePositiveRate, limit: `<= ${pct(thresholds.maxFalsePositiveRate)}` },
    ...(thresholds.minRepairSuccess !== null && repairRate !== null
      ? [{ name: "repair success", value: repairRate, ok: repairRate >= thresholds.minRepairSuccess, limit: `>= ${pct(thresholds.minRepairSuccess)}` }]
      : []),
  ];

  const summary = {
    cases: { bad: bad.length, clean: clean.length },
    expectedFindings: expected,
    recall,
    precision,
    falsePositiveRate: fpr,
    repairSuccessRate: repairRate,
    holdout,
    repairMode: process.env.ANTHROPIC_API_KEY ? "tools+llm" : "tools-only",
    durationMs: Math.round(performance.now() - t0),
    byCategory: Object.fromEntries(byCategory),
    checks,
    results,
  };
  await mkdir(path.join(EVALS_DIR, "results"), { recursive: true });
  await writeFile(path.join(EVALS_DIR, "results", "latest.json"), JSON.stringify(summary, null, 2));

  if (flag("--json")) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`\nCode Laundry evals: ${bad.length} bad cases (${expected} expected findings), ${clean.length} clean controls\n`);
    console.log("category              cases  recall");
    for (const [cat, e] of [...byCategory].sort()) console.log(`${cat.padEnd(22)}${String(e.cases).padStart(5)}  ${pct(e.matched / e.expected).padStart(6)}`);
    const misses = bad.filter((r) => r.missed.length);
    if (misses.length) {
      console.log("\nmissed:");
      for (const r of misses) console.log(`  ${r.id}: ${r.missed.join(", ")}`);
    }
    const withFp = results.filter((r) => r.falsePositives.length);
    if (withFp.length) {
      console.log("\nfalse positives (medium+, not expected or allowed):");
      for (const r of withFp) console.log(`  ${r.id}: ${r.falsePositives.join(", ")}`);
    }
    if (flaggedClean.length) console.log(`\nclean controls flagged: ${flaggedClean.map((r) => `${r.id} (${r.verdict})`).join(", ")}`);
    const failedRepairs = repairable.filter((r) => !r.repair?.success);
    if (withRepair && failedRepairs.length) {
      console.log(`\nnot repaired (${summary.repairMode}): ${failedRepairs.map((r) => r.id).join(", ")}`);
    }
    console.log("\nmetric                value     threshold");
    console.log(`recall                ${pct(recall).padStart(6)}    >= ${pct(thresholds.minRecall)}`);
    console.log(`precision             ${pct(precision).padStart(6)}    >= ${pct(thresholds.minPrecision)}`);
    console.log(`false-positive rate   ${pct(fpr).padStart(6)}    <= ${pct(thresholds.maxFalsePositiveRate)}`);
    if (repairRate !== null) {
      console.log(`repair success        ${pct(repairRate).padStart(6)}    ${thresholds.minRepairSuccess === null ? "(report only)" : `>= ${pct(thresholds.minRepairSuccess)}`}  [${summary.repairMode}]`);
    }
    if (holdout) console.log(`\nheld-out subset (${holdout.cases} cases): recall ${pct(holdout.recall)}, precision ${pct(holdout.precision)}`);
    console.log(`\n${results.length} cases in ${(summary.durationMs / 1000).toFixed(1)}s`);
  }

  const failed = checks.filter((c) => !c.ok);
  if (failed.length) {
    console.error(`\nFAIL: ${failed.map((c) => `${c.name} ${pct(c.value)} (needs ${c.limit})`).join("; ")}`);
    return 1;
  }
  console.error("\nPASS");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(2);
  },
);
