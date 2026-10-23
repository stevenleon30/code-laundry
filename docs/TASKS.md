# Task list (milestone = one commit)

## M1 — Pipeline core + format/lint/typecheck ✅
- [x] pnpm scaffold, strict tsconfig, vitest (ESLint + typescript-eslint + Prettier as deps)
- [x] core: types, stage, pipeline, registry, verdict, config, redact, diff
      (`exec.ts` moves to M3, where the first subprocess tools arrive; no temp workspace needed — see ARCHITECTURE "Virtual file")
- [x] stages: detect, ts.parse, ts.format (Prettier), ts.lint (ESLint autofix + type-aware pass), ts.typecheck (TS compiler API)
- [x] tests: verdict, config, redaction, pipeline (29 tests)

## M2 — MCP wrapper
- [ ] stdio server; launder_code, check_dependencies (stub until M3), explain_findings
- [ ] Zod input/output schemas; integration test via SDK client over stdio

## M3 — Security + dependency stages
- [ ] semgrep stage + bundled rules (injection, eval, path traversal, weak crypto, SSRF)
- [ ] secrets: gitleaks if installed + built-in regex/entropy fallback; redaction everywhere
- [ ] deps: import extraction, npm registry existence/deprecation/age, typosquat, OSV
- [ ] slop heuristics (AST-based): TODO placeholders, empty/broad catch, console.log, fake data, missing await, invented API (check exports against installed package .d.ts when projectRoot given)

## M4 — Eval suite
- [ ] ≥40 labeled cases across all categories + clean controls (for FPR)
- [ ] runner: precision, recall, FPR, repair success; threshold gate

## M5 — Repair loop
- [ ] Anthropic client, structured edits, range guard, re-verify, stop conditions
- [ ] tests with a mocked LLM (incl. out-of-range edit rejection, prompt-injection case)

## M6 — CLI + GitHub Action + README
- [ ] `codelaundry check|fix <file>` (+ `--json`, exit codes)
- [ ] .github/workflows/evals.yml (installs semgrep/gitleaks/osv-scanner, runs evals)
- [ ] README with Claude Code + Claude Desktop MCP config

## Known gaps / environment notes
- TypeScript is pinned to 6.0.x: TS 7 (native) has no stable JS API, and typescript-eslint supports <6.1.
- Fixed-finding attribution for ESLint autofix is by rule count (before vs after), so the
  "fixed" flag is exact per rule but not per individual occurrence.
- Legacy `.eslintrc` configs are not supported (ESLint 10 dropped them); such projects get the bundled config.
- This container lacks **semgrep, gitleaks, osv-scanner, biome**. I'll try `pip install semgrep`
  and fetching gitleaks/osv-scanner binaries; if blocked, those stages report `skipped`
  locally and the GitHub Action installs them for CI.
- **api.osv.dev and api.npmjs.org (download counts) are unreachable** from this sandbox
  (registry.npmjs.org works). OSV/download-count code will be written and unit-tested
  against recorded fixtures, but not live-verified here. Evals will run deps checks
  in an offline mode with fixtures so they're deterministic in CI.
- Using ESLint + typescript-eslint rather than Biome (ESLint/typescript-eslint gives
  type-aware rules like `no-floating-promises` needed for "missing await").
- "Invented API calls" detection only works with `projectRoot` (needs installed
  package types); without it the check is skipped and reported as such.
- Repair loop can't be live-tested without an ANTHROPIC_API_KEY; tests use a mock.
- Sandbox test-run stage: interface + stub only (per spec).
