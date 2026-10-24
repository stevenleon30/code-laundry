# Task list (milestone = one commit)

## M1 — Pipeline core + format/lint/typecheck ✅
- [x] pnpm scaffold, strict tsconfig, vitest (ESLint + typescript-eslint + Prettier as deps)
- [x] core: types, stage, pipeline, registry, verdict, config, redact, diff
      (`exec.ts` moves to M3, where the first subprocess tools arrive; no temp workspace needed — see ARCHITECTURE "Virtual file")
- [x] stages: detect, ts.parse, ts.format (Prettier), ts.lint (ESLint autofix + type-aware pass), ts.typecheck (TS compiler API)
- [x] tests: verdict, config, redaction, pipeline (29 tests)

## M2 — MCP wrapper ✅
- [x] stdio server with launder_code (code **or** single-file unified diff) and explain_findings
      (deterministic knowledge base, no LLM)
- [x] check_dependencies is registered in M3 together with its implementation, not as a stub
- [x] Zod input/output schemas (structuredContent + JSON text); input size cap
      (CODELAUNDRY_MAX_BYTES) and optional projectRoot allow-list (CODELAUNDRY_ALLOWED_ROOTS)
- [x] tests: in-memory client for every tool + a real stdio process (38 tests total)
- Known until M3: a hardcoded secret is redacted from output by the backstop patterns,
  but does not yet force `reject` (the secrets stage that reports it arrives in M3).
- Diff input: findings cover the whole resulting file, not only the changed lines.

## M3 — Security + dependency + slop stages ✅
- [x] `exec.ts`: shell-free subprocess runner, scrubbed env (no API keys passed to tools),
      PATH lookup without running `--version` (semgrep's version check hangs for minutes offline)
- [x] ts.semgrep + bundled rules (`rules/semgrep/typescript.yml`): SQL injection (taint +
      string-built), command injection, path traversal, SSRF, open redirect, XSS, vm exec,
      weak hash/cipher, password hashing, insecure randomness, TLS off, JWT none, CORS
- [x] secrets: gitleaks (when installed) + built-in patterns, always both; exact values go
      to the redactor only. Detected secrets force `reject`.
- [x] deps: registry existence, removed-as-malicious placeholders, typosquats (vs bundled
      popular list), deprecation, publish age, weekly downloads, OSV vulns (osv-scanner,
      falling back to the OSV API), undeclared imports. Unreachable services are reported,
      never treated as clean; strict mode blocks on registry/OSV gaps.
- [x] check_dependencies MCP tool (package.json or imports[])
- [x] slop: truncated code, placeholder comments/values, TODOs, not-implemented stubs,
      empty/log-only/default-returning catch, swallowed promise rejections, broad try,
      fake/mock data outside tests, commented-out code, dead branches, localhost URLs,
      console.log (autofix, except inside catch blocks)
- [x] invented APIs: type errors that point at a package's declarations become
      `slop/invented-api` (Node built-ins always; installed packages with projectRoot)
- [x] pipeline: analysis stages run in parallel; a fix after analysis triggers
      re-verification of the final code
- [x] tests: 67 total; deps tests use a fixture provider (CODELAUNDRY_DEPS_FIXTURE)

## M4 — Eval suite ✅
- [x] 89 labeled cases in `evals/cases/` (snippet + JSON label each): 74 bad, 15 clean controls,
      covering hallucinated/typosquatted/removed packages, SQL injection, leaked secrets, missing
      await, swallowed errors, wrong/invented API usage, bad types, dead code, other security
      (command injection, path traversal, SSRF, XSS, weak crypto, TLS), and AI slop
- [x] 16 of them are a **held-out** subset, written without running the tool first and reported
      separately; the tool is not tuned against them
- [x] runner (`pnpm evals`): recall, precision (medium+ findings), false-positive rate (clean
      controls flagged), repair success; per-category table, misses, false positives;
      `evals/results/latest.json`; exits 1 below `evals/thresholds.json`
- [x] deps lookups use `evals/deps-fixture.json`, so evals are deterministic and offline
- First run found 3 real tool gaps (no-unreachable silently disabled by typescript-eslint's
  preset, an over-broad SQL sink matching axios.get, TODO-implement placeholders) — fixed.
- Caveat: every case was written by the same author as the rules, so 100% here means
  "covers what we thought to test". Real AI output samples are the next step for a true signal.

## M5 — Repair loop ✅
- [x] `src/repair/llm.ts`: Anthropic client using structured outputs (`beta.messages.parse` +
      Zod schema of line-range edits), model from `repair.model` / `CODELAUNDRY_MODEL`
      (default `claude-opus-5-5`), effort from `CODELAUNDRY_EFFORT` (default high),
      server-side refusal fallback enabled. Injectable client for tests/evals.
- [x] `src/repair/patch.ts`: edits must sit entirely inside a flagged range padded by
      `repair.contextLines`; out-of-range or overlapping edits are rejected individually
- [x] `src/repair/loop.ts`: only excerpts around flagged lines are sent (never the whole file);
      secrets are never targets and windows are redacted; each candidate is formatted, lint-fixed
      and re-verified by stages 2–8; kept only if the severity-weighted finding score drops;
      stops on no improvement, unparseable output, client error, or `maxIterations` (default 3)
- [x] Not repaired by the LLM: syntax errors, secrets, dependency findings (deterministic verdicts)
- [x] tests with a fake client (79 total): range guard, injected-import rejection, worse/broken
      candidates discarded, errors, iteration cap, secret never sent, check mode, no credentials
- Gap: no live API call has been made from this environment (no credentials here). The code is
  type-checked against the installed SDK; run `pnpm evals` with ANTHROPIC_API_KEY to measure
  real repair success.

## M6 — CLI + GitHub Action + README
- [ ] `codelaundry check|fix <file>` (+ `--json`, exit codes)
- [ ] .github/workflows/evals.yml (installs semgrep/gitleaks/osv-scanner, runs evals)
- [ ] README with Claude Code + Claude Desktop MCP config

## Known gaps / environment notes
- TypeScript is pinned to 6.0.x: TS 7 (native) has no stable JS API, and typescript-eslint supports <6.1.
- Fixed-finding attribution for ESLint autofix is by rule count (before vs after), so the
  "fixed" flag is exact per rule but not per individual occurrence.
- OSV in restricted networks: if api.osv.dev is blocked, set CODELAUNDRY_OSV_OFFLINE=1 to use
  osv-scanner's offline database (~200 MB download once; ~10s per new dependency set).
- npm download counts need api.npmjs.org; when unreachable the check is reported in notes
  and does not block, even in strict mode (it's a weak signal).
- Typosquat detection compares against a hand-curated list of ~400 popular packages.
- Private packages 404 on the public registry: they're accepted when installed in
  projectRoot/node_modules, otherwise list them in allowedPackages.
- Semgrep's taint analysis is intra-procedural (OSS); flows across functions are missed.
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
