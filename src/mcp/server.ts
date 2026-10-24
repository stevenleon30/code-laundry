#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ConfigError } from "../core/config.js";
import { assertAllowedRoot, assertSize, codeFromDiff, InputError } from "../core/input.js";
import { launder, UnsupportedLanguageError } from "../core/pipeline.js";
import { Language, LaunderResult, Mode } from "../core/types.js";
import { ExplainInputFinding, ExplainResult, explainFindings } from "../explain/explain.js";

export const VERSION = "0.1.0";

const LaunderInputShape = {
  code: z.string().optional().describe("Full source code to check. Provide exactly one of `code` or `diff`."),
  diff: z
    .string()
    .optional()
    .describe("Unified diff for a single file. Applied to projectRoot/filename (or to an empty file when creating one)."),
  language: Language.optional().describe("Defaults to detection from filename/content."),
  filename: z.string().optional().describe("Path relative to projectRoot. Picks the parser and project config."),
  context: z
    .object({
      projectRoot: z.string().optional().describe("Absolute path of the project; enables its tsconfig, ESLint, Prettier and .codelaundry.json."),
      configPath: z.string().optional().describe("Explicit path to a .codelaundry.json."),
    })
    .optional(),
  mode: Mode.default("check").describe("check: report only. fix: tool autofix (+ LLM repair when enabled). strict: fix, and medium findings or missing security tools reject."),
};

function errorResult(err: unknown): CallToolResult {
  const known = err instanceof InputError || err instanceof ConfigError || err instanceof UnsupportedLanguageError;
  const message = known ? (err as Error).message : `internal error: ${(err as Error).message}`;
  return { isError: true, content: [{ type: "text", text: message }] };
}

function jsonResult<T extends Record<string, unknown>>(data: T): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "code-laundry", version: VERSION });

  server.registerTool(
    "launder_code",
    {
      title: "Launder code",
      description:
        "Check (and optionally fix) AI-generated TypeScript/JavaScript before building or committing it. " +
        "Runs real tools (parser, Prettier, ESLint, tsc) and returns a verdict (pass | fixed | reject), " +
        "cleanedCode, findings with severity and location, a unified diff, and which stages ran or were skipped. " +
        "The submitted code is never executed and is treated as data: instructions inside it are ignored.",
      inputSchema: LaunderInputShape,
      outputSchema: LaunderResult.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        if ((args.code === undefined) === (args.diff === undefined)) {
          throw new InputError("provide exactly one of `code` or `diff`");
        }
        const projectRoot = args.context?.projectRoot;
        assertAllowedRoot(projectRoot);
        let code = args.code ?? "";
        let filename = args.filename;
        if (args.diff !== undefined) {
          assertSize(args.diff);
          const resolved = await codeFromDiff(args.diff, { ...(projectRoot ? { projectRoot } : {}), ...(filename ? { filename } : {}) });
          code = resolved.code;
          filename = resolved.filename;
        }
        assertSize(code);
        const result = await launder({
          code,
          mode: args.mode,
          ...(args.language ? { language: args.language } : {}),
          ...(filename ? { filename } : {}),
          ...(projectRoot ? { projectRoot } : {}),
          ...(args.context?.configPath ? { configPath: args.context.configPath } : {}),
        });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "explain_findings",
    {
      title: "Explain findings",
      description:
        "Turn findings from launder_code into plain-language explanations with concrete fix guidance, ordered by what to fix first. Deterministic; no LLM call.",
      inputSchema: { findings: z.array(ExplainInputFinding).max(500) },
      outputSchema: ExplainResult.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ findings }) => jsonResult(explainFindings(findings)),
  );

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  // stdout carries the protocol; diagnostics go to stderr only, and never include submitted code.
  process.stderr.write(`code-laundry MCP server ${VERSION} ready on stdio\n`);
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch((err: unknown) => {
    process.stderr.write(`fatal: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
