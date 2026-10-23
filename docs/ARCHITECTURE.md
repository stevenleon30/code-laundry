# Code Laundry — Architecture

## Purpose
Agents submit generated code (string, file, or diff). Code Laundry runs deterministic
tools first, optionally asks an LLM to repair what tools can't, **re-verifies**, and
returns `{ verdict, cleanedCode, findings[], diff, stagesRun[], durationMs }`.

## Layout
```
src/
  core/
    types.ts        Zod schemas: Finding, Severity, StageResult, LaunderRequest/Result
    stage.ts        Stage interface + StageContext
    pipeline.ts     Orchestrator: runs enabled stages in order, threads code through
    registry.ts     language -> ordered Stage[]   (the only place languages plug in)
    verdict.ts      pass / fixed / reject from findings + thresholds
    config.ts       .codelaundry.json loader (Zod), defaults, merge
    workspace.ts    temp dir per run; copies code + resolved project configs
    exec.ts         safe subprocess wrapper (no shell, timeout, output cap, env scrub)
    redact.ts       secret redaction applied to every finding/message/diff
    diff.ts         unified diff (jsdiff)
  stages/
    shared/         detect, secrets (gitleaks + builtin fallback), repair, sandbox-test (stub)
    typescript/     parse, format, lint, typecheck, semgrep, deps, slop
    (python/       future: ruff, mypy, bandit — no core change needed)
  deps/
    npm-registry.ts existence, publish date, deprecation, typosquat (edit distance vs top-N list)
    osv.ts          vuln lookup
  repair/
    llm.ts          Anthropic client (model from CODELAUNDRY_MODEL)
    patch.ts        range-restricted patch application
  mcp/server.ts     stdio MCP server: launder_code, check_dependencies, explain_findings
  cli/index.ts      `codelaundry check|fix <file>`
evals/
  cases/*.json      40+ labeled snippets
  run.ts            precision / recall / FPR / repair-success; exits non-zero below threshold
```

## Stage interface
```ts
interface Stage {
  id: string;                          // "ts.lint"
  kind: "detect"|"parse"|"format"|"lint"|"typecheck"|"security"|"deps"|"slop"|"repair"|"test";
  languages: Language[];
  canFix: boolean;
  available(ctx): Promise<{ ok: boolean; reason?: string }>;  // tool installed?
  run(ctx: StageContext): Promise<StageResult>;   // { code?, findings[], skipped?, error? }
}
```
- Stages are pure w.r.t. host: they read `ctx.code`, write only inside `ctx.workspace`.
- A stage that *fixes* returns new `code`; pipeline threads it forward and marks the
  findings it resolved as `fixed: true`.
- **Missing tool ⇒ explicit `skipped` entry in `stagesRun` with reason**, never silent.
  In `strict` mode a skipped security stage is itself a `high` finding (`laundry/stage-unavailable`).

## Finding
`{ id, ruleId, source (tool), severity: critical|high|medium|low, message, location {line,col,endLine,endCol}, fixed, fixable, category, snippet? (redacted) }`

## Pipeline flow
1. detect → 2. parse (bail on syntax error ⇒ reject) → 3. format → 4. lint+autofix →
5. typecheck → 6. security (semgrep + secrets) → 7. deps → 8. slop heuristics →
9. repair loop (fix/strict only) → 10. report.

Modes: `check` = no mutations; `cleanedCode` is the original, findings only.
`fix` = tool autofix + LLM repair. `strict` = fix, plus unavailable security/deps tools
and medium findings escalate to reject.

## Repair loop
- Inputs: remaining unfixed findings; for each, a window of ±N lines around the range.
- LLM returns JSON `{ edits: [{ startLine, endLine, replacement }] }` (Zod-validated).
- `patch.ts` rejects any edit whose range isn't inside a flagged (padded) window.
- After applying: re-run stages 2–8. Stop when: no findings, iteration == max (default 3),
  or finding count didn't decrease (revert to previous best).
- Prompt treats code as data: wrapped in delimiters, system prompt states embedded
  instructions must be ignored; output is structured, never free-form code.
- No API key ⇒ repair stage `skipped` with reason; verdict computed from what remains.

## Verdict
Configurable `rejectOn: { severities: ["critical","high"], syntaxError, secret, hallucinatedDep }`.
- reject: any unfixed finding matching rejectOn
- fixed: findings existed and every one at/above the configurable `fixedRequires` severity (default: all) is resolved
- pass: no findings

## Safety
- Submitted code is never executed. Tools only parse/analyze it. `tsc`/eslint run with
  plugin/config loading restricted to our bundled config unless `projectRoot` is given
  (project configs are loaded from the caller's own trusted repo).
- Subprocess: `execFile` (no shell), timeouts, max buffer, cwd = temp workspace.
- Secrets: values replaced with `[REDACTED:<rule>]` in findings, snippets, diff, logs.
  v1: a detected secret forces reject, and the secret is redacted in `cleanedCode` too.
- Sandbox test stage: interface + stub returning `skipped: "not implemented (v1)"`.

## Config (.codelaundry.json)
```json
{ "stages": { "ts.semgrep": true, "repair": true },
  "thresholds": { "rejectOn": ["critical","high"] },
  "ignoreRules": ["slop/console-log"],
  "allowedPackages": ["@internal/*"],
  "repair": { "maxIterations": 3, "model": "..." },
  "deps": { "minWeeklyDownloads": 500, "minAgeDays": 30 } }
```

## Adding a language
Add `src/stages/python/*.ts` (ruff format/lint, mypy, bandit, PyPI deps) and register
them in `registry.ts` under `"python"`. Core, verdict, repair, MCP and CLI are unchanged.
