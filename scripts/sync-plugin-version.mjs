// Keeps the Claude plugin pinned to the npm version being released.
// Runs from the npm "version" lifecycle (npm version / pnpm version).
import { readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));

const manifestPath = "plugin/.claude-plugin/plugin.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.version = version;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const mcpPath = "plugin/.mcp.json";
const mcp = JSON.parse(readFileSync(mcpPath, "utf8"));
for (const server of Object.values(mcp.mcpServers)) {
  server.args = server.args.map((a) => (a.startsWith("code-laundry@") ? `code-laundry@${version}` : a));
}
writeFileSync(mcpPath, `${JSON.stringify(mcp, null, 2)}\n`);

console.log(`plugin pinned to code-laundry@${version}`);
