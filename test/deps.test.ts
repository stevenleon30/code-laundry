import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig, LaundryConfig } from "../src/core/config.js";
import { launder } from "../src/core/pipeline.js";
import { checkDependencies } from "../src/deps/check.js";
import { packageNameFromSpecifier, typosquatTarget } from "../src/deps/names.js";
import { FixtureDepsProvider } from "../src/deps/provider.js";
import { parseImportArg, runDepsTool } from "../src/deps/tool.js";

const fixture = FixtureDepsProvider.fromFile(path.join(import.meta.dirname, "fixtures", "deps-fixture.json"));
const rules = (r: { findings: { ruleId: string }[] }) => r.findings.map((f) => f.ruleId);
const check = (names: string[], extra: Partial<Parameters<typeof checkDependencies>[1]> = {}) =>
  checkDependencies(
    names.map((n) => parseImportArg(n)).filter((x) => x !== undefined),
    { config: defaultConfig(), mode: "check", provider: fixture, ...extra },
  );

describe("package names", () => {
  it("maps specifiers to package names", () => {
    expect(packageNameFromSpecifier("lodash/fp")).toBe("lodash");
    expect(packageNameFromSpecifier("@scope/pkg/deep/path")).toBe("@scope/pkg");
    expect(packageNameFromSpecifier("node:fs")).toBeUndefined();
    expect(packageNameFromSpecifier("fs/promises")).toBeUndefined();
    expect(packageNameFromSpecifier("./local")).toBeUndefined();
    expect(packageNameFromSpecifier("@/components/x")).toBeUndefined();
  });

  it("detects typosquats of popular packages only", () => {
    expect(typosquatTarget("lodahs")).toBe("lodash");
    expect(typosquatTarget("expresss")).toBe("express");
    expect(typosquatTarget("reactjs")).toBe("react");
    expect(typosquatTarget("lodash")).toBeUndefined();
    expect(typosquatTarget("preact")).toBeUndefined();
    expect(typosquatTarget("my-internal-utils")).toBeUndefined();
  });

  it("parses name@version arguments", () => {
    expect(parseImportArg("lodash@4.17.15")).toEqual({ name: "lodash", range: "4.17.15" });
    expect(parseImportArg("@anthropic-ai/sdk@^1.0.0")).toEqual({ name: "@anthropic-ai/sdk", range: "^1.0.0" });
    expect(parseImportArg("@anthropic-ai/sdk")).toEqual({ name: "@anthropic-ai/sdk" });
  });
});

describe("checkDependencies", () => {
  it("flags hallucinated packages as critical, with a suggestion", async () => {
    const r = await check(["expres-validator-pro", "reactt"]);
    const nf = r.findings.filter((f) => f.ruleId === "deps/not-found");
    expect(nf).toHaveLength(2);
    expect(nf.every((f) => f.category === "hallucinated-dependency" && f.severity === "critical")).toBe(true);
    expect(nf.find((f) => f.message.includes("reactt"))?.message).toContain('Did you mean "react"');
  });

  it("flags packages npm removed as malicious", async () => {
    const r = await check(["lodahs"]);
    expect(rules(r)).toEqual(["deps/removed-malicious"]);
  });

  it("flags typosquats, new and unpopular packages", async () => {
    const r = await check(["expresss", "brand-new-helper"]);
    expect(rules(r)).toEqual(expect.arrayContaining(["deps/typosquat", "deps/low-downloads", "deps/new-package"]));
    expect(r.findings.find((f) => f.ruleId === "deps/typosquat")?.severity).toBe("high");
  });

  it("flags vulnerable versions with an upgrade target, and deprecated packages", async () => {
    const r = await check(["lodash@4.17.15", "request"]);
    const v = r.findings.find((f) => f.ruleId === "deps/vulnerable");
    expect(v?.severity).toBe("high");
    expect(v?.message).toContain("Upgrade to 4.17.21");
    expect(rules(r)).toContain("deps/deprecated");
    const clean = await check(["lodash"]);
    expect(clean.findings).toEqual([]);
  });

  it("respects allowedPackages", async () => {
    const config = LaundryConfig.parse({ allowedPackages: ["@acme/*"] });
    const r = await check(["@acme/internal-thing"], { config });
    expect(r.findings).toEqual([]);
    expect(r.packages[0]?.status).toBe("allowed");
  });

  it("reports unavailable services instead of passing silently; strict mode blocks", async () => {
    const down = new FixtureDepsProvider({ packages: { lodash: { latest: "4.17.21" } }, unavailable: ["osv", "downloads"] });
    const lax = await check(["lodash"], { provider: down });
    expect(lax.findings).toEqual([]);
    expect(lax.unavailable.join(" ")).toMatch(/vulnerability database/);
    const strict = await check(["lodash"], { provider: down, mode: "strict" });
    expect(rules(strict)).toEqual(["laundry/stage-unavailable"]); // downloads alone don't block
  });
});

describe("pipeline deps stage", () => {
  it("flags hallucinated imports and rejects", async () => {
    const code = `import { parse } from "super-fast-csv-parser-pro";\nexport const rows = parse("a,b");\n`;
    const r = await launder({ code, mode: "check" });
    expect(r.verdict).toBe("reject");
    expect(r.verdictReasons).toContain("hallucinated dependency");
    expect(r.findings.find((f) => f.ruleId === "deps/not-found")?.location?.line).toBe(1);
  });

  it("checks require() calls too and ignores built-ins", async () => {
    const code = `const fs = require("fs");\nconst x = require("lodahs");\nmodule.exports = { fs, x };\n`;
    const r = await launder({ code, mode: "check" });
    expect(rules(r)).toContain("deps/removed-malicious");
  });
});

describe("check_dependencies tool", () => {
  it("checks a package.json", async () => {
    const pkg = { dependencies: { lodash: "4.17.15", "nope-not-real-zz": "^1.0.0", local: "file:../x" }, devDependencies: { request: "^2.88.0" } };
    const r = await runDepsTool({ packageJson: pkg }, defaultConfig(), "check");
    expect(r.verdict).toBe("reject");
    expect(rules(r)).toEqual(expect.arrayContaining(["deps/vulnerable", "deps/not-found", "deps/deprecated"]));
    expect(r.packages.map((p) => p.name)).not.toContain("local");
  });
});
