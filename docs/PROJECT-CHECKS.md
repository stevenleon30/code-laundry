# Design sketch: project-wide checks (`launder_project`)

Status: proposal, not built.

`launder_code` checks one file at a time, so it can't see problems that only exist across files: an import cycle, a UI component reaching into the database layer, a helper an agent rewrote instead of reusing, or a second validation library slipped into a repo that already uses zod. `launder_project` adds those checks.

It keeps Code Laundry's rules:

- **Deterministic tools first.** No LLM decides what the architecture should be.
- **It reads only the user's repository** (and its `node_modules`). No other codebases and no corpus are involved.
- **It enforces rules the project chooses or already follows.** It doesn't judge what the "best" structure is.

## The tool

```ts
launder_project({
  projectRoot: string,
  changedFiles?: string[],    // or
  base?: string,              // git ref; changed files = diff against it
  mode: "check",              // report only; nothing is auto-fixed
})
// → { verdict, verdictReasons, findings[], metrics, stagesRun[], durationMs }
```

Findings use the existing `Finding` shape, plus a `file` field and, for cross-file findings, `related: [{ file, line }]`.

CLI: `code-laundry project [dir] [--base main]`. The plugin's `launder-code` skill would call it once before a commit or PR, not after every file.

### Scoping: report what the change introduced, not existing debt

Running these checks on a real repository usually turns up hundreds of pre-existing problems, and a tool that reports all of them gets switched off. So by default, the tool reports a finding only if it involves a changed file:

- a cycle is reported only if a changed file is in it;
- a duplicate only if one copy is in a changed file;
- a layering violation only if the import is in a changed file.

`code-laundry project --baseline` writes `.codelaundry-baseline.json`, recording the findings that already exist. A full-repo run then reports only findings that aren't in the baseline.

## Checks

| Check | Tool | Example finding | Default severity |
|---|---|---|---|
| Layering rules | dependency-cruiser | `src/ui/Cart.tsx` imports `src/db/orders.ts`; layer `ui` may only import `domain`, `shared` | high |
| Import cycles | dependency-cruiser | `orders.ts → billing.ts → orders.ts` (introduced by this change) | medium |
| Production code importing dev-only packages | dependency-cruiser | `src/server.ts` imports `vitest` | high |
| Unused files and exports across the project | knip | `src/utils/legacyFormat.ts` is imported by nothing | low |
| Missing or unused dependencies | knip | `axios` imported but not in `package.json`; `moment` listed but never imported | medium / low |
| Copy-paste duplication | jscpd | 34 lines in `src/api/users.ts:12` duplicate `src/api/teams.ts:40` | medium |
| Reinvented helper | Code Laundry | new `formatCurrency()` in `src/checkout.ts` duplicates the exported `formatMoney()` in `src/lib/format.ts` | medium |
| Mixed library | Code Laundry | this file introduces `yup`; the repo validates with `zod` (41 files) | low |
| Bypassed house helper | Code Laundry | `console.log` in a repo where 30 files use `src/lib/logger` | low |

### Layering rules (configured, not inferred)

Layers are declared in `.codelaundry.json` and translated into dependency-cruiser `forbidden` rules:

```json
{
  "architecture": {
    "layers": [
      { "name": "ui", "path": "src/ui/**", "mayImport": ["domain", "shared"] },
      { "name": "domain", "path": "src/domain/**", "mayImport": ["shared"] },
      { "name": "db", "path": "src/db/**", "mayImport": ["domain", "shared"] },
      { "name": "shared", "path": "src/shared/**", "mayImport": [] }
    ],
    "forbidCycles": true
  },
  "conventions": {
    "preferred": { "validation": "zod", "http": "fetch", "dates": "date-fns" },
    "deprecated": ["moment", "request"]
  }
}
```

No `architecture` section means no layering checks. Cycles, dev-dependency imports, unused code and duplication run regardless.

### Conventions learned from the repository

This is the part Code Laundry would implement itself, deterministically:

1. **Import census.** Count which packages and internal modules each file imports, using the TypeScript parser that already exists.
2. **Category map.** A bundled list groups interchangeable libraries:
   - validation: zod, yup, joi, valibot
   - HTTP: axios, got, node-fetch, ky, fetch
   - dates: moment, dayjs, date-fns, luxon
   - logging: winston, pino, bunyan, `console`
   - ORM: prisma, typeorm, sequelize, drizzle, knex
3. **Dominant choice.** If one library in a category is used by most files (default: at least 5 files and 80%), a changed file that brings in a different one gets `convention/mixed-library`.
4. **House helpers.** An internal module imported by many files (say, `src/lib/logger`) is a house helper for its role. A changed file doing that job another way gets `convention/bypassed-helper`, for example `console.log` instead of the logger, or a raw `fetch` instead of `src/lib/http`.
5. **Explicit config wins.** `conventions.preferred` and `conventions.deprecated` override the census. This matters during migrations, when the majority library is the one being removed.

**Reinvented helpers** combine an index of exported functions (name, parameter and return types) with jscpd's token matching. A new function whose body matches an existing export, or whose name and signature closely match one (`formatCurrency(n: number): string` vs `formatMoney(amount: number): string`), gets reported with a pointer to the existing export. This targets a very common AI habit: writing a fresh helper instead of finding the one that already exists.

## How it fits the current code

- New `src/project/` module: `census.ts`, `conventions.ts`, `helpers-index.ts`, and adapters for dependency-cruiser, knip and jscpd (run in-process where they have an API, otherwise via `exec.ts`).
- Reuses `Finding`, `computeVerdict`, config loading, redaction and `stagesRun` reporting. Each check is a project-level stage with the same "skipped, with a reason" behaviour when its tool is missing.
- The census and export index are cached per `projectRoot` by file mtime, like the TypeScript source-file cache, so repeat runs only re-read changed files.

## Safety and trust

- **Source code is never executed.**
- **knip loads project config files** (`vite.config.ts`, `next.config.js` and so on) to find entry points, which means running that JavaScript. That's the same trust model as the ESLint configs Code Laundry already loads: only run it on repositories you trust, and use `CODELAUNDRY_ALLOWED_ROOTS` to restrict callers. A `project.loadConfigs: false` option would disable knip's plugins, at the cost of more unused-file false positives.
- **No network.** These checks never go online. Dependency existence checks stay in the existing deps stage.

## Evals

Small fixture repositories under `evals/projects/`:

- `clean`: control, expect zero findings;
- `layer-violation`, `cycle-introduced`, `cycle-preexisting` (must not be reported when scoped to changed files);
- `duplicate-helper`, `mixed-validation-lib`, `logger-bypass`;
- `migration-in-progress`: config says `date-fns` is preferred while most files still use `moment`; a new `date-fns` import must not be flagged.

Each fixture names its changed files and expected findings, scored by the existing runner.

## Limitations

- It still enforces rules; it doesn't design. "Should this be a separate service?" stays a human or agent decision.
- Learned conventions are a majority vote, so they can be wrong. That's why explicit config overrides them and why they default to low severity.
- Large monorepos: dependency-cruiser and knip can take tens of seconds on a full run. Scoping to changed files and their import neighbourhood keeps typical runs short; full runs belong in CI.
- TypeScript/JavaScript only, like the rest of v1.

## Rough build order

1. dependency-cruiser + knip adapters, change scoping, baseline file, CLI and MCP tool, fixture evals. About 1–1.5 days.
2. Import census, mixed-library and bypassed-helper checks, config overrides. About 1 day.
3. Export index + jscpd for reinvented helpers. About 1 day.
