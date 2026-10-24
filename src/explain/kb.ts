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
  "semgrep/sql-injection": {
    title: "SQL injection",
    why: "Request data is concatenated into SQL, so an attacker can change the query (read or delete data, bypass auth).",
    fix: "Use parameterized queries: db.query('SELECT * FROM users WHERE id = $1', [id]). Never build SQL with template literals or +.",
  },
  "semgrep/sql-injection-string-built": {
    title: "SQL built from strings",
    why: "SQL assembled with interpolation is injectable as soon as any part comes from input.",
    fix: "Use placeholders and a values array (or the ORM's query builder).",
  },
  "semgrep/command-injection": {
    title: "Command injection",
    why: "A shell command is built from dynamic input; shell metacharacters let an attacker run arbitrary commands.",
    fix: "Use execFile/spawn with an argument array and no shell; validate input against an allow-list.",
  },
  "semgrep/path-traversal": {
    title: "Path traversal",
    why: "Request data in a file path lets ../ escape the intended directory.",
    fix: "const p = path.resolve(BASE, name); if (!p.startsWith(BASE + path.sep)) reject; or use path.basename(name).",
  },
  "semgrep/ssrf": {
    title: "Server-side request forgery",
    why: "The server fetches a URL chosen by the client, reaching internal services or cloud metadata (169.254.169.254).",
    fix: "Parse the URL and check the host against an allow-list; block private address ranges.",
  },
  "semgrep/open-redirect": { title: "Open redirect", why: "Attackers can use your domain to redirect victims to phishing sites.", fix: "Redirect only to relative paths or allow-listed hosts." },
  "semgrep/xss-reflected": { title: "Reflected XSS", why: "Request data is echoed into HTML unescaped, so attackers can inject scripts.", fix: "Escape output or use an auto-escaping template engine; send JSON instead of HTML where possible." },
  "semgrep/dom-xss": { title: "DOM XSS", why: "innerHTML/dangerouslySetInnerHTML with dynamic content executes injected markup.", fix: "Use textContent, or sanitize with DOMPurify." },
  "semgrep/vm-code-execution": { title: "Dynamic code execution", why: "node:vm is not a sandbox; code run there can escape to the host.", fix: "Don't execute untrusted strings. Use a real isolate (separate process/container) if you must." },
  "semgrep/weak-hash": { title: "Weak hash", why: "MD5 and SHA-1 have practical collisions.", fix: "Use SHA-256+ for integrity; bcrypt/scrypt/argon2 for passwords." },
  "semgrep/password-fast-hash": { title: "Fast password hash", why: "General-purpose hashes are fast, so leaked hashes are brute-forced quickly.", fix: "Use bcrypt, scrypt or argon2 with a per-user salt." },
  "semgrep/weak-cipher": { title: "Weak cipher", why: "DES/RC4/ECB and createCipher (no IV) are broken or misuse-prone.", fix: "Use AES-256-GCM via createCipheriv with a random 12-byte IV, and store the auth tag." },
  "semgrep/insecure-randomness": { title: "Predictable random value", why: "Math.random() is not cryptographically secure; tokens made with it can be guessed.", fix: "Use crypto.randomBytes(32).toString('hex') or crypto.randomUUID()." },
  "semgrep/tls-verification-disabled": { title: "TLS verification disabled", why: "Disabling certificate checks allows man-in-the-middle attacks.", fix: "Remove rejectUnauthorized: false; fix the CA configuration instead (e.g. NODE_EXTRA_CA_CERTS)." },
  "semgrep/jwt-none-or-unverified": { title: "Unverified JWT", why: "Allowing alg 'none' lets anyone forge tokens.", fix: "jwt.verify(token, key, { algorithms: ['RS256'] }) with an explicit, signed algorithm." },
  "semgrep/hardcoded-signing-key": {
    title: "Hardcoded signing key",
    why: "A JWT/HMAC key in source lets anyone with the code forge valid tokens.",
    fix: "Read the key from configuration (process.env.JWT_SECRET) and rotate the exposed one.",
  },
  "eslint/@typescript-eslint/return-await": {
    title: "Un-awaited return inside try",
    why: "`return promise` inside try returns before the promise settles, so its rejection bypasses the catch block.",
    fix: "Use `return await promise` inside try/catch.",
  },
  "semgrep/cors-wildcard-with-credentials": { title: "Permissive CORS", why: "Any site can make credentialed requests on behalf of your users.", fix: "Set origin to an explicit allow-list." },
  "secrets/*": {
    title: "Hardcoded secret",
    why: "A credential in source leaks to everyone with access to the code, its history and logs. Treat it as compromised.",
    fix: "Read it from configuration (process.env.NAME or a secrets manager), and rotate the exposed credential.",
  },
  "deps/not-found": {
    title: "Package does not exist (hallucinated)",
    why: "The package isn't on npm. Generated code invented it, and attackers register such names to catch installs (slopsquatting).",
    fix: "Find a real package that does the job (check npmjs.com), or implement the functionality locally. Never `npm install` the invented name.",
  },
  "deps/invalid-name": { title: "Invalid package name", why: "The import can't refer to a real npm package.", fix: "Correct the import." },
  "deps/removed-malicious": {
    title: "Package removed as malicious",
    why: "npm took the package down after a malware report and left a placeholder. Old installs of it may be compromised.",
    fix: "Use the legitimate package it imitates (see the suggestion), and audit any machine that installed it.",
  },
  "deps/typosquat": { title: "Possible typosquat", why: "The name is one or two characters away from a popular package, a classic malware trick.", fix: "Use the popular package's exact name unless this one is really intended." },
  "deps/vulnerable": { title: "Vulnerable dependency", why: "The version used has published vulnerabilities.", fix: "Upgrade to the fixed version named in the finding (or later)." },
  "deps/deprecated": { title: "Deprecated package", why: "The maintainers no longer support it; bugs and vulnerabilities won't be fixed.", fix: "Follow the deprecation message to the recommended replacement." },
  "deps/new-package": { title: "Very new package", why: "Recently published packages have had little scrutiny and are a common malware vector.", fix: "Verify the publisher and repository before depending on it." },
  "deps/low-downloads": { title: "Rarely used package", why: "Few users means few eyes on the code and a higher chance it's a squat or abandoned.", fix: "Prefer a well-known alternative, or vendor and review the code." },
  "deps/undeclared": { title: "Undeclared dependency", why: "The import works only by accident (hoisting) or not at all.", fix: "Add the package to package.json." },
  "slop/invented-api": {
    title: "Invented API",
    why: "The code calls an export, method or option that the installed package version doesn't have, a typical hallucination.",
    fix: "Check the package's documentation/typings for the installed version and use a real API (the message lists what's wrong).",
  },
  "slop/truncated-code": { title: "Truncated generation", why: "A comment like '... rest of the code' means part of the implementation was never written.", fix: "Regenerate or write the missing code; never ship the placeholder." },
  "slop/placeholder-comment": { title: "Placeholder implementation", why: "The comment admits the logic is a stand-in.", fix: "Implement the real logic or remove the code path." },
  "slop/todo": { title: "Unresolved TODO", why: "Work the generator deferred.", fix: "Resolve it or track it in an issue." },
  "slop/not-implemented": { title: "Unimplemented stub", why: "The function only throws; callers will fail at runtime.", fix: "Implement it or remove it." },
  "slop/placeholder-value": { title: "Placeholder value", why: "Values like 'YOUR_API_KEY' fail at runtime and tempt people to paste real secrets inline.", fix: "Read the value from configuration (process.env)." },
  "slop/fake-data": { title: "Fake data", why: "Sample data (John Doe, lorem ipsum) in production code means a real data source is missing.", fix: "Replace with the real data source; move samples to tests/fixtures." },
  "slop/mock-data": { title: "Mock data in production code", why: "Mocked values shipped as real behaviour.", fix: "Wire up the real implementation; keep mocks in tests." },
  "slop/console-log": { title: "Debug output", why: "console.log leftovers leak data to logs and clutter output.", fix: "Remove it (fix mode does) or use the project's logger." },
  "slop/empty-catch": { title: "Swallowed error", why: "An empty catch hides failures; the program continues in a broken state with no trace.", fix: "Handle the error, rethrow it (optionally wrapped with { cause }), or report it with context." },
  "slop/log-and-swallow": { title: "Logged and swallowed error", why: "Logging isn't handling: callers proceed as if the operation succeeded.", fix: "Rethrow after logging, or return an explicit error result the caller must check." },
  "slop/error-to-default": { title: "Error turned into a default value", why: "Returning null/[]/false on failure makes errors indistinguishable from empty results.", fix: "Rethrow, or return a discriminated result such as { ok: false, error }." },
  "slop/promise-swallow": { title: "Swallowed promise rejection", why: ".catch(() => {}) silently discards failures.", fix: "Handle or log the rejection, or let it propagate with await." },
  "slop/broad-try": { title: "Overly broad try/catch", why: "One catch around a large block hides which operation failed and catches bugs along with expected errors.", fix: "Wrap only the operations that can fail, and handle each failure specifically." },
  "slop/commented-out-code": { title: "Commented-out code", why: "Dead code in comments confuses readers.", fix: "Delete it; git keeps history." },
  "slop/dead-code": { title: "Dead code", why: "The branch can never run.", fix: "Delete it." },
  "slop/hardcoded-localhost": { title: "Hardcoded local URL", why: "Works on the developer's machine only.", fix: "Read the URL from configuration." },
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
