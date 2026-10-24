import { afterEach, describe, expect, it } from "vitest";
import { launder } from "../src/core/pipeline.js";
import { type RepairClient, type RepairEdits, type RepairRequest, setRepairClient } from "../src/repair/llm.js";
import { allowedWindows, applyEdits } from "../src/repair/patch.js";
import { SYNTHETIC_SECRETS as S } from "../evals/synthetic-secrets.js";

class FakeClient implements RepairClient {
  readonly id = "fake";
  readonly requests: RepairRequest[] = [];
  constructor(private readonly respond: (req: RepairRequest, call: number) => RepairEdits | Promise<RepairEdits>) {}
  async proposeEdits(req: RepairRequest): Promise<RepairEdits> {
    this.requests.push(req);
    return this.respond(req, this.requests.length);
  }
}

const edit = (startLine: number, endLine: number, replacement: string, findingIds: string[] = []) => ({ startLine, endLine, replacement, findingIds });

const FLOATING = `async function save(): Promise<void> {
  await fetch("/x");
}

export async function run(): Promise<void> {
  save();
}
`;

afterEach(() => setRepairClient(undefined));

describe("patch", () => {
  it("merges padded windows and clamps to the file", () => {
    expect(allowedWindows([{ startLine: 2, endLine: 2 }, { startLine: 5, endLine: 6 }], 2, 7)).toEqual([{ startLine: 1, endLine: 7 }]);
    expect(allowedWindows([{ startLine: 2, endLine: 2 }, { startLine: 20, endLine: 20 }], 1, 30)).toEqual([
      { startLine: 1, endLine: 3 },
      { startLine: 19, endLine: 21 },
    ]);
  });

  it("rejects edits outside windows and overlapping edits", () => {
    const code = "a\nb\nc\nd\ne";
    const windows = [{ startLine: 2, endLine: 3 }];
    const r = applyEdits(code, [edit(2, 2, "B"), edit(2, 3, "X"), edit(5, 5, "E")], windows);
    expect(r.code).toBe("a\nB\nc\nd\ne");
    expect(r.applied).toBe(1);
    expect(r.rejected.map((x) => x.reason)).toEqual(["overlaps another edit", "outside the flagged ranges"]);
  });

  it("supports replacements with a different number of lines", () => {
    const r = applyEdits("a\nb\nc", [edit(2, 2, "b1\nb2\nb3")], [{ startLine: 1, endLine: 3 }]);
    expect(r.code).toBe("a\nb1\nb2\nb3\nc");
  });
});

