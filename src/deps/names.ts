import { builtinModules } from "node:module";
import { POPULAR_PACKAGES, POPULAR_SET } from "./popular.js";

const BUILTINS = new Set(builtinModules.flatMap((m) => [m, m.split("/")[0] ?? m]));

/**
 * Map an import specifier to its npm package name, or undefined for relative paths,
 * Node built-ins, URLs and common path aliases (`@/x`, `~/x`, `#x`).
 */
export function packageNameFromSpecifier(spec: string): string | undefined {
  if (!spec || spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("#") || spec.startsWith("~")) return undefined;
  if (spec.startsWith("node:") || spec.startsWith("bun:") || spec.startsWith("deno:")) return undefined;
  if (/^[a-z]+:\/\//i.test(spec) || spec.startsWith("data:")) return undefined;
  if (spec.startsWith("@/")) return undefined;
  const parts = spec.split("/");
  const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? "");
  if (!name || BUILTINS.has(name)) return undefined;
  if (spec.startsWith("@") && parts.length < 2) return undefined;
  return name;
}

/** Valid npm package name (new packages: lowercase, url-safe, ≤214 chars). */
export function isValidPackageName(name: string): boolean {
  return name.length <= 214 && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name);
}

function damerauLevenshtein(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const row = d[i] as number[];
      const prev = d[i - 1] as number[];
      row[j] = Math.min((prev[j] as number) + 1, (row[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j] as number, ((d[i - 2] as number[])[j - 2] as number) + 1);
      }
    }
  }
  return (d[a.length] as number[])[b.length] as number;
}

const normalize = (s: string) => s.replace(/^@[^/]+\//, "").replace(/[-_.]/g, "").replace(/js$/, "");

/** Popular package this name looks like a misspelling of, if any. */
export function typosquatTarget(name: string): string | undefined {
  if (POPULAR_SET.has(name)) return undefined;
  const bare = name.replace(/^@[^/]+\//, "");
  let best: { target: string; dist: number } | undefined;
  for (const target of POPULAR_PACKAGES) {
    const tBare = target.replace(/^@[^/]+\//, "");
    // Same name under a different/no scope ("@typescript/eslint" vs "typescript-eslint" are both real; only flag unscoped lookalikes of scoped names)
    if (normalize(name) === normalize(target) && name !== target) return target;
    if (Math.abs(bare.length - tBare.length) > 2 || tBare.length < 4) continue;
    const dist = damerauLevenshtein(bare, tBare);
    const limit = tBare.length >= 8 ? 2 : 1;
    if (dist > 0 && dist <= limit && (!best || dist < best.dist)) best = { target, dist };
  }
  return best?.target;
}
