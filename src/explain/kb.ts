import type { Category } from "../core/types.js";

export interface Explanation {
  title: string;
  why: string;
  fix: string;
}

/**
 * Deterministic explanations, keyed by rule id (exact, or prefix ending in `*`).
 * Written for the calling agent: what is wrong, why it matters, how to fix it.
 */
const RULES: Record<string, Explanation> = {
  "parse/*": {
    title: "Syntax error",
    why: "The code does not parse, so it cannot run and no other check is meaningful.",
    fix: "Fix the syntax at the reported location (unbalanced brackets, a missing comma or a truncated generation are common causes), then resubmit.",
  },
  "format/prettier": {
    title: "Unformatted code",
    why: "Inconsistent formatting adds noise to diffs and reviews.",
    fix: "Use the returned cleanedCode (fix mode applies Prettier automatically).",
  },
  "eslint/no-eval": {
    title: "Use of eval",
    why: "eval runs arbitrary strings as code. Any attacker-influenced input becomes remote code execution.",
    fix: "Remove eval. Parse data with JSON.parse, dispatch on known keys with a lookup table, or use a proper expression parser.",
  },
  "eslint/no-implied-eval": {
    title: "Implied eval",
    why: "setTimeout/setInterval/execScript with a string argument evaluate that string as code.",
    fix: "Pass a function instead of a string, e.g. setTimeout(() => run(), 100).",
  },
  "eslint/@typescript-eslint/no-implied-eval": {
    title: "Implied eval",
    why: "A string passed to setTimeout, setInterval or new Function is evaluated as code.",
    fix: "Pass a function, not a string.",
  },
  "eslint/no-new-func": {
    title: "new Function()",
    why: "new Function compiles a string into code at runtime, which has the same risks as eval.",
    fix: "Replace with a regular function or a lookup table of known operations.",
  },
  "eslint/@typescript-eslint/no-floating-promises": {
    title: "Missing await (floating promise)",
    why: "The promise is neither awaited nor handled. Errors are silently lost and code after it may run before the work completes.",
    fix: "Add `await` (making the caller async if needed), or `return` the promise, or attach `.catch(...)`. Use `void promise` only for deliberate fire-and-forget.",
  },
  "eslint/@typescript-eslint/no-misused-promises": {
    title: "Promise used where a value is expected",
    why: "A promise in a condition is always truthy, and an async callback passed where a sync one is expected has its errors and result ignored.",
    fix: "Await the promise before using its value; wrap async callbacks so rejections are handled.",
  },
  "eslint/@typescript-eslint/await-thenable": {
    title: "await on a non-promise",
    why: "Awaiting a non-thenable usually means the wrong function or a wrong assumption about its return type.",
    fix: "Check what the function actually returns; remove the await or call the async variant.",
  },
  "eslint/@typescript-eslint/only-throw-error": {
    title: "Throwing a non-Error",
    why: "Thrown strings and objects have no stack trace and break `instanceof Error` handling upstream.",
    fix: "Throw `new Error(message)` (or a subclass), optionally with `{ cause }`.",
  },
  "eslint/@typescript-eslint/no-explicit-any": {
    title: "Explicit any",
    why: "`any` turns off type checking for everything it touches, hiding real bugs.",
    fix: "Use a precise type, a generic, or `unknown` plus narrowing.",
  },
  "eslint/@typescript-eslint/no-unused-vars": {
    title: "Unused variable",
    why: "Unused bindings are dead code, and often a sign the generated code forgot to use a result.",
    fix: "Use the value if it was meant to be used; otherwise delete it.",
  },
  "eslint/no-var": { title: "var declaration", why: "var is function-scoped and hoisted, a common source of bugs.", fix: "Use const (or let if reassigned)." },
  "eslint/prefer-const": { title: "let never reassigned", why: "const documents intent and prevents accidental reassignment.", fix: "Change let to const." },
  "eslint/eqeqeq": {
    title: "Loose equality",
    why: "== performs type coercion ('0' == 0 is true), which causes surprising comparisons.",
    fix: "Use === / !==. `x == null` to check for null-or-undefined is allowed.",
  },
  "tsc/TS2307": {
    title: "Module not found",
    why: "The import cannot be resolved: the package is not installed, the path is wrong, or the module does not exist (possibly hallucinated).",
    fix: "Check the import path or package name. If it is a real package, add it to package.json; if it doesn't exist on the registry, replace it.",
  },
  "tsc/TS2339": {
    title: "Property does not exist",
    why: "The code uses a property or method the type doesn't have. In generated code this is often an invented API.",
    fix: "Check the library's actual API for the installed version and use a method that exists.",
  },
  "tsc/TS2322": { title: "Type mismatch", why: "A value is assigned to a variable or property of an incompatible type.", fix: "Convert the value, or correct the declared type if the declaration is wrong." },
  "tsc/TS2345": { title: "Wrong argument type", why: "A function is called with an argument of the wrong type.", fix: "Pass a value of the expected type; check the function signature." },
  "tsc/TS2554": { title: "Wrong number of arguments", why: "The call doesn't match the function's signature, often an invented or outdated API.", fix: "Check the signature and pass the expected arguments." },
  "tsc/TS2304": { title: "Undefined name", why: "The identifier is not declared or imported.", fix: "Import or declare it, or fix the typo." },
  "tsc/TS18048": { title: "Possibly undefined", why: "The value can be undefined here, and using it would throw at runtime.", fix: "Check for undefined first (if/optional chaining/default value)." },
  "tsc/TS2532": { title: "Possibly undefined", why: "The object can be undefined here, and using it would throw at runtime.", fix: "Check for undefined first (if/optional chaining/default value)." },
  "laundry/stage-unavailable": {
    title: "Required check did not run",
    why: "In strict mode, a security or dependency check that couldn't run must not count as a clean result.",
    fix: "Install the missing tool (see stagesRun reasons), or run in fix mode to accept the gap.",
  },
};

