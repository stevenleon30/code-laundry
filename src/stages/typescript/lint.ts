import js from "@eslint/js";
import { ESLint, Linter } from "eslint";
import path from "node:path";
import tseslint from "typescript-eslint";
import { makeFinding, snippetAt, type Stage, type StageContext } from "../../core/stage.js";
import type { Finding } from "../../core/types.js";
import { RULE_META, SYNTACTIC_RULES, TYPED_RULES } from "./lint-rules.js";
import { getProgram, loadTsProject } from "./program.js";

const FILES = ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"];

function bundledSyntacticConfig(jsx: boolean): Linter.Config[] {
  return [
    { files: FILES, ...js.configs.recommended },
    ...(tseslint.configs.recommended as Linter.Config[]).map((c) => ({ ...c, files: FILES })),
    {
      files: FILES,
      languageOptions: {
        parser: tseslint.parser as Linter.Parser,
        parserOptions: { ecmaFeatures: { jsx } },
        sourceType: "module",
      },
      rules: SYNTACTIC_RULES,
    },
  ];
}

function typedConfig(program: unknown, jsx: boolean): Linter.Config[] {
  return [
    {
      files: FILES,
      languageOptions: {
        parser: tseslint.parser as Linter.Parser,
        parserOptions: { programs: [program], ecmaFeatures: { jsx } },
        sourceType: "module",
      },
      plugins: { "@typescript-eslint": tseslint.plugin as unknown as ESLint.Plugin },
      rules: TYPED_RULES,
    },
  ];
}

/** Project-config ESLint instances are reused: config loading is the expensive part. */
const projectEngines = new Map<string, ESLint>();
const linters = new Map<string, Linter>();
function linterFor(cwd: string): Linter {
  let l = linters.get(cwd);
  if (!l) {
    l = new Linter({ configType: "flat", cwd });
    linters.set(cwd, l);
  }
  return l;
}

function toFindings(messages: Linter.LintMessage[], code: string, fatalAsSyntax = true): Finding[] {
  return messages.map((m) => {
    const ruleId = m.ruleId ?? (m.fatal ? "parse/eslint" : "eslint/unknown");
    const meta = m.ruleId ? RULE_META[m.ruleId] : undefined;
    const location = {
      line: m.line || 1,
      column: m.column || 1,
      ...(m.endLine ? { endLine: m.endLine } : {}),
      ...(m.endColumn ? { endColumn: m.endColumn } : {}),
    };
    return makeFinding({
      ruleId: m.ruleId ? `eslint/${m.ruleId}` : ruleId,
      source: "eslint",
      category: m.fatal && fatalAsSyntax ? "syntax" : (meta?.category ?? "lint"),
      severity: m.fatal ? "critical" : (meta?.severity ?? (m.severity === 2 ? "medium" : "low")),
      message: m.message,
      location,
      fixable: Boolean(m.fix),
      snippet: snippetAt(code, location),
    });
  });
}

interface LintPass {
  messages: Linter.LintMessage[];
  output: string;
}

function lintBundled(ctx: StageContext, code: string, fix: boolean): LintPass {
  const linter = linterFor(path.dirname(ctx.filePath));
  const config = bundledSyntacticConfig(ctx.detected.jsx);
  if (fix) {
    const r = linter.verifyAndFix(code, config, { filename: ctx.filePath });
    return { messages: r.messages, output: r.output };
  }
  return { messages: linter.verify(code, config, { filename: ctx.filePath }), output: code };
}

async function lintSyntactic(ctx: StageContext, code: string, fix: boolean, notes: string[]): Promise<LintPass> {
  const projectConfig = ctx.detected.projectConfigs.eslint;
  if (ctx.projectRoot && projectConfig && ctx.config.useProjectConfigs) {
    const key = `${ctx.projectRoot}:${fix}`;
    let eslint = projectEngines.get(key);
    if (!eslint) {
      eslint = new ESLint({ cwd: ctx.projectRoot, fix });
      projectEngines.set(key, eslint);
    }
    try {
      const [res] = await eslint.lintText(code, { filePath: ctx.filePath, warnIgnored: false });
      if (res?.messages.some((m) => m.fatal)) {
        // The parse stage already accepted this code, so a fatal error means the project's
        // config can't parse this file type (e.g. no TypeScript parser configured).
        notes.push("project ESLint config could not parse this file; fell back to bundled config");
      } else if (res) {
        const note = `using project ESLint config ${projectConfig}`;
        if (!notes.includes(note)) notes.push(note);
        return { messages: res.messages, output: res.output ?? code };
      }
    } catch (err) {
      notes.push(`project ESLint config failed (${(err as Error).message.split("\n")[0]}); fell back to bundled config`);
    }
  }
  return lintBundled(ctx, code, fix);
}

/**
 * Two passes:
 *  1. syntactic rules with autofix (project config if present, else bundled);
 *  2. type-aware rules (no-floating-promises etc.), report-only, using the same
 *     TS program the typecheck stage uses.
 * Fixed findings are those present before the fix and gone after it.
 */
export const lintStage: Stage = {
  id: "ts.lint",
  kind: "lint",
  languages: ["typescript", "javascript"],
  canFix: true,
  defaultEnabled: true,
  available: async () => ({ ok: true }),
  async run(ctx) {
    const notes: string[] = [];
    const before = await lintSyntactic(ctx, ctx.code, false, notes);
    let code = ctx.code;
    let findings: Finding[];

    if (ctx.allowFix && before.messages.some((m) => m.fix)) {
      const after = await lintSyntactic(ctx, ctx.code, true, notes);
      code = after.output;
      const remaining = after.messages;
      const beforeFindings = toFindings(before.messages, ctx.code);
      const remainingByRule = new Map<string, number>();
      for (const m of remaining) remainingByRule.set(m.ruleId ?? "", (remainingByRule.get(m.ruleId ?? "") ?? 0) + 1);
      const fixedFindings: Finding[] = [];
      const beforeByRule = new Map<string, Finding[]>();
      for (const f of beforeFindings) beforeByRule.set(f.ruleId, [...(beforeByRule.get(f.ruleId) ?? []), f]);
      for (const [ruleId, list] of beforeByRule) {
        const left = remainingByRule.get(ruleId.replace(/^eslint\//, "")) ?? 0;
        const nFixed = Math.max(0, list.length - left);
        // Prefer marking the ones ESLint offered a fix for.
        const ordered = [...list].sort((a, b) => Number(b.fixable) - Number(a.fixable));
        for (const f of ordered.slice(0, nFixed)) fixedFindings.push({ ...f, fixed: true, fixedBy: "tool" });
      }
      findings = [...fixedFindings, ...toFindings(remaining, code)];
    } else {
      findings = toFindings(before.messages, code);
    }

    // A fatal ESLint parse error means pass 2 can't run; parse stage normally catches this first.
    if (findings.some((f) => f.category === "syntax")) return { findings, code, notes };

    const project = loadTsProject(ctx.projectRoot, ctx.detected.projectConfigs.tsconfig);
    const { program } = getProgram(ctx.filePath, code, project);
    const typed = linterFor(path.dirname(ctx.filePath)).verify(code, typedConfig(program, ctx.detected.jsx), {
      filename: ctx.filePath,
    });
    findings.push(...toFindings(typed, code, false));

    return { findings, ...(code !== ctx.code ? { code } : {}), notes };
  },
};
