# 🧺 Code Laundry

**Clean AI-generated code before you commit to it.**

Code Laundry is an MCP server and CLI that AI coding agents call to check, fix, and sanitize the code they generate before a full build. You submit code as a string, a file, or a diff. You get back cleaned code, a structured report of what was wrong, and one of three verdicts: **pass**, **fixed**, or **reject**.

It runs **deterministic checks first**, using real tools (ESLint, Prettier, `tsc`, Semgrep, gitleaks, OSV). An LLM is used only for repairs those tools can't make automatically, and every LLM edit is checked again before it's accepted.

> **Status: early development (v0.1, pre-release).** The architecture and plan are in [`docs/`](docs/). The sections below describe the intended v1 behaviour. Anything not yet built is marked 🚧. See the [Roadmap](#roadmap).

---

## Why

AI-generated code fails in predictable ways:

- **Hallucinated packages**: imports that don't exist on npm, or near-miss typosquats
- **Security holes**: SQL injection, `eval`, path traversal, weak crypto, SSRF
- **Leaked secrets**: API keys and tokens pasted inline
- **Silent bugs**: missing `await`, swallowed errors, overly broad `try/catch`
- **Slop**: placeholder TODOs, mocked data left in, dead code, `console.log` leftovers
- **Invented APIs**: calls to functions that don't exist in the installed version of a package

Code Laundry catches these before they reach your build, your CI, or your users.

## How it works

```
 code ─► detect ─► parse ─► format ─► lint+fix ─► typecheck ─► security ─► deps ─► slop
                     │                                                               │
                     └─ syntax error ⇒ reject                                        ▼
                                                     ┌──── repair loop (fix/strict) ◄┘
                                                     │  Claude patches flagged ranges only
                                                     │  → re-run all checks (max 3 rounds)
                                                     ▼
                                       report: verdict + findings + diff
```

| Stage | Tool |
|---|---|
| Format | Prettier |
| Lint + autofix | ESLint + typescript-eslint |
| Type check | TypeScript (`tsc --noEmit`) |
| Security | Semgrep (bundled rules in `rules/semgrep/`) |
| Secrets | gitleaks + built-in patterns (values are always redacted) |
| Dependencies | npm registry, OSV (osv-scanner / OSV API), typosquat detection |
| AI-slop heuristics | AST analysis |
| Repair (optional) | Claude via the Anthropic API |

Each stage is a pluggable module behind a common interface. If a tool isn't installed, its stage is reported as **skipped, with the reason**. Stages are never skipped silently.

### Verdicts

| Verdict | Meaning |
|---|---|
| ✅ `pass` | No issues found |
| 🔧 `fixed` | Issues found, and all of them were resolved |
| ⛔ `reject` | Any of: an unfixed critical/high finding, a syntax error, a detected secret, or a hallucinated dependency |

Thresholds are configurable.

## MCP tools

| Tool | Input | Output |
|---|---|---|
| `launder_code` | `code`, `language`, `filename?`, `context?: { projectRoot?, configPath? }`, `mode: "check" \| "fix" \| "strict"` | `{ verdict, cleanedCode, findings[], diff, stagesRun[], durationMs }` |
| `check_dependencies` | `packageJson` or `imports[]` | Hallucinated, typosquatted, vulnerable, and deprecated packages |
| `explain_findings` | `findings` | Plain-language explanations and fix guidance for the calling agent |

**Modes**

- `check`: report only, code is not modified
- `fix`: tool autofixes, plus LLM repair of whatever remains
- `strict`: like `fix`, but a missing security tool or a medium-severity finding also leads to `reject`

## Installation 🚧

Requirements:

- Node 20+ and pnpm
- Optional, but recommended for full coverage: [Semgrep](https://semgrep.dev/docs/getting-started/), [gitleaks](https://github.com/gitleaks/gitleaks), and [osv-scanner](https://github.com/google/osv-scanner)

```bash
git clone https://github.com/stevenleon30/code-laundry.git
cd code-laundry
pnpm install
pnpm build
```

To enable the LLM repair step, set:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export CODELAUNDRY_MODEL=claude-sonnet-5-5   # optional; any Claude model ID
```

Without a key, Code Laundry still runs every deterministic check. The repair stage shows up as skipped.

## Use with Claude Code 🚧

```bash
claude mcp add code-laundry -- node /absolute/path/to/code-laundry/dist/mcp/server.js
```

Or add it to `.mcp.json` in your project:

```json
{
  "mcpServers": {
    "code-laundry": {
      "command": "node",
      "args": ["/absolute/path/to/code-laundry/dist/mcp/server.js"],
      "env": { "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}" }
    }
  }
}
```

## Use with Claude Desktop 🚧

Add this to `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/`
- Windows: `%APPDATA%\Claude\`

```json
{
  "mcpServers": {
    "code-laundry": {
      "command": "node",
      "args": ["/absolute/path/to/code-laundry/dist/mcp/server.js"],
      "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }
    }
  }
}
```

## CLI 🚧

```bash
codelaundry check src/handler.ts          # report only
codelaundry fix src/handler.ts            # autofix + repair, writes the cleaned file
codelaundry check src/handler.ts --json   # machine-readable report
```

Exit codes: `0` for pass or fixed, `1` for reject, `2` for a usage or internal error.

## Configuration

Put a `.codelaundry.json` file at your project root. It is validated with Zod.

```json
{
  "stages": { "ts.semgrep": true, "repair": true },
  "thresholds": { "rejectOn": ["critical", "high"] },
  "ignoreRules": ["slop/console-log"],
  "allowedPackages": ["@my-org/*"],
  "repair": { "maxIterations": 3 },
  "deps": { "minWeeklyDownloads": 500, "minAgeDays": 30 }
}
```

If you pass `projectRoot`, Code Laundry also reads your `tsconfig.json`, ESLint config, and Prettier config, so its checks follow your project's conventions.

## Safety

- **Submitted code is never executed.** It is only parsed and analysed. A test-run stage would be opt-in and run only in a network-less, resource-limited container; it is a stub in v1.
- **Secrets are never returned or logged.** Detected secret values are redacted from findings, diffs, and cleaned code.
- **Submitted code is treated as untrusted data.** Instructions hidden in comments or strings are ignored. The LLM receives the code as clearly delimited data and must reply with structured edits.
- **The LLM's edits are restricted.** Any edit outside a flagged line range is rejected, and every repair is re-verified by the deterministic stages.
- **Tools run in a sandboxed way.** Subprocesses use no shell, have timeouts, and run in a temporary per-run workspace.

## Evals 🚧

`evals/` holds a labeled golden set of 40+ bad AI-generated snippets, plus clean controls. It covers hallucinated packages, SQL injection, leaked keys, missing `await`, swallowed errors, wrong API usage, bad types, and dead code.

```bash
pnpm evals
```

The runner reports **precision, recall, false-positive rate, and repair success rate**. A GitHub Action runs it on every PR and fails if recall drops below the configured threshold.

## Roadmap

- [ ] **M1**: Pipeline core with format, lint, and type-check stages
- [ ] **M2**: MCP server (stdio)
- [ ] **M3**: Security, secrets, dependency, and AI-slop stages
- [ ] **M4**: Eval suite and metrics
- [ ] **M5**: LLM repair loop with range-restricted patches and re-verification
- [ ] **M6**: CLI, GitHub Action, packaging
- [ ] **Later**: Python support (ruff, mypy, bandit), sandboxed test-run stage, HTTP transport

### Known limitations

- Detecting invented API calls requires `projectRoot`, because it reads the installed packages' type definitions.
- The OSV and npm download-count checks need network access to `api.osv.dev` and `api.npmjs.org`. Behind a restrictive network, set `CODELAUNDRY_OSV_OFFLINE=1` to use osv-scanner's offline database.
- Semgrep's open-source taint analysis is per-function; data flows across functions are not tracked.
- TypeScript and JavaScript only in v1.

## Adding a language

The core is language-agnostic. To add Python, for example:

1. Write stage modules under `src/stages/python/` (ruff, mypy, bandit, PyPI checks).
2. Register them in `src/core/registry.ts`.

The pipeline, verdict logic, repair loop, MCP server, and CLI don't change. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Contributing

Issues and PRs are welcome. Every new detection should come with eval cases in `evals/cases/`, so recall and false-positive rate stay measurable.

## License

MIT
