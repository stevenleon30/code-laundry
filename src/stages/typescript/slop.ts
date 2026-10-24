import ts from "typescript";
import { makeFinding, snippetAt, type Stage } from "../../core/stage.js";
import type { Category, Finding, Location, Severity } from "../../core/types.js";

/**
 * Heuristics for typical AI-generated leftovers. AST-based (TypeScript parser), so
 * matches in strings or comments are only reported by the rules that target them.
 * The only autofix is removing console.log/debug/trace statements.
 */

const TRUNCATION =
  /(?:\.\.\.|…)\s*(?:the\s+)?(?:rest|existing|remaining|other|previous|same|more|additional)\b|\brest of (?:the )?(?:code|implementation|file|logic|methods|function)|\b(?:same|unchanged) as (?:before|above)\b|\b(?:existing|other) (?:code|methods|logic) (?:remains?|unchanged|here|goes here)/i;
const PLACEHOLDER_COMMENT =
  /\b(?:implement (?:this|me|here|later)|your (?:code|logic|implementation) here|add (?:your|real|actual|proper) (?:logic|implementation|code|error handling|validation)|placeholder|stub(?:bed)? (?:out|implementation)|replace (?:this|with real)|in a real (?:app|application|implementation)|for (?:demo|demonstration|simplicity)(?: purposes)?|simplified (?:version|implementation|example))\b/i;
const TODO = /\b(?:TODO|FIXME|XXX|HACK)\b/;
const NOT_IMPLEMENTED = /\bnot (?:yet )?implemented\b|\bimplement me\b|^todo\b/i;
const PLACEHOLDER_VALUE =
  /^(?:your[-_ ]?[\w-]*(?:key|token|secret|id|url|password|here|name|endpoint)[\w-]*|<[A-Za-z_ -]+>|YOUR_[A-Z0-9_]+|x{4,}|REPLACE[_-]?ME|CHANGE[_-]?ME|changeme|insert[-_ ].*here|.*_HERE)$/i;
const FAKE_DATA = /\b(?:john|jane) doe\b|\blorem ipsum\b|\b(?:foo@bar|test@test|user@example|admin@example|john@example|jane@example)\.com\b|\b123 main st(?:reet)?\b|\b555-\d{4}\b|\bacme corp\b/i;
const MOCK_IDENT = /^(?:mock|fake|dummy|sample|stub|hardcoded)(?:[A-Z_]|$)|(?:^|[a-z])(?:Mock|Fake|Dummy)(?:[A-Z]|Data|Users?|Items?|Response|Results?|$)/;
const LOCALHOST = /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/|$)/i;
const CODE_LIKE = /(?:[;{}(),]\s*$|^\s*(?:const|let|var|return|if|for|while|function|import|export|await|async|class|try|catch|throw)\b|^\s*[\w.]+\s*\(.*\)\s*;?\s*$|^\s*[\w.[\]]+\s*=\s*.+;\s*$)/;
const DEBUG_CONSOLE = new Set(["log", "debug", "trace", "dir", "table", "time", "timeEnd"]);

const isTestFile = (p: string) => /(?:^|[/\\])(?:__tests__|__mocks__|test|tests|fixtures?|mocks?|stories)[/\\]|\.(?:test|spec|stories|mock|fixture)\.[cm]?[jt]sx?$/i.test(p);

function loc(sf: ts.SourceFile, node: ts.Node | { pos: number; end: number }): Location {
  const start = "getStart" in node ? node.getStart(sf) : node.pos;
  const s = sf.getLineAndCharacterOfPosition(start);
  const e = sf.getLineAndCharacterOfPosition(node.end);
  return { line: s.line + 1, column: s.character + 1, endLine: e.line + 1, endColumn: e.character + 1 };
}

function isConsoleCall(node: ts.Node, methods?: ReadonlySet<string>): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "console" &&
    (!methods || methods.has(callee.name.text))
  );
}

function rethrowsOrReturnsError(block: ts.Block, errName: string | undefined): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isThrowStatement(n)) found = true;
    else if (errName && ts.isReturnStatement(n) && n.expression && n.expression.getText().includes(errName)) found = true;
    else if (errName && ts.isCallExpression(n) && !isConsoleCall(n) && n.arguments.some((a) => a.getText().includes(errName))) found = true; // passed to a handler/reporter
    else if (!ts.isFunctionLike(n)) ts.forEachChild(n, visit);
  };
  visit(block);
  return found;
}

