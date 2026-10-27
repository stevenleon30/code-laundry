# 🧺 Code Laundry

**Clean AI-generated code before you commit to it.**

Code Laundry is an MCP server and CLI that AI coding agents call to check, fix, and sanitize the code they generate before a full build. You submit code as a string, a file, or a diff. You get back cleaned code, a structured report of what was wrong, and one of three verdicts: **pass**, **fixed**, or **reject**.

It runs **deterministic checks first**, using real tools (TypeScript, ESLint + typescript-eslint, Prettier, Semgrep, gitleaks, osv-scanner, the npm registry). An LLM is used only for repairs those tools can't make, and every LLM edit is checked again before it's accepted.

> **Status: v0.1.** TypeScript and JavaScript. See [Limitations](#limitations).
>
> **Not yet on npm.** The `npx` and plugin installs below work once `code-laundry@0.1.0` is published; until then, install [from source](#from-source).

---

## Why

AI-generated code fails in predictable ways:

- **Hallucinated packages**: imports that don't exist on npm, typosquats, packages npm removed as malware
- **Security holes**: SQL and command injection, `eval`, path traversal, SSRF, XSS, weak crypto
- **Leaked secrets**: API keys and tokens pasted inline
- **Silent bugs**: missing `await`, swallowed errors, overly broad `try/catch`
- **Slop**: truncated output (`// ... rest of the code`), placeholder TODOs, mock data left in, dead code, `console.log`
- **Invented APIs**: calls to functions that don't exist (`fs.readFileAsync`) or not in the installed version of a package

## How it works

```
 code ─► detect ─► parse ─► format ─► lint+fix ─┬► typecheck ─┐
                     │                           ├► semgrep    ├─► slop ─► repair loop ─► report
                     └─ syntax error ⇒ reject    ├► secrets    │   (fix)   (fix/strict:
                                                 └► deps ──────┘            LLM, re-verified)
```

| Stage | Tool | Fixes |
|---|---|---|
| Parse | TypeScript parser | |
| Format | Prettier (project config if present) | ✓ |
| Lint | ESLint + typescript-eslint, including type-aware rules such as `no-floating-promises` (project flat config if present) | ✓ |
| Type check | TypeScript compiler (project `tsconfig.json` if present) | |
| Security | Semgrep with bundled rules ([`rules/semgrep/`](rules/semgrep/typescript.yml)) | |
| Secrets | gitleaks + built-in patterns; values are always redacted | |
| Dependencies | npm registry, OSV (osv-scanner, falling back to the OSV API), typosquat list | |
| AI slop | AST heuristics; type errors that point at a package's own declarations become `slop/invented-api` | `console.log` |
| Repair | Claude, structured line-range edits, only inside flagged ranges | ✓ |

- **Speed.** ESLint, Prettier and TypeScript run in-process and stay warm in the MCP server. Analysis stages run in parallel. A typical check takes 2–3 s, most of it Semgrep.
- **No silent skips.** If a tool isn't installed or a service can't be reached, `stagesRun` says so, with the reason. In `strict` mode, a security or dependency check that didn't run rejects the code.

### Verdicts

| Verdict | Meaning |
|---|---|
| ✅ `pass` | Nothing blocking was found. Unfixed low/medium findings are returned as warnings. |
| 🔧 `fixed` | Issues were found and nothing blocking remains. Use `cleanedCode`. |
| ⛔ `reject` | Any of: an unfixed critical/high finding, a syntax error, a hardcoded secret, or a hallucinated/malicious dependency |

All of these are configurable (see [Configuration](#configuration)). In `strict` mode, medium findings also reject.

## Installation

### Claude Code plugin (recommended)

```
/plugin install code-laundry --marketplace stevenleon30/code-laundry
```

This adds the MCP server and two skills that tell Claude when to use it: check finished TS/JS changes, and vet npm packages before installing them. To enable LLM repair, set the optional Anthropic API key in the plugin's settings. See [`plugin/README.md`](plugin/README.md).

### npm

Requires Node 20+.

```bash
npx code-laundry check src/handler.ts      # run without installing
npm install -g code-laundry                 # or install the code-laundry command
```

Strongly recommended, otherwise the related stages report themselves as skipped:

- [Semgrep](https://semgrep.dev/docs/getting-started/) (`pip install semgrep`)
- [gitleaks](https://github.com/gitleaks/gitleaks)
- [osv-scanner](https://github.com/google/osv-scanner)

Optional LLM repair (fix/strict modes):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export CODELAUNDRY_MODEL=claude-opus-5-5     # optional; default claude-opus-5-5
export CODELAUNDRY_EFFORT=high               # optional; low | medium | high | xhigh | max
```

Without a key, every deterministic check still runs, and the repair stage reports `skipped`.

### From source

```bash
git clone https://github.com/stevenleon30/code-laundry.git
cd code-laundry
pnpm install        # also builds dist/
```

## Use with Claude Code (without the plugin)

```bash
claude mcp add code-laundry -- npx -y code-laundry@0.1.0 mcp
```

Or commit a `.mcp.json` in your project:

```json
{
  "mcpServers": {
    "code-laundry": {
      "command": "npx",
      "args": ["-y", "code-laundry@0.1.0", "mcp"],
      "env": { "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}" }
    }
  }
}
```

Without the plugin's skills, add a line like this to your `CLAUDE.md` so the agent uses it:

> Before writing generated code to disk, call `launder_code` with `mode: "fix"` and `context.projectRoot` set to this repo. Use `cleanedCode`; if the verdict is `reject`, fix the findings and call it again. Call `check_dependencies` before adding any package.

## Use with Claude Desktop

Add this to `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/`
- Windows: `%APPDATA%\Claude\`

```json
{
  "mcpServers": {
    "code-laundry": {
      "command": "npx",
      "args": ["-y", "code-laundry@0.1.0", "mcp"],
      "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }
    }
  }
}
```

Claude Desktop starts servers with a minimal `PATH`. If Semgrep or gitleaks show as skipped, point to them explicitly with `"CODELAUNDRY_SEMGREP": "/path/to/semgrep"` and `"CODELAUNDRY_GITLEAKS": "/path/to/gitleaks"` in `env`.

## MCP tools

### `launder_code`

| Input | |
|---|---|
| `code` or `diff` | Full source, or a unified diff for one file. A diff is applied to `projectRoot/filename`, or to an empty file when creating one. |
| `language?` | `typescript` \| `javascript`. Detected from the filename or content if omitted. |
| `filename?` | Path relative to `projectRoot`. Selects the parser and the project config that applies. |
| `context?` | `{ projectRoot?, configPath? }`. `projectRoot` enables your tsconfig, ESLint and Prettier configs, `.codelaundry.json`, installed package types, and the undeclared-import check. |
| `mode` | `check` (default; report only) \| `fix` \| `strict` |

Returns `{ verdict, verdictReasons, language, cleanedCode, findings[], diff, stagesRun[], durationMs }`. Each finding has:

```json
{
  "ruleId": "semgrep/sql-injection",
  "source": "semgrep",
  "category": "security",
  "severity": "critical",
  "message": "User-controlled data flows into a SQL query string. ...",
  "location": { "line": 8, "column": 35, "endLine": 8, "endColumn": 90 },
  "fixable": false,
  "fixed": false,
  "snippet": "..."
}
```

### `check_dependencies`

Input is `{ packageJson }` (object or string) or `{ imports: ["lodash", "lodash@4.17.15", "@scope/pkg/sub"] }`. It flags:

- packages that don't exist, or that npm replaced with a security placeholder
- typosquats of popular packages
- known vulnerabilities, with the version to upgrade to
- deprecated, very new, or rarely downloaded packages
- imports missing from `package.json`

### `explain_findings`

Input is `{ findings }`. Returns plain-language explanations and concrete fix guidance, blocking findings first. It is deterministic; no LLM is called.

## CLI

```bash
code-laundry check src/handler.ts          # report only
code-laundry fix src/handler.ts            # apply fixes (and LLM repair if configured), write the file
code-laundry fix src/handler.ts --stdout   # print cleaned code instead
cat gen.ts | code-laundry check - --filename gen.ts
code-laundry deps                          # check ./package.json
code-laundry deps axois lodash@4.17.15     # check specific packages
code-laundry mcp                           # start the MCP server on stdio
```

Options: `--strict`, `--project <dir>` (default: nearest `package.json`), `--no-project`, `--config <file>`, `--diff`, `--json`.

Exit codes: `0` for pass or fixed, `1` for reject, `2` for a usage or internal error. `fix` never writes a file that contained a secret: the cleaned code has the secret redacted, and writing it would break the file.

During development, use `pnpm cli check <file>` and `pnpm mcp`.

## Configuration

Put a `.codelaundry.json` file at your project root. It is validated with Zod, and unknown keys are errors.

```json
{
  "stages": { "ts.semgrep": true, "ts.deps": true, "repair": true },
  "thresholds": {
    "rejectOn": ["critical", "high"],
    "strictRejectOn": ["medium"],
    "rejectOnSyntaxError": true,
    "rejectOnSecret": true,
    "rejectOnHallucinatedDependency": true
  },
  "ignoreRules": ["slop/console-log", "eslint/@typescript-eslint/no-explicit-any"],
  "severityOverrides": { "slop/todo": "medium" },
  "allowedPackages": ["@my-org/*"],
  "repair": { "maxIterations": 3, "contextLines": 5, "model": "claude-opus-5-5" },
  "deps": { "minWeeklyDownloads": 500, "minAgeDays": 30 },
  "useProjectConfigs": true
}
```

Stage ids: `ts.parse`, `ts.format`, `ts.lint`, `ts.typecheck`, `ts.semgrep`, `secrets`, `ts.deps`, `ts.slop`, `repair`.

| Environment variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables LLM repair |
| `CODELAUNDRY_MODEL`, `CODELAUNDRY_EFFORT` | Repair model and effort |
| `CODELAUNDRY_SEMGREP`, `CODELAUNDRY_GITLEAKS`, `CODELAUNDRY_OSV_SCANNER` | Explicit tool paths |
| `CODELAUNDRY_OSV_OFFLINE=1` | Use osv-scanner's offline database (when `api.osv.dev` is blocked; ~200 MB download once) |
| `CODELAUNDRY_NPM_REGISTRY` | Registry URL (default `https://registry.npmjs.org`) |
| `CODELAUNDRY_ALLOWED_ROOTS` | Restrict which `projectRoot`s callers may use (path-list) |
| `CODELAUNDRY_MAX_BYTES` | Input size limit (default 1 MB) |
| `CODELAUNDRY_DEPS_FIXTURE` | Serve dependency data from a JSON fixture (tests and evals) |

## Safety

- **Submitted code is never executed.**
  - It is parsed and analysed in memory.
  - Semgrep and gitleaks read a copy in a private temporary directory, which is deleted afterwards.
  - The test-run stage is not implemented in v1. If added, it will be opt-in and run only in a network-less, resource-limited container.
- **Privacy.** See [PRIVACY.md](PRIVACY.md) for exactly what is sent where. In short: package names go to npm and OSV, and code goes nowhere unless you configure an Anthropic key for repair.
- **Secrets are never returned or sent anywhere.**
  - Detected secret values are redacted from findings, messages, diffs and `cleanedCode`.
  - Secrets are never included in what is sent to the LLM.
  - External tools run without your API keys in their environment.
- **Submitted code is treated as untrusted data.**
  - Instructions in comments or strings have no effect on the deterministic stages.
  - The LLM gets the code inside `<untrusted_code>` delimiters, is told to ignore embedded instructions, and can only answer with schema-validated line edits.
- **LLM edits are restricted.**
  - Edits outside the flagged lines (plus `repair.contextLines` of context) are rejected.
  - Each candidate is re-verified by all deterministic stages and kept only if findings decrease.
  - The loop runs at most 3 rounds.
- **Project configs are executed.** With `projectRoot`, ESLint and Prettier configs from that project are loaded, and they are JavaScript. Only point Code Laundry at projects you trust, and use `CODELAUNDRY_ALLOWED_ROOTS` to restrict callers.

## Evals

[`evals/`](evals/) holds 89 labeled cases: 74 bad AI-style snippets and 15 clean controls. Each case is a snippet plus a JSON file listing the findings expected for it.

| Category | Cases |
|---|---|
| Security (command injection, path traversal, SSRF, XSS, weak crypto, TLS) | 11 |
| Wrong/invented API usage | 9 |
| Hallucinated, typosquatted or removed packages | 8 |
| SQL injection | 7 |
| Leaked secrets | 7 |
| Missing `await` | 7 |
| Bad types | 7 |
| AI slop | 7 |
| Swallowed errors | 6 |
| Dead code | 5 |

```bash
pnpm evals               # detection + repair
pnpm evals --no-repair   # detection only
pnpm evals --filter sqli
```

The runner reports **recall**, **precision** (medium+ findings), the **false-positive rate** on clean controls, and the **repair success rate**. It fails below the thresholds in [`evals/thresholds.json`](evals/thresholds.json). Dependency lookups use a recorded fixture, so results are deterministic.

The [GitHub Action](.github/workflows/evals.yml) runs type-checking, unit tests and detection evals on every PR. LLM repair evals call the API for every repairable case, so they run only on manual dispatch with an `ANTHROPIC_API_KEY` secret.

The current detection results are 100% recall, 100% precision and a 0% false-positive rate, including the 16-case held-out subset. **Read that with care:** the same author wrote the rules and the cases, so it shows coverage of the anticipated failure modes, not real-world accuracy. A corpus of real agent output is the next step.

## Limitations

- **TypeScript/JavaScript only** in v1. See [Adding a language](#adding-a-language).
- **Invented APIs in third-party packages** are detected only with `projectRoot`, because the installed type declarations are needed. Node built-ins are always checked.
- **Semgrep's open-source taint analysis is per-function.** Flows across functions or files are missed.
- **Typosquat detection** compares against a hand-curated list of about 400 popular packages.
- **Private packages** 404 on the public registry. They are accepted when installed in `projectRoot/node_modules`; otherwise add them to `allowedPackages`.
- **Download counts** come from `api.npmjs.org`. If it's unreachable, the check is noted and never blocks, because it is a weak signal.
- **Diff input** produces findings for the whole resulting file, not only the changed lines.
- **ESLint 10 dropped legacy `.eslintrc`.** Such projects get the bundled config.
- **Fixed-finding attribution** after ESLint autofix or LLM repair is counted per rule, not per occurrence.

## Adding a language

The core is language-agnostic. A language is a `LanguageModule` (detection plus an ordered list of `Stage`s) registered in [`src/core/registry.ts`](src/core/registry.ts). For Python:

1. Add `src/stages/python/` with `ruff format`, `ruff check --fix`, `mypy`, `bandit`, a Semgrep Python ruleset, and a PyPI dependency provider.
2. Register the module.

The pipeline, verdict logic, repair loop, MCP server, CLI and eval runner don't change. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Development

```bash
pnpm test        # unit and integration tests (vitest)
pnpm typecheck
pnpm evals
pnpm build
```

### Releasing

```bash
pnpm version patch      # bumps package.json, re-pins plugin/ to the new version, commits and tags
git push --follow-tags  # the publish workflow tests and publishes to npm (needs the NPM_TOKEN secret)
```

The plugin in [`plugin/`](plugin/) launches `npx -y code-laundry@<version> mcp`, so publish to npm before pushing a plugin change that pins a new version.

## Contributing

Issues and PRs are welcome. Every new detection should come with eval cases in `evals/cases/`, so that recall and false-positive rate stay measurable. Fake credentials go in [`evals/synthetic-secrets.ts`](evals/synthetic-secrets.ts) and are referenced as `__SECRET_NAME__`, so no secret-shaped literal is committed.

## License

MIT
