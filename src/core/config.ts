import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { Severity } from "./types.js";

export const CONFIG_FILENAME = ".codelaundry.json";

export const LaundryConfig = z
  .object({
    /** Stage id -> enabled. Stages not listed use their default. */
    stages: z.record(z.string(), z.boolean()).default({}),
    thresholds: z
      .object({
        /** Unfixed findings at these severities produce `reject`. */
        rejectOn: z.array(Severity).default(["critical", "high"]),
        /** Extra severities that reject in strict mode. */
        strictRejectOn: z.array(Severity).default(["medium"]),
        rejectOnSyntaxError: z.boolean().default(true),
        rejectOnSecret: z.boolean().default(true),
        rejectOnHallucinatedDependency: z.boolean().default(true),
      })
      .prefault({}),
    /** Rule ids (exact, or prefix ending in `*`) whose findings are dropped. */
    ignoreRules: z.array(z.string()).default([]),
    /** Packages never flagged by the dependency stage. Supports `@scope/*`. */
    allowedPackages: z.array(z.string()).default([]),
    /** Per-rule severity overrides. */
    severityOverrides: z.record(z.string(), Severity).default({}),
    repair: z
      .object({
        maxIterations: z.number().int().min(0).max(10).default(3),
        model: z.string().optional(),
        /** Lines of context around each flagged range sent to the LLM. */
        contextLines: z.number().int().min(0).max(50).default(5),
      })
      .prefault({}),
    deps: z
      .object({
        minWeeklyDownloads: z.number().int().min(0).default(500),
        minAgeDays: z.number().int().min(0).default(30),
        offline: z.boolean().default(false),
      })
      .prefault({}),
    /** Use the project's own ESLint/Prettier config when projectRoot is given. */
    useProjectConfigs: z.boolean().default(true),
  })
  .strict();

export type LaundryConfig = z.infer<typeof LaundryConfig>;

export const defaultConfig = (): LaundryConfig => LaundryConfig.parse({});

export class ConfigError extends Error {}

/**
 * Load `.codelaundry.json` from an explicit path or from projectRoot.
 * A missing file yields defaults; an invalid file throws ConfigError (never silently ignored).
 */
export async function loadConfig(opts: { projectRoot?: string; configPath?: string }): Promise<LaundryConfig> {
  const file = opts.configPath ?? (opts.projectRoot ? path.join(opts.projectRoot, CONFIG_FILENAME) : undefined);
  if (!file) return defaultConfig();
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if (!opts.configPath && (err as NodeJS.ErrnoException).code === "ENOENT") return defaultConfig();
    throw new ConfigError(`Cannot read config ${file}: ${(err as Error).message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`Invalid JSON in ${file}: ${(err as Error).message}`);
  }
  const parsed = LaundryConfig.safeParse(json);
  if (!parsed.success) {
    throw new ConfigError(`Invalid ${CONFIG_FILENAME}: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export function matchesPattern(value: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => (p.endsWith("*") ? value.startsWith(p.slice(0, -1)) : value === p));
}
