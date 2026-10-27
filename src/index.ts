/** Library entry point: the same pipeline the CLI and MCP server use. */
export { ConfigError, defaultConfig, LaundryConfig, loadConfig } from "./core/config.js";
export { launder, type LaunderInput, UnsupportedLanguageError } from "./core/pipeline.js";
export { Finding, LaunderResult, Severity, Verdict } from "./core/types.js";
export { checkDependencies } from "./deps/check.js";
export { runDepsTool } from "./deps/tool.js";
export { explainFindings } from "./explain/explain.js";
export { createServer, VERSION } from "./mcp/server.js";
