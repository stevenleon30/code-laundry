# Code Laundry

Code Laundry checks the TypeScript and JavaScript that Claude writes before you build or commit it. It runs real tools on the code (the TypeScript compiler, ESLint, Prettier, Semgrep, gitleaks and the npm registry), applies the safe fixes, and returns a verdict: **pass**, **fixed**, or **reject**, with each finding's severity and location.

It catches hallucinated and typosquatted npm packages, packages npm removed as malware, known vulnerabilities, SQL and command injection, path traversal, SSRF, XSS, weak crypto, hardcoded secrets, missing `await`, swallowed errors, invented APIs such as `fs.readFileAsync`, type errors, dead code, and leftovers such as placeholder TODOs, mock data and `console.log`.

## What's included

- **MCP server** `code-laundry` with three tools: `launder_code`, `check_dependencies` and `explain_findings`
- **Skill `launder-code`**: tells Claude to check finished TS/JS changes and act on the verdict
- **Skill `vet-dependencies`**: tells Claude to check npm packages before installing them

## Install

In Claude Code:

```
/plugin install code-laundry --marketplace stevenleon30/code-laundry
```

## Requirements

- Node.js 20 or later (the server is started with `npx`)
- Recommended: [Semgrep](https://semgrep.dev/docs/getting-started/) and [gitleaks](https://github.com/gitleaks/gitleaks) on your `PATH`. Without them, the security and secret scans fall back to built-in checks and the result says which stages were skipped.

## Use it

Ask Claude to write or change TypeScript/JavaScript as usual. When a change is finished, Claude calls `launder_code`, writes the cleaned code back when the verdict is `fixed`, and fixes blocking findings itself when the verdict is `reject`. Before adding a package, Claude calls `check_dependencies`. You can also ask directly, for example "check src/api.ts with Code Laundry" or "is the package left-padd safe to install?".

To enable LLM repair of findings the tools can't fix, set the optional **Anthropic API key** in the plugin's settings. Without it, every check still runs locally.

## What it runs, sends and stores

- **Runs locally:** the plugin starts `npx -y code-laundry@0.1.0 mcp`, which downloads the pinned `code-laundry` package from the npm registry the first time. Your code is analysed on your machine and never executed. Semgrep (with metrics off) and gitleaks, if installed, read a temporary copy of the code that is deleted right after the scan.
- **Sends package names, not code:** to check dependencies, it sends the names (and versions, where known) of imported npm packages to the npm registry (`registry.npmjs.org`), npm's download-count API (`api.npmjs.org`), and the OSV vulnerability database (`api.osv.dev`, operated by Google).
- **Sends code only if you add an API key:** with an Anthropic API key set, the few lines around each unresolved finding (never the whole file, and never detected secrets) are sent to the Anthropic API to propose repairs.
- **Stores nothing:** the plugin keeps no logs, telemetry or copies of your code. The maintainer receives no data.

See the [privacy policy](https://github.com/stevenleon30/code-laundry/blob/main/PRIVACY.md) for details.

## Support

Report problems at https://github.com/stevenleon30/code-laundry/issues.

## License

MIT
