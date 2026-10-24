import { describe, expect, it } from "vitest";
import { launder } from "../src/core/pipeline.js";
import { slopScan } from "../src/stages/typescript/slop.js";

const ids = (code: string, file = "/x/a.ts") => slopScan(code, file).hits.map((h) => h.ruleId);

describe("slop heuristics", () => {
  it("flags truncated generations and placeholders", () => {
    expect(ids("function f() {\n  // ... rest of the code remains the same\n}\n")).toContain("slop/truncated-code");
    expect(ids("// TODO: implement this properly\nexport const x = 1;\n")).toContain("slop/placeholder-comment");
    expect(ids("// TODO: tune later\nexport const x = 1;\n")).toContain("slop/todo");
    expect(ids('export function f(): void {\n  throw new Error("Not implemented");\n}\n')).toContain("slop/not-implemented");
    expect(ids('export const key = "YOUR_API_KEY_HERE";\n')).toContain("slop/placeholder-value");
  });

  it("flags swallowed errors", () => {
    expect(ids("try { a(); } catch (e) {}\n")).toContain("slop/empty-catch");
    expect(ids("try { a(); } catch (e) { console.error(e); }\n")).toContain("slop/log-and-swallow");
    expect(ids("function f() { try { return a(); } catch (e) { return null; } }\n")).toContain("slop/error-to-default");
    expect(ids("p.catch(() => {});\n")).toContain("slop/promise-swallow");
  });

  it("does not flag proper error handling", () => {
    expect(ids("try { a(); } catch (e) { throw new Error('failed', { cause: e }); }\n")).toEqual([]);
    expect(ids("try { a(); } catch (e) { reportError(e); }\n")).toEqual([]);
    expect(ids("p.catch((e) => handle(e));\n")).toEqual([]);
  });

  it("flags fake/mock data outside tests only", () => {
    const code = 'export const mockUsers = [{ name: "John Doe", email: "jane@example.com" }];\n';
    expect(ids(code)).toEqual(expect.arrayContaining(["slop/mock-data", "slop/fake-data"]));
    expect(ids(code, "/x/users.test.ts")).toEqual([]);
  });

  it("flags console.log but not console.error, and commented-out code", () => {
    expect(ids('console.log("x");\nconsole.error("y");\n')).toEqual(["slop/console-log"]);
    expect(ids("// const a = 1;\n// doThing(a);\n// return a;\nexport {};\n")).toContain("slop/commented-out-code");
    expect(ids("// This module handles\n// user sessions and\n// token refresh.\nexport {};\n")).not.toContain("slop/commented-out-code");
  });

  it("removes console.log in fix mode and re-verifies locations", async () => {
    const code = `export function sum(a: number, b: number): number {
  console.log("adding", a, b);
  const total = a + b;
  const unusedThing = 1;
  return total;
}
`;
    const r = await launder({ code, mode: "fix" });
    expect(r.cleanedCode).not.toContain("console.log");
    expect(r.findings.find((f) => f.ruleId === "slop/console-log")?.fixed).toBe(true);
    // unused var was on line 4 before removal; after re-verification it's line 3
    expect(r.findings.find((f) => f.ruleId === "eslint/@typescript-eslint/no-unused-vars")?.location?.line).toBe(3);
    expect(r.stagesRun.some((s) => s.id.startsWith("verify:"))).toBe(true);
  });

  it("keeps console calls inside catch blocks (removing them would create an empty catch)", async () => {
    const code = `export function f(): void {
  try {
    g();
  } catch (e) {
    console.log(e);
  }
}
declare function g(): void;
`;
    const r = await launder({ code, mode: "fix" });
    expect(r.cleanedCode).toContain("console.log(e)");
  });
});

describe("invented APIs", () => {
  it("flags non-existent Node built-in exports and methods without a project", async () => {
    const code = `import { readFileAsync } from "node:fs";
import fs from "node:fs";
export async function f(): Promise<string> {
  await readFileAsync("a");
  return fs.promises.readJson("b");
}
`;
    const r = await launder({ code, mode: "check" });
    const inv = r.findings.filter((f) => f.ruleId === "slop/invented-api");
    expect(inv.map((f) => f.location?.line).sort()).toEqual([1, 5]);
    expect(inv[0]?.message).toContain("Node.js built-ins");
  });

  it("does not attribute errors in the caller's own types to packages", async () => {
    const code = `interface User { name: string }\nexport function f(u: User): string {\n  return u.email;\n}\n`;
    const r = await launder({ code, mode: "check" });
    expect(r.findings.map((f) => f.ruleId)).toContain("tsc/TS2339");
    expect(r.findings.map((f) => f.ruleId)).not.toContain("slop/invented-api");
  });
});
