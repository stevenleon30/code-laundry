import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, matchesPattern } from "../src/core/config.js";

describe("config", () => {
  it("returns defaults when no file exists", async () => {
    const cfg = await loadConfig({ projectRoot: os.tmpdir() + "/does-not-exist" });
    expect(cfg.repair.maxIterations).toBe(3);
    expect(cfg.thresholds.rejectOn).toEqual(["critical", "high"]);
  });

  it("rejects unknown keys and bad values loudly", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "cl-cfg-"));
    await writeFile(path.join(dir, ".codelaundry.json"), JSON.stringify({ repair: { maxIterations: 99 } }));
    await expect(loadConfig({ projectRoot: dir })).rejects.toBeInstanceOf(ConfigError);
    await writeFile(path.join(dir, ".codelaundry.json"), JSON.stringify({ typo: true }));
    await expect(loadConfig({ projectRoot: dir })).rejects.toBeInstanceOf(ConfigError);
    await writeFile(path.join(dir, ".codelaundry.json"), "{ not json");
    await expect(loadConfig({ projectRoot: dir })).rejects.toThrow(/Invalid JSON/);
  });

  it("errors when an explicit configPath is missing", async () => {
    await expect(loadConfig({ configPath: "/nope/.codelaundry.json" })).rejects.toBeInstanceOf(ConfigError);
  });

  it("matches exact and prefix patterns", () => {
    expect(matchesPattern("@acme/ui", ["@acme/*"])).toBe(true);
    expect(matchesPattern("lodash", ["lodash"])).toBe(true);
    expect(matchesPattern("lodash-es", ["lodash"])).toBe(false);
  });
});
