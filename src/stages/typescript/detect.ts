import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { Detected } from "../../core/stage.js";
import type { Language } from "../../core/types.js";

const TS_EXT = new Set([".ts", ".tsx", ".mts", ".cts"]);
const JS_EXT = new Set([".js", ".jsx", ".mjs", ".cjs"]);

/** Syntax that only exists in TypeScript. Used when no filename or hint is given. */
const TS_ONLY =
  /(?:^|[\s(,])(?:interface\s+[A-Z]\w*|type\s+[A-Z]\w*\s*(?:<[^>]*>)?\s*=|enum\s+[A-Z]\w*|implements\s+[A-Z]|(?:private|protected|public|readonly)\s+\w+\s*[:;=(]|declare\s+(?:const|function|module))|\bas\s+(?:const|string|number|unknown|any)\b|\w\s*:\s*(?:string|number|boolean|unknown|any|void|never|Promise<|Record<|Array<)|\)\s*:\s*\w+[\w<>[\]|, ]*\s*(?:=>|\{)|<[A-Z]\w*>\s*\(/m;

export function resolveLanguage(code: string, filename: string | undefined, hint: Language | undefined): Language | undefined {
  if (hint) return hint;
  if (filename) {
    const ext = path.extname(filename).toLowerCase();
    if (TS_EXT.has(ext)) return "typescript";
    if (JS_EXT.has(ext)) return "javascript";
    if (ext) return undefined;
  }
  return TS_ONLY.test(code) ? "typescript" : "javascript";
}

function syntaxErrorCount(code: string, fileName: string): number {
  const out = ts.transpileModule(code, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.Preserve, allowJs: true },
  });
  return out.diagnostics?.length ?? 0;
}

/** JSX is decided by trying both parses: whichever has fewer syntax errors wins. */
export function looksLikeJsx(code: string, language: Language): boolean {
  if (!/<[A-Za-z>]/.test(code)) return false;
  const [plain, jsx] = language === "typescript" ? ["x.ts", "x.tsx"] : ["x.js", "x.jsx"];
  return syntaxErrorCount(code, jsx) < syntaxErrorCount(code, plain);
}

export function defaultFilename(language: Language, code: string): string {
  const jsx = looksLikeJsx(code, language);
  if (language === "typescript") return jsx ? "snippet.tsx" : "snippet.ts";
  return jsx ? "snippet.jsx" : "snippet.js";
}

const FRAMEWORKS: ReadonlyArray<[string, RegExp]> = [
  ["react", /^react(?:-dom)?(?:\/|$)/],
  ["next", /^next(?:\/|$)/],
  ["vue", /^vue$/],
  ["svelte", /^svelte(?:\/|$)/],
  ["angular", /^@angular\//],
  ["express", /^express$/],
  ["fastify", /^fastify$/],
  ["koa", /^koa$/],
  ["hono", /^hono(?:\/|$)/],
  ["nestjs", /^@nestjs\//],
  ["prisma", /^@prisma\/client$/],
];

export function extractImports(code: string): string[] {
  const info = ts.preProcessFile(code, true, true);
  return [...new Set(info.importedFiles.map((f) => f.fileName))];
}

const ESLINT_CONFIGS = ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts", "eslint.config.mts", "eslint.config.cts"];
const PRETTIER_CONFIGS = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.yaml",
  ".prettierrc.yml",
  ".prettierrc.json5",
  ".prettierrc.js",
  ".prettierrc.mjs",
  ".prettierrc.cjs",
  ".prettierrc.toml",
  "prettier.config.js",
  "prettier.config.mjs",
  "prettier.config.cjs",
];

function firstExisting(root: string, names: readonly string[]): string | undefined {
  for (const n of names) {
    const p = path.join(root, n);
    if (existsSync(p)) return p;
  }
  return undefined;
}

function packageJsonHasPrettier(root: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as Record<string, unknown>;
    return pkg.prettier !== undefined;
  } catch {
    return false;
  }
}

export async function detect(code: string, filePath: string, language: Language, projectRoot: string | undefined): Promise<Detected> {
  const imports = extractImports(code);
  const frameworks = FRAMEWORKS.filter(([, re]) => imports.some((i) => re.test(i))).map(([name]) => name);
  const ext = path.extname(filePath).toLowerCase();
  const projectConfigs: Detected["projectConfigs"] = {};
  if (projectRoot) {
    const tsconfig = ts.findConfigFile(path.dirname(filePath), ts.sys.fileExists, "tsconfig.json");
    if (tsconfig && path.resolve(tsconfig).startsWith(path.resolve(projectRoot))) projectConfigs.tsconfig = tsconfig;
    const eslint = firstExisting(projectRoot, ESLINT_CONFIGS);
    if (eslint) projectConfigs.eslint = eslint;
    const prettier = firstExisting(projectRoot, PRETTIER_CONFIGS) ?? (packageJsonHasPrettier(projectRoot) ? path.join(projectRoot, "package.json") : undefined);
    if (prettier) projectConfigs.prettier = prettier;
  }
  return { language, jsx: ext === ".tsx" || ext === ".jsx", frameworks, projectConfigs, imports };
}
