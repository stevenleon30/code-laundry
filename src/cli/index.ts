#!/usr/bin/env node
import { existsSync, realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ConfigError, loadConfig } from "../core/config.js";
import { assertSize, InputError } from "../core/input.js";
import { launder, UnsupportedLanguageError } from "../core/pipeline.js";
import { type Finding, type LaunderResult, type Mode, severityRank } from "../core/types.js";
import { runDepsTool } from "../deps/tool.js";
import { startStdioServer, VERSION } from "../mcp/server.js";

const USAGE = `code-laundry ${VERSION}: check and clean AI-generated code

Usage:
  code-laundry mcp                start the MCP server on stdio
  code-laundry check <file|->     report findings, change nothing
  code-laundry fix <file|->       apply fixes and write the file back
  code-laundry deps [package.json | <name>[@version]...]
                                  check packages for hallucinations, typosquats, CVEs

Options:
  --strict            medium findings and missing security tools also reject
  --project <dir>     project root (default: nearest directory with package.json)
  --no-project        don't use any project configuration
  --config <file>     path to .codelaundry.json
  --filename <name>   name to use for stdin input (picks the language)
  --stdout            fix: print cleaned code instead of writing the file
  --diff              print the unified diff
  --json              print the full JSON result
  -h, --help          show this help

Exit codes: 0 pass/fixed, 1 reject, 2 usage or internal error.`;

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = paint("31");
const yellow = paint("33");
const green = paint("32");
const dim = paint("2");
const bold = paint("1");

const SEV_COLOR: Record<string, (s: string) => string> = { critical: (s) => bold(red(s)), high: red, medium: yellow, low: dim };

