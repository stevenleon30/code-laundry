import ts from "typescript";
import { makeFinding, snippetAt, type Stage } from "../../core/stage.js";
import type { Finding, Severity } from "../../core/types.js";
import { getProgram, loadTsProject, nodeAt, packageFromPath, packageVersion, toLocation } from "./program.js";

/** Module-resolution errors: meaningless without a project (no node_modules); deps stage covers existence. */
const UNRESOLVED_MODULE_CODES = new Set([2307, 7016, 2875, 2792]);

/** Errors that only exist because of strict-mode flags we impose when there is no project tsconfig. */
const STRICTNESS_CODES = new Set([7005, 7006, 7008, 7019, 7031, 7034, 7053, 2531, 2532, 2533, 2564, 18046, 18047, 18048, 18049]);

/** For plain JS we only trust a few checkJs diagnostics; the rest are noisy inference failures. */
const JS_TRUSTED_CODES = new Set([2304, 2552, 2588, 2349, 2554, 2555, 2339, 2551, 2300, 2451]);

/** Diagnostics that, when they point at a package's declarations, mean the API doesn't exist as used. */
const API_MISMATCH_CODES = new Set([2305, 2614, 2724, 2339, 2551, 2554, 2555, 2353, 2769, 2559, 2561]);

function declaredIn(decls: readonly ts.Declaration[] | undefined): { name: string; root: string } | undefined {
  for (const d of decls ?? []) {
    const origin = packageFromPath(d.getSourceFile().fileName);
    if (origin) return origin;
  }
  return undefined;
}

function symbolDecls(checker: ts.TypeChecker, node: ts.Node): readonly ts.Declaration[] | undefined {
  let sym = checker.getSymbolAtLocation(node);
  if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
  return sym?.declarations ?? checker.getTypeAtLocation(node).getSymbol()?.declarations;
}

/**
 * If a type error is about a package's API (missing export, missing member, wrong
 * arguments/options), return that package. Errors about the caller's own types return undefined.
 */
export function apiMismatchOrigin(program: ts.Program, sf: ts.SourceFile, d: ts.Diagnostic): { name: string; version?: string } | undefined {
  if (d.start === undefined || !API_MISMATCH_CODES.has(d.code)) return undefined;
  const node = nodeAt(sf, d.start);
  if (!node) return undefined;
  const checker = program.getTypeChecker();
  let origin: { name: string; root: string } | undefined;
  for (let p: ts.Node | undefined = node; p && !origin; p = p.parent) {
    if (ts.isImportDeclaration(p)) {
      const spec = p.moduleSpecifier;
      if (ts.isStringLiteral(spec) && !spec.text.startsWith(".")) origin = declaredIn(checker.getSymbolAtLocation(spec)?.declarations);
      break;
    }
    if (ts.isPropertyAccessExpression(p) && (d.code === 2339 || d.code === 2551)) {
      origin = declaredIn(symbolDecls(checker, p.expression));
      break;
    }
    if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
      const callee = ts.isPropertyAccessExpression(p.expression) ? p.expression.name : p.expression;
      origin = declaredIn(symbolDecls(checker, callee));
      break;
    }
    if (ts.isStatement(p)) break;
  }
  if (!origin) return undefined;
  const version = packageVersion(origin.root);
  return { name: origin.name, ...(version ? { version } : {}) };
}

/**
 * Implicit-any on a callback parameter whose callee is itself `any` (typically an
 * unresolved import such as express without a project) is noise, not a defect.
 */
function isUntypedCallbackParam(program: ts.Program, sf: ts.SourceFile, d: ts.Diagnostic): boolean {
  if ((d.code !== 7006 && d.code !== 7031) || d.start === undefined) return false;
  let fn: ts.Node | undefined = nodeAt(sf, d.start);
  while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
  const call = fn?.parent;
  if (!fn || !call || !(ts.isCallExpression(call) || ts.isNewExpression(call))) return false;
  const calleeType = program.getTypeChecker().getTypeAtLocation(call.expression);
  return (calleeType.flags & ts.TypeFlags.Any) !== 0;
}

function severityFor(code: number, hasProjectTsconfig: boolean): Severity {
  if (STRICTNESS_CODES.has(code)) return hasProjectTsconfig ? "high" : "medium";
  return "high";
}

export const typecheckStage: Stage = {
  id: "ts.typecheck",
  kind: "typecheck",
  languages: ["typescript", "javascript"],
  canFix: false,
  defaultEnabled: true,
  available: async () => ({ ok: true }),
  async run(ctx) {
    const notes: string[] = [];
    const project = loadTsProject(ctx.projectRoot, ctx.detected.projectConfigs.tsconfig);
    if (project.configError) notes.push(`project tsconfig unusable (${project.configError}); used defaults`);
    else if (project.tsconfigPath) notes.push(`using ${project.tsconfigPath}`);
    else notes.push("no project tsconfig; using strict defaults (strictness errors reported as medium)");

    const isJs = ctx.detected.language === "javascript";
    const { program, sourceFile } = getProgram(ctx.filePath, ctx.code, project, isJs ? { checkJs: true } : {});
    const diagnostics = program.getSemanticDiagnostics(sourceFile);
    const hasProject = Boolean(project.tsconfigPath);

    const findings: Finding[] = [];
    for (const d of diagnostics) {
      if (d.category !== ts.DiagnosticCategory.Error) continue;
      if (UNRESOLVED_MODULE_CODES.has(d.code) && !ctx.projectRoot) continue;
      if (isJs && !JS_TRUSTED_CODES.has(d.code)) continue;
      if (isUntypedCallbackParam(program, sourceFile, d)) continue;
      const location = d.start !== undefined ? toLocation(sourceFile, d.start, d.length ?? 0) : undefined;
      const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
      const api = apiMismatchOrigin(program, sourceFile, d);
      if (api) {
        const pkg = api.name === "node" ? `Node.js built-ins (@types/node${api.version ? `@${api.version}` : ""})` : `${api.name}${api.version ? `@${api.version}` : ""}`;
        findings.push(
          makeFinding({
            ruleId: "slop/invented-api",
            source: "tsc",
            category: "slop",
            severity: "high",
            message: `API does not exist as used in ${pkg}: ${message} (invented, or from a different version)`,
            ...(location ? { location } : {}),
            snippet: snippetAt(ctx.code, location),
          }),
        );
        continue;
      }
      const unresolved = UNRESOLVED_MODULE_CODES.has(d.code);
      findings.push(
        makeFinding({
          ruleId: `tsc/TS${d.code}`,
          source: "tsc",
          category: unresolved ? "dependency" : "type",
          severity: severityFor(d.code, hasProject),
          message,
          ...(location ? { location } : {}),
          snippet: snippetAt(ctx.code, location),
        }),
      );
    }
    return { findings, notes };
  },
};