const CATEGORY_FALLBACK: Record<Category, Explanation> = {
  syntax: RULES["parse/*"] as Explanation,
  format: RULES["format/prettier"] as Explanation,
  lint: { title: "Lint issue", why: "The code violates a correctness or quality rule.", fix: "Follow the rule's message; fix mode applies autofixable rules." },
  type: { title: "Type error", why: "The code would not compile under the type checker.", fix: "Fix the types at the reported location; check APIs against their declarations." },
  security: { title: "Security issue", why: "The pattern is commonly exploitable.", fix: "Follow the message; prefer safe library APIs over hand-rolled handling." },
  secret: {
    title: "Hardcoded secret",
    why: "A credential in source code leaks to everyone with repository access and to logs, and must be considered compromised.",
    fix: "Read it from configuration (e.g. process.env.NAME) and rotate the exposed credential.",
  },
  dependency: { title: "Dependency issue", why: "An imported package is vulnerable, deprecated, unpopular, or unresolvable.", fix: "Upgrade, replace, or verify the package." },
  "hallucinated-dependency": {
    title: "Package does not exist",
    why: "The imported package isn't on the registry. Generated code invented it, and an attacker could register the name (slopsquatting).",
    fix: "Replace it with a real package that provides the needed functionality, or implement it locally.",
  },
  slop: { title: "AI-generated leftover", why: "Placeholder or debugging code left in generated output.", fix: "Replace placeholders with real logic and remove debugging output." },
  pipeline: { title: "Pipeline issue", why: "Code Laundry could not fully check this code.", fix: "See stagesRun for details." },
};

export function explanationFor(ruleId: string, category: Category | undefined): Explanation & { matched: "rule" | "category" | "generic" } {
  const exact = RULES[ruleId];
  if (exact) return { ...exact, matched: "rule" };
  for (const [key, value] of Object.entries(RULES)) {
    if (key.endsWith("*") && ruleId.startsWith(key.slice(0, -1))) return { ...value, matched: "rule" };
  }
  if (category) return { ...CATEGORY_FALLBACK[category], matched: "category" };
  return { title: "Issue", why: "A check reported a problem.", fix: "Follow the finding's message.", matched: "generic" };
}

export function registerExplanations(entries: Record<string, Explanation>): void {
  Object.assign(RULES, entries);
}
