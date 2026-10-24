import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli/index.js";
import { SYNTHETIC_SECRETS as S } from "../evals/synthetic-secrets.js";

let dir: string;
let out: string[];
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "cl-cli-"));
  out = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
});
afterEach(() => vi.restoreAllMocks());

const file = async (name: string, content: string) => {
  const p = path.join(dir, name);
  await writeFile(p, content);
  return p;
};

describe("cli", () => {
  it("check reports and exits 1 on reject without touching the file", async () => {
    const p = await file("a.ts", 'export function run(s: string): unknown {\n  return eval(s);\n}\n');
    expect(await main(["check", p])).toBe(1);
    expect(out.join("\n")).toMatch(/REJECT/);
    expect(out.join("\n")).toMatch(/eslint\/no-eval/);
    expect(await readFile(p, "utf8")).toContain("eval(s)");
  });

  it("fix writes the cleaned file and exits 0", async () => {
    const p = await file("b.ts", "var x = 1\nexport const y = x\n");
    expect(await main(["fix", p])).toBe(0);
    expect(await readFile(p, "utf8")).toBe("const x = 1;\nexport const y = x;\n");
  });

  it("fix --stdout leaves the file alone", async () => {
    const p = await file("c.ts", "var x = 1\nexport const y = x\n");
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(await main(["fix", p, "--stdout"])).toBe(0);
    expect(await readFile(p, "utf8")).toBe("var x = 1\nexport const y = x\n");
    expect(write).toHaveBeenCalledWith("const x = 1;\nexport const y = x;\n");
  });

  it("never writes redacted secrets back to disk", async () => {
    const original = `var token = "${S.GITHUB}"\nexport default token\n`;
    const p = await file("d.ts", original);
    expect(await main(["fix", p])).toBe(1);
    expect(await readFile(p, "utf8")).toBe(original);
    expect(out.join("\n")).toMatch(/not writing/);
    expect(out.join("\n")).not.toContain(S.GITHUB);
  });

  it("--json prints a parseable result", async () => {
    const p = await file("e.ts", "export const ok = 1;\n");
    expect(await main(["check", p, "--json"])).toBe(0);
    expect(JSON.parse(out.join("\n")).verdict).toBe("pass");
  });

  it("deps checks names and package.json", async () => {
    expect(await main(["deps", "lodahs"])).toBe(1);
    expect(out.join("\n")).toMatch(/deps\/removed-malicious/);
    const pkg = await file("package.json", JSON.stringify({ dependencies: { zod: "^4.0.0" } }));
    out = [];
    expect(await main(["deps", pkg])).toBe(0);
  });

  it("usage errors exit 2", async () => {
    expect(await main([])).toBe(2);
    expect(await main(["check"])).toBe(2);
    expect(await main(["frobnicate", "x"])).toBe(2);
    expect(await main(["check", path.join(dir, "missing.ts")])).toBe(2);
    expect(await main(["check", await file("x.py", "print(1)\n")])).toBe(2);
  });
});