function findProjectRoot(file: string): string | undefined {
  let dir = path.dirname(path.resolve(file));
  for (;;) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function printFindings(findings: Finding[], label: string): void {
  const sorted = [...findings].sort(
    (a, b) => Number(a.fixed) - Number(b.fixed) || severityRank[b.severity] - severityRank[a.severity] || (a.location?.line ?? 0) - (b.location?.line ?? 0),
  );
  for (const f of sorted) {
    const where = f.location ? `${label}:${f.location.line}:${f.location.column}` : label;
    const sev = (SEV_COLOR[f.severity] ?? ((s: string) => s))(f.severity.padEnd(8));
    const tag = f.fixed ? green(` [fixed${f.fixedBy === "llm" ? " by LLM" : ""}]`) : "";
    console.log(`${sev} ${where}  ${f.message}${tag}  ${dim(f.ruleId)}`);
  }
}

function printSummary(r: LaunderResult, label: string, showDiff: boolean): void {
  printFindings(r.findings, label);
  const notRun = r.stagesRun.filter((s) => s.status !== "ran" && s.reason !== "disabled by config");
  for (const s of notRun) console.log(dim(`${s.status === "failed" ? "failed " : "skipped"} ${s.id}: ${s.reason ?? ""}`));
  if (showDiff && r.diff) console.log(`\n${r.diff}`);
  const v = r.verdict === "reject" ? red(bold("REJECT")) : r.verdict === "fixed" ? green(bold("FIXED")) : green(bold("PASS"));
  console.log(`\n${v} ${label}: ${r.verdictReasons.join("; ")} ${dim(`(${r.durationMs}ms)`)}`);
}

async function runLaunder(cmd: "check" | "fix", target: string, values: Record<string, string | boolean | undefined>): Promise<number> {
  const fromStdin = target === "-";
  const code = fromStdin ? await readStdin() : await readFile(target, "utf8");
  assertSize(code);
  const filename = (values.filename as string | undefined) ?? (fromStdin ? undefined : path.basename(target));
  const projectRoot = values["no-project"] ? undefined : ((values.project as string | undefined) ?? (fromStdin ? undefined : findProjectRoot(target)));
  // Inside a project, use the path relative to its root so the project's configs apply to it.
  const relName = projectRoot && !fromStdin ? path.relative(projectRoot, path.resolve(target)) : filename;
  const mode: Mode = values.strict ? "strict" : cmd === "check" ? "check" : "fix";
  const result = await launder({
    code,
    mode,
    ...(relName ? { filename: relName } : {}),
    ...(projectRoot ? { projectRoot } : {}),
    ...(values.config ? { configPath: values.config as string } : {}),
  });

  const label = fromStdin ? (filename ?? "<stdin>") : target;
  if (values.json) console.log(JSON.stringify(result, null, 2));
  else printSummary(result, label, Boolean(values.diff));

  if (cmd === "fix" && result.cleanedCode !== code) {
    if (result.findings.some((f) => f.category === "secret")) {
      // cleanedCode has secrets replaced by [REDACTED:...] markers; writing it would break the file.
      console.error(yellow("not writing: the file contains a hardcoded secret. Move it to configuration, rotate it, and rerun."));
    } else if (values.stdout || fromStdin) {
      if (!values.json) process.stdout.write(result.cleanedCode);
    } else {
      await writeFile(target, result.cleanedCode);
      if (!values.json) console.log(dim(`wrote ${target}`));
    }
  }
  return result.verdict === "reject" ? 1 : 0;
}

async function runDeps(targets: string[], values: Record<string, string | boolean | undefined>): Promise<number> {
  const mode: Mode = values.strict ? "strict" : "check";
  const projectRoot = values.project as string | undefined;
  const config = await loadConfig({ ...(projectRoot ? { projectRoot } : {}), ...(values.config ? { configPath: values.config as string } : {}) });
  const pkgFile = targets.length === 0 ? "package.json" : targets.length === 1 && targets[0]?.endsWith(".json") ? targets[0] : undefined;
  const input = pkgFile ? { packageJson: await readFile(pkgFile, "utf8") } : { imports: targets };
  const r = await runDepsTool({ ...input, ...(projectRoot ? { projectRoot } : {}) }, config, mode);
  if (values.json) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    printFindings(r.findings, pkgFile ?? "deps");
    for (const n of r.notes) console.log(dim(n));
    console.log(`\n${r.verdict === "reject" ? red(bold("REJECT")) : green(bold("PASS"))} ${r.packages.length} package(s): ${r.verdictReasons.join("; ")}`);
  }
  return r.verdict === "reject" ? 1 : 0;
}

export async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        strict: { type: "boolean" },
        project: { type: "string" },
        "no-project": { type: "boolean" },
        config: { type: "string" },
        filename: { type: "string" },
        stdout: { type: "boolean" },
        diff: { type: "boolean" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.version) {
    console.log(VERSION);
    return 0;
  }
  const [cmd, ...rest] = positionals;
  if (values.help || !cmd) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }
  if (cmd === "mcp") {
    // Runs until stdin closes; the process is kept alive by the transport.
    await startStdioServer();
    return -1;
  }
  try {
    if (cmd === "check" || cmd === "fix") {
      if (rest.length !== 1 || !rest[0]) throw new InputError(`${cmd} takes exactly one file (or - for stdin)`);
      return await runLaunder(cmd, rest[0], values);
    }
    if (cmd === "deps") return await runDeps(rest, values);
    throw new InputError(`unknown command "${cmd}"`);
  } catch (err) {
    const known = err instanceof InputError || err instanceof ConfigError || err instanceof UnsupportedLanguageError || (err as NodeJS.ErrnoException).code === "ENOENT";
    console.error(red(known ? (err as Error).message : `internal error: ${(err as Error).stack ?? String(err)}`));
    if (err instanceof InputError) console.error(`\n${USAGE}`);
    return 2;
  }
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      if (code >= 0) process.exit(code);
    },
    (err: unknown) => {
      process.stderr.write(`fatal: ${(err as Error).message}\n`);
      process.exit(2);
    },
  );
}
