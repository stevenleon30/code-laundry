# Privacy Policy

_Last updated: 2026-10-27_

This policy covers Code Laundry: the `code-laundry` npm package, its command-line tool and MCP server, and the Code Laundry Claude plugin. Code Laundry is open-source software that runs on your own computer. It is maintained by [stevenleon30](https://github.com/stevenleon30).

## Data collection

The maintainer collects no data. Code Laundry has no accounts, analytics, telemetry or crash reporting, and it doesn't send anything to servers run by the maintainer; there are none.

## Use and storage

- Code you submit is analysed in memory on your computer. It is never executed.
- When Semgrep or gitleaks are installed, they read a copy of the code in a private temporary directory that is deleted as soon as the scan ends.
- Code Laundry keeps no logs, history or copies of your code. Results are returned to the tool or person that called it and aren't stored.
- Detected secret values are redacted from every result and are never sent anywhere.

## Third-party sharing

Code Laundry contacts these third-party services to do its job:

| Service | When | What is sent |
| --- | --- | --- |
| npm registry (`registry.npmjs.org`) | Checking dependencies; downloading the package via `npx` | Names of imported packages |
| npm downloads API (`api.npmjs.org`) | Checking dependencies | Names of imported packages |
| OSV (`api.osv.dev`, operated by Google), via osv-scanner or directly | Checking dependencies for known vulnerabilities | Package names and versions |
| Anthropic API (`api.anthropic.com`) | Only if you configure an Anthropic API key, in `fix` or `strict` mode | A few lines of code around each unresolved finding, with detected secrets excluded and redacted |

Each service handles that data under its own privacy policy. Semgrep runs with metrics turned off, and the Semgrep rules used are bundled with Code Laundry, so Semgrep doesn't send your code anywhere.

## Data retention

Code Laundry retains nothing. Some of the dependency results it fetches are cached in memory for up to six hours while the server runs, and the cache is cleared when it stops. Retention by the third-party services above is set by their own policies.

## Children

Code Laundry is a developer tool and isn't directed at children.

## Changes

Changes to this policy are made in this file, and its history is visible in the repository.

## Contact

Open an issue at https://github.com/stevenleon30/code-laundry/issues.
