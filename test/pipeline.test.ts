import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/core/config.js";
import { launder, runStages, virtualPath } from "../src/core/pipeline.js";
import { Redactor } from "../src/core/redact.js";
import type { Stage } from "../src/core/stage.js";

const PROJECT = path.join(import.meta.dirname, "fixtures", "strict-project");

const CLEAN = `export function add(a: number, b: number): number {
  return a + b;
}
`;

const rules = (r: { findings: { ruleId: string }[] }) => r.findings.map((f) => f.ruleId);

describe("pipeline", () => {
  it("passes clean, formatted code untouched", async () => {
    const r = await launder({ code: CLEAN, mode: "fix" });
    expect(r.verdict).toBe("pass");
    expect(r.findings).toEqual([]);
    expect(r.cleanedCode).toBe(CLEAN);
    expect(r.diff).toBe("");
    expect(r.stagesRun.map((s) => s.id)).toEqual([
      "typescript.detect",
      "ts.parse",
      "ts.format",
      "ts.lint",
      "ts.typecheck",
      "ts.semgrep",
      "secrets",
      "ts.deps",
      "ts.slop",
    ]);
  });

  it("rejects syntax errors early with a precise location and skips later stages", async () => {
    const r = await launder({ code: "export function f( {\n  return 1;\n}\n", language: "typescript", mode: "fix" });
    expect(r.verdict).toBe("reject");
    const syntax = r.findings.filter((f) => f.category === "syntax");
    expect(syntax.length).toBeGreaterThan(0);
    expect(syntax[0]?.location?.line).toBeGreaterThanOrEqual(1);
    expect(r.stagesRun.find((s) => s.id === "ts.typecheck")?.status).toBe("skipped");
    expect(r.cleanedCode).toBe("export function f( {\n  return 1;\n}\n");
  });

  it("autofixes format and lint issues in fix mode and reports them as fixed", async () => {
    const r = await launder({ code: "var total = 1\nexport const out = total\n", language: "typescript", mode: "fix" });
    expect(r.verdict).toBe("fixed");
    expect(r.cleanedCode).toBe("const total = 1;\nexport const out = total;\n");
    expect(r.findings.every((f) => f.fixed)).toBe(true);
    expect(rules(r)).toEqual(expect.arrayContaining(["format/prettier", "eslint/no-var"]));
    expect(r.diff).toContain("-var total = 1");
    expect(r.diff).toContain("+const total = 1;");
  });

  it("never modifies code in check mode", async () => {
    const code = "var total = 1\nexport const out = total\n";
    const r = await launder({ code, mode: "check" });
    expect(r.cleanedCode).toBe(code);
    expect(r.diff).toBe("");
    expect(r.findings.every((f) => !f.fixed)).toBe(true);
    expect(r.verdict).toBe("pass"); // only low findings: non-blocking warnings
  });

  it("flags missing await (floating promise) and type errors as blocking", async () => {
    const code = `async function save(): Promise<void> {}
export function run(): void {
  save();
  const n: number = "x";
  console.info(n);
}
`;
    const r = await launder({ code, mode: "check" });
    expect(r.verdict).toBe("reject");
    expect(rules(r)).toEqual(expect.arrayContaining(["eslint/@typescript-eslint/no-floating-promises", "tsc/TS2322"]));
  });

  it("flags eval as critical security", async () => {
    const r = await launder({ code: "export function run(s: string): unknown {\n  return eval(s);\n}\n", mode: "check" });
    const f = r.findings.find((x) => x.ruleId === "eslint/no-eval");
    expect(f?.severity).toBe("critical");
    expect(f?.category).toBe("security");
    expect(r.verdict).toBe("reject");
  });

  it("detects plain JavaScript and JSX", async () => {
    const js = await launder({ code: "const a = 1;\nmodule.exports = { a };\n", mode: "check" });
    expect(js.language).toBe("javascript");
    expect(js.verdict).toBe("pass");
    const tsx = await launder({
      code: "export function Hello(props: { name: string }) {\n  return <div>{props.name}</div>;\n}\n",
      mode: "check",
    });
    expect(tsx.language).toBe("typescript");
    expect(tsx.findings.filter((f) => f.category === "syntax")).toEqual([]);
  });

  it("does not report unresolved npm imports without a project (deps stage owns that)", async () => {
    const code = `import { thing } from "totally-made-up-pkg";\nexport const x = thing;\n`;
    const r = await launder({ code, mode: "check" });
    expect(rules(r)).not.toContain("tsc/TS2307");
  });

  describe("with projectRoot", () => {
    it("uses project tsconfig, prettier config and .codelaundry.json", async () => {
      const code = `export function f(x: any, y?: string): number {\n  return y.length + x;\n}\n`;
      const r = await launder({ code, filename: "src/new.ts", projectRoot: PROJECT, mode: "fix" });
      // ignoreRules from fixture config drops no-explicit-any
      expect(rules(r)).not.toContain("eslint/@typescript-eslint/no-explicit-any");
      // strictness error is high because the project's tsconfig is strict
      const strictErr = r.findings.find((f) => f.ruleId === "tsc/TS18048");
      expect(strictErr?.severity).toBe("high");
      const tc = r.stagesRun.find((s) => s.id === "ts.typecheck");
      expect(tc?.notes?.[0]).toContain("tsconfig.json");
    });

    it("applies the project's Prettier config", async () => {
      const r = await launder({ code: 'export const s = "a";\n', filename: "src/q.ts", projectRoot: PROJECT, mode: "fix" });
      expect(r.cleanedCode).toBe("export const s = 'a';\n");
    });

    it("resolves imports of real project files and reports missing modules", async () => {
      const ok = await launder({
        code: `import { greet } from './util';\nexport const g: string = greet('x');\n`,
        filename: "src/n.ts",
        projectRoot: PROJECT,
        mode: "check",
      });
      expect(ok.findings).toEqual([]);
      const bad = await launder({
        code: `import { nope } from "./missing";\nexport const g = nope;\n`,
        filename: "src/n.ts",
        projectRoot: PROJECT,
        mode: "check",
      });
      expect(rules(bad)).toContain("tsc/TS2307");
    });
  });

  it("clamps virtual paths inside projectRoot", () => {
    expect(virtualPath("../../etc/passwd.ts", "/proj")).toBe(path.join("/proj", "passwd.ts"));
    expect(virtualPath("src/a.ts", "/proj")).toBe(path.join("/proj", "src", "a.ts"));
  });

  it("reports unavailable security stages as blocking only in strict mode", async () => {
    const fake: Stage = {
      id: "fake.security",
      kind: "security",
      languages: ["typescript"],
      canFix: false,
      defaultEnabled: true,
      available: async () => ({ ok: false, reason: "tool not installed" }),
      run: async () => ({ findings: [] }),
    };
    const rc = (mode: "fix" | "strict") => ({
      config: defaultConfig(),
      mode,
      filePath: "/tmp/x.ts",
      detected: { language: "typescript" as const, jsx: false, frameworks: [], projectConfigs: {}, imports: [] },
      redactor: new Redactor(),
    });
    const lax = await runStages([fake], rc("fix"), CLEAN, true);
    expect(lax.stagesRun[0]).toMatchObject({ status: "skipped", reason: "tool not installed" });
    expect(lax.findings).toEqual([]);
    const strict = await runStages([fake], rc("strict"), CLEAN, true);
    expect(strict.findings[0]).toMatchObject({ ruleId: "laundry/stage-unavailable", severity: "high" });
  });

  it("records a failing stage instead of crashing", async () => {
    const boom: Stage = {
      id: "fake.boom",
      kind: "lint",
      languages: ["typescript"],
      canFix: false,
      defaultEnabled: true,
      available: async () => ({ ok: true }),
      run: async () => {
        throw new Error("kaboom");
      },
    };
    const res = await runStages(
      [boom],
      {
        config: defaultConfig(),
        mode: "fix",
        filePath: "/tmp/x.ts",
        detected: { language: "typescript", jsx: false, frameworks: [], projectConfigs: {}, imports: [] },
        redactor: new Redactor(),
      },
      CLEAN,
      true,
    );
    expect(res.stagesRun[0]).toMatchObject({ status: "failed", reason: "stage error: kaboom" });
  });
});

describe("project ESLint configs", () => {
  const fx = (name: string) => path.join(import.meta.dirname, "fixtures", name);
  const code = `export function f(): void {\n  console.log("hi");\n}\n`;

  it("uses the project's flat config when present", async () => {
    const r = await launder({ code, filename: "a.ts", projectRoot: fx("eslint-project"), mode: "check" });
    expect(rules(r)).toContain("eslint/no-console");
    expect(r.stagesRun.find((s) => s.id === "ts.lint")?.notes?.[0]).toMatch(/using project ESLint config/);
  });

  it("falls back to the bundled config when the project config can't parse TypeScript", async () => {
    const r = await launder({ code, filename: "a.ts", projectRoot: fx("eslint-plain-project"), mode: "check" });
    expect(r.findings.filter((f) => f.category === "syntax")).toEqual([]);
    expect(r.stagesRun.find((s) => s.id === "ts.lint")?.notes?.join(" ")).toMatch(/fell back to bundled config/);
  });
});
