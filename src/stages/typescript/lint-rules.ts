import type { Linter } from "eslint";
import type { Category, Severity } from "../../core/types.js";

/** Severity and category for lint rules. Rules not listed map from ESLint level (error→medium, warn→low). */
export const RULE_META: Record<string, { severity: Severity; category?: Category }> = {
  "no-eval": { severity: "critical", category: "security" },
  "no-implied-eval": { severity: "critical", category: "security" },
  "@typescript-eslint/no-implied-eval": { severity: "critical", category: "security" },
  "no-new-func": { severity: "high", category: "security" },
  "@typescript-eslint/no-floating-promises": { severity: "high" },
  "@typescript-eslint/no-misused-promises": { severity: "high" },
  "@typescript-eslint/await-thenable": { severity: "medium" },
  "@typescript-eslint/only-throw-error": { severity: "medium" },
  "no-unreachable": { severity: "medium" },
  "no-dupe-keys": { severity: "high" },
  "no-dupe-else-if": { severity: "high" },
  "no-self-assign": { severity: "medium" },
  "no-cond-assign": { severity: "high" },
  "no-fallthrough": { severity: "medium" },
  "no-undef": { severity: "high" },
  "no-func-assign": { severity: "high" },
  "no-import-assign": { severity: "high" },
  "no-const-assign": { severity: "high" },
  "use-isnan": { severity: "high" },
  "valid-typeof": { severity: "high" },
  "no-unsafe-finally": { severity: "high" },
  "no-async-promise-executor": { severity: "high" },
  "no-prototype-builtins": { severity: "low" },
  "eqeqeq": { severity: "medium" },
  "no-debugger": { severity: "medium" },
  "no-empty": { severity: "medium" },
  "no-useless-catch": { severity: "low" },
  "no-constant-condition": { severity: "low" },
  "prefer-const": { severity: "low" },
  "no-var": { severity: "low" },
  "@typescript-eslint/no-unused-vars": { severity: "low" },
  "@typescript-eslint/no-explicit-any": { severity: "medium", category: "type" },
  "@typescript-eslint/ban-ts-comment": { severity: "medium", category: "type" },
  "@typescript-eslint/no-non-null-asserted-optional-chain": { severity: "high", category: "type" },
  "@typescript-eslint/no-unsafe-declaration-merging": { severity: "medium", category: "type" },
};

/** Syntactic rules, run with autofix. Layered on js + typescript-eslint recommended. */
export const SYNTACTIC_RULES: Linter.RulesRecord = {
  // tsc reports undefined names with real type information.
  "no-undef": "off",
  "@typescript-eslint/no-require-imports": "off",
  "@typescript-eslint/no-unused-vars": ["error", { args: "after-used", ignoreRestSiblings: true, caughtErrors: "none" }],
  "prefer-const": "error",
  "no-var": "error",
  eqeqeq: ["error", "smart"],
  "no-eval": "error",
  "no-implied-eval": "error",
  "no-new-func": "error",
  // Empty catch blocks are owned by the slop stage (swallowed errors), which is more precise.
  "no-empty": ["error", { allowEmptyCatch: true }],
  "no-useless-catch": "error",
  "@typescript-eslint/no-explicit-any": "error",
};

/** Type-aware rules, report-only, run against the shared TS program. */
export const TYPED_RULES: Linter.RulesRecord = {
  "@typescript-eslint/no-floating-promises": "error",
  "@typescript-eslint/no-misused-promises": "error",
  "@typescript-eslint/await-thenable": "error",
  "@typescript-eslint/no-implied-eval": "error",
  "@typescript-eslint/only-throw-error": "error",
};