function isDefaultValue(e: ts.Expression | undefined): boolean {
  if (!e) return true;
  if (e.kind === ts.SyntaxKind.NullKeyword || e.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (ts.isIdentifier(e) && e.text === "undefined") return true;
  if (ts.isArrayLiteralExpression(e) && e.elements.length === 0) return true;
  if (ts.isObjectLiteralExpression(e) && e.properties.length === 0) return true;
  if (ts.isStringLiteral(e) && e.text === "") return true;
  if (ts.isNumericLiteral(e) && e.text === "0") return true;
  return false;
}

function countStatements(node: ts.Node): number {
  let n = 0;
  const visit = (c: ts.Node): void => {
    if (ts.isStatement(c) && !ts.isBlock(c)) n++;
    if (!ts.isFunctionLike(c)) ts.forEachChild(c, visit);
  };
  ts.forEachChild(node, visit);
  return n;
}

interface Hit {
  ruleId: string;
  severity: Severity;
  message: string;
  location: Location;
  category?: Category;
  fixable?: boolean;
}

export function slopScan(code: string, filePath: string): { hits: Hit[]; consoleRemovals: Array<{ start: number; end: number }> } {
  const sf = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true);
  const hits: Hit[] = [];
  const consoleRemovals: Array<{ start: number; end: number }> = [];
  const testFile = isTestFile(filePath);
  const add = (h: Hit) => hits.push(h);

  // ---- comments ----
  const seenComments = new Set<number>();
  const comments: Array<{ pos: number; end: number; text: string; kind: ts.SyntaxKind }> = [];
  const collect = (node: ts.Node) => {
    for (const r of [...(ts.getLeadingCommentRanges(code, node.getFullStart()) ?? []), ...(ts.getTrailingCommentRanges(code, node.getEnd()) ?? [])]) {
      if (seenComments.has(r.pos)) continue;
      seenComments.add(r.pos);
      comments.push({ ...r, text: code.slice(r.pos, r.end) });
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);
  // Comments at end of file / inside empty blocks are not attached to any following node.
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, sf.languageVariant, code);
  for (let t = scanner.scan(); t !== ts.SyntaxKind.EndOfFileToken; t = scanner.scan()) {
    if ((t === ts.SyntaxKind.SingleLineCommentTrivia || t === ts.SyntaxKind.MultiLineCommentTrivia) && !seenComments.has(scanner.getTokenStart())) {
      seenComments.add(scanner.getTokenStart());
      comments.push({ pos: scanner.getTokenStart(), end: scanner.getTokenEnd(), text: scanner.getTokenText(), kind: t });
    }
  }
  comments.sort((a, b) => a.pos - b.pos);

  for (const c of comments) {
    const body = c.text.replace(/^\/\/+|^\/\*+|\*+\/$/g, "").trim();
    const location = loc(sf, c);
    if (TRUNCATION.test(body)) {
      add({ ruleId: "slop/truncated-code", severity: "high", message: `Comment indicates omitted code ("${body.slice(0, 60)}"): the generated code is incomplete.`, location });
    } else if (PLACEHOLDER_COMMENT.test(body)) {
      add({ ruleId: "slop/placeholder-comment", severity: "medium", message: `Placeholder left in generated code: "${body.slice(0, 80)}"`, location });
    } else if (TODO.test(body)) {
      add({ ruleId: "slop/todo", severity: "low", message: `Unresolved ${body.match(TODO)?.[0]}: "${body.slice(0, 80)}"`, location });
    }
  }

  // Commented-out code: 3+ consecutive single-line comments that look like code.
  let run: typeof comments = [];
  const flushRun = () => {
    const codeLike = run.filter((c) => CODE_LIKE.test(c.text.replace(/^\/\/+\s?/, "")));
    if (run.length >= 3 && codeLike.length >= Math.ceil(run.length * 0.6)) {
      const first = run[0] as (typeof run)[number];
      const last = run[run.length - 1] as (typeof run)[number];
      add({ ruleId: "slop/commented-out-code", severity: "low", message: `${run.length} lines of commented-out code. Delete it; version control keeps history.`, location: loc(sf, { pos: first.pos, end: last.end }) });
    }
    run = [];
  };
  for (const c of comments) {
    if (c.kind !== ts.SyntaxKind.SingleLineCommentTrivia) {
      flushRun();
      continue;
    }
    const prev = run[run.length - 1];
    if (prev && sf.getLineAndCharacterOfPosition(c.pos).line !== sf.getLineAndCharacterOfPosition(prev.pos).line + 1) flushRun();
    run.push(c);
  }
  flushRun();

  // ---- AST ----
  const visit = (node: ts.Node): void => {
    // console.log leftovers
    if (ts.isExpressionStatement(node) && isConsoleCall(node.expression, DEBUG_CONSOLE)) {
      let inCatch = false;
      for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
        if (ts.isCatchClause(p)) inCatch = true;
        if (ts.isFunctionLike(p)) break;
      }
      const method = ((node.expression as ts.CallExpression).expression as ts.PropertyAccessExpression).name.text;
      if (!inCatch && (ts.isBlock(node.parent) || ts.isSourceFile(node.parent))) {
        add({ ruleId: "slop/console-log", severity: "low", message: `console.${method} left in code. Remove it or use the project's logger.`, location: loc(sf, node), fixable: true });
        consoleRemovals.push({ start: node.getStart(sf), end: node.end });
      }
    }

    // catch clauses
    if (ts.isCatchClause(node)) {
      const block = node.block;
      const errName = node.variableDeclaration && ts.isIdentifier(node.variableDeclaration.name) ? node.variableDeclaration.name.text : undefined;
      const stmts = block.statements;
      const location = loc(sf, node);
      if (stmts.length === 0) {
        const hasComment = code.slice(block.pos, block.end).includes("//") || code.slice(block.pos, block.end).includes("/*");
        add({
          ruleId: "slop/empty-catch",
          severity: hasComment ? "medium" : "high",
          message: "Empty catch block swallows the error. Handle it, rethrow it, or at least report it with context.",
          location,
        });
      } else if (!rethrowsOrReturnsError(block, errName)) {
        const onlyLogs = stmts.every((s) => ts.isExpressionStatement(s) && isConsoleCall(s.expression));
        const ret = stmts[stmts.length - 1];
        if (onlyLogs) {
          add({ ruleId: "slop/log-and-swallow", severity: "medium", message: "Error is logged and then swallowed; callers continue as if the operation succeeded.", location });
        } else if (ret && ts.isReturnStatement(ret) && isDefaultValue(ret.expression) && stmts.slice(0, -1).every((s) => ts.isExpressionStatement(s) && isConsoleCall(s.expression))) {
          add({
            ruleId: "slop/error-to-default",
            severity: "medium",
            message: `Error converted to ${ret.expression ? ret.expression.getText(sf) : "undefined"}; callers can't tell a failure from an empty result. Rethrow or return a typed error.`,
            location,
          });
        }
      }
      // Overly broad try
      const tryStmt = node.parent;
      if (ts.isTryStatement(tryStmt) && countStatements(tryStmt.tryBlock) >= 20 && !rethrowsOrReturnsError(block, errName)) {
        add({ ruleId: "slop/broad-try", severity: "low", message: `try block wraps ${countStatements(tryStmt.tryBlock)} statements with one generic catch. Narrow it to the operations that can fail.`, location: loc(sf, tryStmt) });
      }
    }

    // promise.catch(() => {}) / .catch(() => null)
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "catch" && node.arguments.length === 1) {
      const handler = node.arguments[0] as ts.Expression;
      if (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) {
        const b = handler.body;
        const swallowed = ts.isBlock(b) ? b.statements.length === 0 : isDefaultValue(b as ts.Expression);
        if (swallowed) {
          add({ ruleId: "slop/promise-swallow", severity: "high", message: "Promise rejection is silently swallowed by an empty .catch handler.", location: loc(sf, node.expression.name) });
        }
      }
    }

    // throw new Error("Not implemented")
    if (ts.isThrowStatement(node) && node.expression && ts.isNewExpression(node.expression)) {
      const arg = node.expression.arguments?.[0];
      if (arg && ts.isStringLiteralLike(arg) && NOT_IMPLEMENTED.test(arg.text)) {
        add({ ruleId: "slop/not-implemented", severity: "medium", message: `Unimplemented stub: throws "${arg.text.slice(0, 60)}".`, location: loc(sf, node) });
      }
    }

    // string literal placeholders, fake data, localhost
    if (ts.isStringLiteralLike(node) && !ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent) && !ts.isExternalModuleReference(node.parent)) {
      const t = node.text.trim();
      if (t.length > 0 && t.length < 120) {
        if (PLACEHOLDER_VALUE.test(t)) {
          add({ ruleId: "slop/placeholder-value", severity: "medium", message: `Placeholder value "${t.slice(0, 40)}" left in code. Read it from configuration instead.`, location: loc(sf, node) });
        } else if (!testFile && FAKE_DATA.test(t)) {
          add({ ruleId: "slop/fake-data", severity: "medium", message: `Fake/sample data ("${t.slice(0, 40)}") left in non-test code.`, location: loc(sf, node) });
        } else if (!testFile && LOCALHOST.test(t)) {
          add({ ruleId: "slop/hardcoded-localhost", severity: "low", message: `Hardcoded local URL "${t.slice(0, 50)}". Make it configurable.`, location: loc(sf, node) });
        }
      }
    }

    // mockUsers = [...] in non-test code
    if (!testFile && (ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name && ts.isIdentifier(node.name) && MOCK_IDENT.test(node.name.text)) {
      add({ ruleId: "slop/mock-data", severity: "medium", message: `"${node.name.text}" looks like mock/fake data left in non-test code.`, location: loc(sf, node.name) });
    }

    // if (false) / while (false)
    if ((ts.isIfStatement(node) || ts.isWhileStatement(node)) && (node.expression.kind === ts.SyntaxKind.FalseKeyword || (ts.isNumericLiteral(node.expression) && node.expression.text === "0"))) {
      add({ ruleId: "slop/dead-code", severity: "low", message: "Condition is always false; the block is dead code.", location: loc(sf, node) });
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { hits, consoleRemovals };
}

function removeRanges(code: string, ranges: Array<{ start: number; end: number }>): string {
  let out = code;
  for (const r of [...ranges].sort((a, b) => b.start - a.start)) {
    let { start, end } = r;
    const lineStart = out.lastIndexOf("\n", start - 1) + 1;
    const lineEndIdx = out.indexOf("\n", end);
    const lineEnd = lineEndIdx === -1 ? out.length : lineEndIdx;
    // Drop the whole line when the statement is alone on it.
    if (out.slice(lineStart, start).trim() === "" && out.slice(end, lineEnd).trim() === "") {
      start = lineStart;
      end = lineEndIdx === -1 ? lineEnd : lineEnd + 1;
    }
    out = out.slice(0, start) + out.slice(end);
  }
  return out;
}

export const slopStage: Stage = {
  id: "ts.slop",
  kind: "slop",
  languages: ["typescript", "javascript"],
  canFix: true,
  defaultEnabled: true,
  available: async () => ({ ok: true }),
  async run(ctx) {
    const { hits, consoleRemovals } = slopScan(ctx.code, ctx.filePath);
    const fixConsole = ctx.allowFix && consoleRemovals.length > 0;
    const findings: Finding[] = hits.map((h) =>
      makeFinding({
        ruleId: h.ruleId,
        source: "code-laundry",
        category: h.category ?? "slop",
        severity: h.severity,
        message: h.message,
        location: h.location,
        fixable: h.fixable ?? false,
        ...(fixConsole && h.ruleId === "slop/console-log" ? { fixed: true, fixedBy: "tool" as const } : {}),
        snippet: snippetAt(ctx.code, h.location),
      }),
    );
    const notes = ctx.projectRoot ? [] : ["invented-API check covers Node built-ins only; pass projectRoot to check installed packages"];
    if (!fixConsole) return { findings, notes };
    return { findings, code: removeRanges(ctx.code, consoleRemovals), notes: [...notes, `removed ${consoleRemovals.length} console statement(s)`] };
  },
};