describe("repair loop", () => {
  it("fixes a finding the tools can't, re-verifies, and marks it fixed by the LLM", async () => {
    const client = new FakeClient((req) => {
      const f = req.findings.find((x) => x.ruleId.includes("no-floating-promises"));
      return { edits: [edit(6, 6, "  await save();", f ? [f.id] : [])], unfixable: [] };
    });
    setRepairClient(client);
    const r = await launder({ code: FLOATING, mode: "fix" });
    expect(r.cleanedCode).toContain("await save();");
    expect(r.verdict).toBe("fixed");
    const f = r.findings.find((x) => x.ruleId === "eslint/@typescript-eslint/no-floating-promises");
    expect(f).toMatchObject({ fixed: true, fixedBy: "llm" });
    expect(r.stagesRun.find((s) => s.id === "repair")).toMatchObject({ status: "ran", changedCode: true });
  });

  it("sends only excerpts around flagged lines, never the whole file", async () => {
    const filler = Array.from({ length: 40 }, (_, i) => `export const v${i} = ${i};`).join("\n");
    const code = `${filler}\n${FLOATING}`;
    const client = new FakeClient(() => ({ edits: [], unfixable: [] }));
    setRepairClient(client);
    await launder({ code, mode: "fix" });
    const req = client.requests[0];
    expect(req).toBeDefined();
    const sent = req?.windows.map((w) => w.text).join("\n") ?? "";
    expect(sent).not.toContain("v0 = 0");
    expect(sent).toContain("save();");
  });

  it("rejects edits outside the flagged ranges (e.g. injected imports)", async () => {
    const client = new FakeClient(() => ({ edits: [edit(1, 1, 'import "evil-package";\nasync function save(): Promise<void> {')], unfixable: [] }));
    setRepairClient(client);
    const filler = Array.from({ length: 20 }, (_, i) => `export const v${i} = ${i};`).join("\n");
    const r = await launder({ code: `${filler}\n${FLOATING}`, mode: "fix" });
    expect(r.cleanedCode).not.toContain("evil-package");
    expect(r.stagesRun.find((s) => s.id === "repair")?.notes?.join(" ")).toMatch(/outside the flagged ranges/);
  });

  it("discards a repair that makes findings worse", async () => {
    const client = new FakeClient(() => ({ edits: [edit(6, 6, '  eval("save()");')], unfixable: [] }));
    setRepairClient(client);
    const r = await launder({ code: FLOATING, mode: "fix" });
    expect(r.cleanedCode).not.toContain("eval");
    expect(r.verdict).toBe("reject");
    expect(r.stagesRun.find((s) => s.id === "repair")?.notes?.join(" ")).toMatch(/did not decrease/);
  });

  it("discards a repair that breaks the syntax", async () => {
    const client = new FakeClient(() => ({ edits: [edit(6, 6, "  await save(;")], unfixable: [] }));
    setRepairClient(client);
    const r = await launder({ code: FLOATING, mode: "fix" });
    expect(r.cleanedCode).toContain("  save();");
    expect(r.stagesRun.find((s) => s.id === "repair")?.notes?.join(" ")).toMatch(/unparseable/);
  });

  it("survives client errors", async () => {
    setRepairClient(new FakeClient(() => Promise.reject(new Error("rate limited"))));
    const r = await launder({ code: FLOATING, mode: "fix" });
    expect(r.verdict).toBe("reject");
    expect(r.stagesRun.find((s) => s.id === "repair")?.notes?.join(" ")).toMatch(/rate limited/);
  });

  it("stops after maxIterations", async () => {
    let calls = 0;
    const code = `async function a(): Promise<void> {}
async function b(): Promise<void> {}
async function c(): Promise<void> {}
async function d(): Promise<void> {}
export async function run(): Promise<void> {
  a();
  b();
  c();
  d();
}
`;
    // Fixes one floating promise per round.
    setRepairClient(
      new FakeClient((req) => {
        calls++;
        const line = Math.min(...req.findings.filter((f) => f.ruleId.includes("floating")).map((f) => f.line));
        return { edits: [edit(line, line, `  await ${["a", "b", "c", "d"][line - 6]}();`)], unfixable: [] };
      }),
    );
    const r = await launder({ code, mode: "fix" });
    expect(calls).toBe(3);
    expect(r.findings.filter((f) => f.ruleId.includes("floating") && !f.fixed)).toHaveLength(1);
  });

  it("never sends secret values to the model", async () => {
    const code = `const token = "${S.GITHUB}";
async function save(t: string): Promise<void> {
  await fetch("/x", { headers: { authorization: t } });
}
export async function run(): Promise<void> {
  save(token);
}
`;
    const client = new FakeClient(() => ({ edits: [], unfixable: [] }));
    setRepairClient(client);
    const r = await launder({ code, mode: "fix" });
    expect(client.requests.length).toBeGreaterThan(0);
    expect(JSON.stringify(client.requests)).not.toContain(S.GITHUB);
    expect(r.verdict).toBe("reject"); // a secret always rejects
  });

  it("does not run in check mode, and is skipped without credentials", async () => {
    const client = new FakeClient(() => ({ edits: [], unfixable: [] }));
    setRepairClient(client);
    await launder({ code: FLOATING, mode: "check" });
    expect(client.requests).toHaveLength(0);

    setRepairClient(undefined);
    const saved = { k: process.env.ANTHROPIC_API_KEY, t: process.env.ANTHROPIC_AUTH_TOKEN, p: process.env.ANTHROPIC_PROFILE };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_PROFILE;
    try {
      const r = await launder({ code: FLOATING, mode: "fix" });
      expect(r.stagesRun.find((s) => s.id === "repair")).toMatchObject({ status: "skipped" });
      expect(r.stagesRun.find((s) => s.id === "repair")?.reason).toMatch(/ANTHROPIC_API_KEY/);
    } finally {
      if (saved.k !== undefined) process.env.ANTHROPIC_API_KEY = saved.k;
      if (saved.t !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = saved.t;
      if (saved.p !== undefined) process.env.ANTHROPIC_PROFILE = saved.p;
    }
  });
});
