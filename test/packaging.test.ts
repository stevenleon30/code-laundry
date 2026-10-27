import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.join(import.meta.dirname, "..");
const json = (p: string) => JSON.parse(readFileSync(path.join(root, p), "utf8"));

describe("packaging", () => {
  const pkg = json("package.json");

  it("exposes the code-laundry bin the plugin launches", () => {
    expect(pkg.name).toBe("code-laundry");
    expect(pkg.bin["code-laundry"]).toBe("dist/cli/index.js");
    expect(pkg.files).toContain("rules");
  });

  it("pins the plugin to the package version being released", () => {
    const manifest = json("plugin/.claude-plugin/plugin.json");
    const mcp = json("plugin/.mcp.json");
    expect(manifest.version).toBe(pkg.version);
    expect(mcp.mcpServers["code-laundry"].args).toEqual(["-y", `code-laundry@${pkg.version}`, "mcp"]);
  });

  it("only passes declared userConfig values to the server", () => {
    const manifest = json("plugin/.claude-plugin/plugin.json");
    const env = json("plugin/.mcp.json").mcpServers["code-laundry"].env as Record<string, string>;
    for (const value of Object.values(env)) {
      const key = /^\$\{user_config\.(\w+)\}$/.exec(value)?.[1];
      expect(key, `env value ${value} must be a user_config reference`).toBeDefined();
      expect(manifest.userConfig[key as string]?.sensitive).toBe(true);
    }
  });

  it("lists the plugin in the repository marketplace", () => {
    const market = json(".claude-plugin/marketplace.json");
    const entry = market.plugins.find((p: { name: string }) => p.name === "code-laundry");
    expect(entry).toBeDefined();
    expect(existsSync(path.join(root, entry.source, ".claude-plugin", "plugin.json"))).toBe(true);
  });
});
