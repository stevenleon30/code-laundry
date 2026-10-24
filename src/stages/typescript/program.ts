import { statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

/**
 * In-memory TypeScript program for the submitted code. The submitted file is
 * virtual: tools see it at `filePath`, but nothing is written to disk. Library and
 * project files are read from disk and cached (keyed by mtime) across calls, which
 * is what makes repeated checks from a long-lived MCP server fast.
 */

const require = createRequire(import.meta.url);

/** Type roots shipped with Code Laundry, so `process`, `node:fs` etc. resolve without a project. */
function ownTypeRoot(): string | undefined {
  try {
    return path.dirname(path.dirname(require.resolve("@types/node/package.json")));
  } catch {
    return undefined;
  }
}
const OWN_TYPE_ROOT = ownTypeRoot();

export interface TsProject {
  options: ts.CompilerOptions;
  /** The tsconfig.json the options came from, if any. */
  tsconfigPath?: string;
  /** Diagnostic text if the project's tsconfig could not be used. */
  configError?: string;
}

function defaultOptions(projectRoot: string | undefined): ts.CompilerOptions {
  const typeRoots = [projectRoot && path.join(projectRoot, "node_modules", "@types"), OWN_TYPE_ROOT].filter(
    (p): p is string => Boolean(p),
  );
  return {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    skipLibCheck: true,
    allowJs: true,
    jsx: ts.JsxEmit.ReactJSX,
    lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    types: ["node"],
    typeRoots,
  };
}

const projectCache = new Map<string, { mtime: number; project: TsProject }>();

export function loadTsProject(projectRoot: string | undefined, tsconfigPath: string | undefined): TsProject {
  if (!projectRoot || !tsconfigPath) return { options: { ...defaultOptions(projectRoot), noEmit: true } };
  const mtime = safeMtime(tsconfigPath);
  const cached = projectCache.get(tsconfigPath);
  if (cached && cached.mtime === mtime) return cached.project;

  const read = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  let project: TsProject;
  if (read.error) {
    project = {
      options: { ...defaultOptions(projectRoot), noEmit: true },
      configError: ts.flattenDiagnosticMessageText(read.error.messageText, "\n"),
    };
  } else {
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(tsconfigPath), undefined, tsconfigPath);
    const options: ts.CompilerOptions = {
      ...parsed.options,
      noEmit: true,
      incremental: false,
      composite: false,
      allowJs: true,
      tsBuildInfoFile: undefined,
      declaration: false,
      emitDeclarationOnly: false,
    };
    project = { options, tsconfigPath };
  }
  projectCache.set(tsconfigPath, { mtime, project });
  return project;
}

function safeMtime(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return -1;
  }
}

export function scriptKindFor(filePath: string): ts.ScriptKind {
  switch (path.extname(filePath).toLowerCase()) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

// ---- source file cache for on-disk files (libs, node_modules, project files) ----

const MAX_CACHED_FILES = 4000;
const sourceFileCache = new Map<string, ts.SourceFile>();

function cacheKey(fileName: string, version: ts.ScriptTarget | ts.CreateSourceFileOptions): string {
  const v = typeof version === "object" ? `${version.languageVersion}/${version.impliedNodeFormat ?? ""}` : String(version);
  return `${fileName}|${v}|${safeMtime(fileName)}`;
}

function createHost(options: ts.CompilerOptions, virtualPath: string, code: string): ts.CompilerHost {
  const base = ts.createCompilerHost(options, true);
  const isVirtual = (f: string) => path.resolve(f) === virtualPath;
  return {
    ...base,
    getSourceFile(fileName, languageVersion, onError, shouldCreate) {
      if (isVirtual(fileName)) {
        return ts.createSourceFile(fileName, code, languageVersion, true, scriptKindFor(fileName));
      }
      const key = cacheKey(fileName, languageVersion);
      const hit = sourceFileCache.get(key);
      if (hit) return hit;
      const sf = base.getSourceFile(fileName, languageVersion, onError, shouldCreate);
      if (sf) {
        if (sourceFileCache.size >= MAX_CACHED_FILES) sourceFileCache.clear();
        sourceFileCache.set(key, sf);
      }
      return sf;
    },
    fileExists: (f) => isVirtual(f) || base.fileExists(f),
    readFile: (f) => (isVirtual(f) ? code : base.readFile(f)),
    writeFile: () => {
      /* never emit */
    },
  };
}

// ---- program memo: lint (type-aware) and typecheck share one program per code version ----

interface ProgramEntry {
  key: string;
  program: ts.Program;
  sourceFile: ts.SourceFile;
}
const recentPrograms: ProgramEntry[] = [];

export function getProgram(
  filePath: string,
  code: string,
  project: TsProject,
  extraOptions: ts.CompilerOptions = {},
): { program: ts.Program; sourceFile: ts.SourceFile } {
  const options = { ...project.options, ...extraOptions };
  const key = `${filePath}\0${JSON.stringify(extraOptions)}\0${project.tsconfigPath ?? ""}\0${code}`;
  const hit = recentPrograms.find((e) => e.key === key);
  if (hit) return hit;
  const program = ts.createProgram({ rootNames: [filePath], options, host: createHost(options, filePath, code) });
  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) throw new Error(`internal: virtual file ${filePath} missing from program`);
  recentPrograms.unshift({ key, program, sourceFile });
  if (recentPrograms.length > 4) recentPrograms.pop();
  return { program, sourceFile };
}

export function toLocation(sf: ts.SourceFile, start: number, length: number) {
  const s = sf.getLineAndCharacterOfPosition(start);
  const e = sf.getLineAndCharacterOfPosition(start + Math.max(length, 0));
  return { line: s.line + 1, column: s.character + 1, endLine: e.line + 1, endColumn: e.character + 1 };
}

/** Deepest node whose span contains `pos`. */
export function nodeAt(sf: ts.SourceFile, pos: number): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (n: ts.Node): void => {
    if (pos >= n.getStart(sf) && pos < n.getEnd()) {
      found = n;
      ts.forEachChild(n, visit);
    }
  };
  visit(sf);
  return found;
}

/** `node_modules/@scope/pkg/...` → `@scope/pkg`; `@types/x` → `x`; TS lib files → undefined. */
export function packageFromPath(fileName: string): { name: string; root: string } | undefined {
  const norm = fileName.split(path.sep).join("/");
  const idx = norm.lastIndexOf("/node_modules/");
  if (idx === -1) return undefined;
  const rest = norm.slice(idx + "/node_modules/".length).split("/");
  const name = rest[0]?.startsWith("@") ? `${rest[0]}/${rest[1] ?? ""}` : (rest[0] ?? "");
  if (!name || name === "typescript") return undefined;
  const root = norm.slice(0, idx + "/node_modules/".length) + name;
  if (!name.startsWith("@types/")) return { name, root };
  const typed = name.slice("@types/".length);
  return { name: typed.includes("__") ? `@${typed.replace("__", "/")}` : typed, root };
}

const versionCache = new Map<string, string | undefined>();
export function packageVersion(root: string): string | undefined {
  if (!versionCache.has(root)) {
    try {
      versionCache.set(root, (JSON.parse(ts.sys.readFile(path.join(root, "package.json")) ?? "{}") as { version?: string }).version);
    } catch {
      versionCache.set(root, undefined);
    }
  }
  return versionCache.get(root);
}
