import { describe, expect, it } from "vitest";
import { defaultConfig, LaundryConfig } from "../src/core/config.js";
import { makeFinding } from "../src/core/stage.js";
import type { Category, Severity } from "../src/core/types.js";
import { computeVerdict } from "../src/core/verdict.js";

const f = (severity: Severity, opts: { fixed?: boolean; category?: Category } = {}) =>
  makeFinding({ ruleId: "r", source: "t", category: opts.category ?? "lint", severity, message: "m", fixed: opts.fixed ?? false });

describe("computeVerdict", () => {
  const cfg = defaultConfig();

  it("passes with no findings", () => {
    expect(computeVerdict([], cfg, "check").verdict).toBe("pass");
  });

  it("is fixed when every finding was fixed", () => {
    expect(computeVerdict([f("high", { fixed: true }), f("low", { fixed: true })], cfg, "fix").verdict).toBe("fixed");
  });

  it("rejects on unfixed high or critical", () => {
    expect(computeVerdict([f("high")], cfg, "fix").verdict).toBe("reject");
    expect(computeVerdict([f("critical")], cfg, "check").verdict).toBe("reject");
  });

  it("treats unfixed low/medium as non-blocking warnings outside strict mode", () => {
    const r = computeVerdict([f("medium"), f("low", { fixed: true })], cfg, "fix");
    expect(r.verdict).toBe("fixed");
    expect(r.reasons[0]).toMatch(/1 non-blocking warning/);
    expect(computeVerdict([f("medium")], cfg, "check").verdict).toBe("pass");
  });

  it("rejects medium in strict mode", () => {
    expect(computeVerdict([f("medium")], cfg, "strict").verdict).toBe("reject");
  });

  it("always rejects secrets, even if marked fixed", () => {
    expect(computeVerdict([f("low", { fixed: true, category: "secret" })], cfg, "fix").verdict).toBe("reject");
  });

  it("rejects syntax errors and hallucinated dependencies", () => {
    expect(computeVerdict([f("low", { category: "syntax" })], cfg, "check").verdict).toBe("reject");
    expect(computeVerdict([f("low", { category: "hallucinated-dependency" })], cfg, "check").verdict).toBe("reject");
  });

  it("honours configurable thresholds", () => {
    const lenient = LaundryConfig.parse({ thresholds: { rejectOn: ["critical"], rejectOnHallucinatedDependency: false } });
    expect(computeVerdict([f("high")], lenient, "check").verdict).toBe("pass");
    expect(computeVerdict([f("low", { category: "hallucinated-dependency" })], lenient, "check").verdict).toBe("pass");
  });
});
