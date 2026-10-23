import type { LaundryConfig } from "./config.js";
import type { Category, Finding, Language, Location, Mode, Severity } from "./types.js";

export type StageKind = "detect" | "parse" | "format" | "lint" | "typecheck" | "security" | "deps" | "slop" | "repair" | "test";

/** What the detect stage learned about the input and its project. */
export interface Detected {
  language: Language;
  jsx: boolean;
  frameworks: string[];
  projectConfigs: {
    tsconfig?: string;
    eslint?: string;
    prettier?: string;
  };
  imports: string[];
}

export interface StageContext {
  /** Current code (already includes changes from earlier fixing stages). */
  readonly code: string;
  /**
   * Absolute path the code is presented to tools under. It is virtual: the file is
   * never written there. Inside projectRoot when one is given, so module resolution
   * and config lookup behave as if the file lived in the project.
   */
  readonly filePath: string;
  readonly projectRoot?: string;
  readonly mode: Mode;
  /** False in check mode: stages must not return modified code. */
  readonly allowFix: boolean;
  readonly config: LaundryConfig;
  readonly detected: Detected;
  readonly signal?: AbortSignal;
}

export interface StageOutcome {
  findings: Finding[];
  /** New code, if this stage changed it. Ignored when ctx.allowFix is false. */
  code?: string;
  /** Stop the pipeline after this stage (e.g. unparseable input). */
  fatal?: boolean;
  /** Stage decided at runtime it could not do its job (e.g. missing tool). */
  skipped?: string;
  /** Human-readable notes, e.g. "fell back to bundled ESLint config". */
  notes?: string[];
  /** Exact secret values found; the pipeline redacts them from all output. */
  secrets?: Array<{ value: string; rule: string }>;
}

export interface LanguageModule {
  readonly id: string;
  readonly languages: readonly Language[];
  /** Pick a language for this input, or undefined if this module can't handle it. */
  resolveLanguage(code: string, filename: string | undefined, hint: Language | undefined): Language | undefined;
  /** Filename used when the caller gives none. */
  defaultFilename(language: Language, code: string): string;
  detect(code: string, filePath: string, language: Language, projectRoot: string | undefined): Promise<Detected>;
  readonly stages: readonly Stage[];
}

export interface Stage {
  readonly id: string;
  readonly kind: StageKind;
  readonly languages: readonly Language[];
  /** Whether this stage can modify code. */
  readonly canFix: boolean;
  /** Default enablement; overridable via config.stages[id]. */
  readonly defaultEnabled: boolean;
  /** Is the stage's underlying tool usable here? Missing tools become explicit skips. */
  available(): Promise<{ ok: true } | { ok: false; reason: string }>;
  run(ctx: StageContext): Promise<StageOutcome>;
}

/** Stages that analyse only; used by the repair loop's re-verification. */
export const VERIFY_KINDS: readonly StageKind[] = ["parse", "lint", "typecheck", "security", "deps", "slop"];

let counter = 0;

export function makeFinding(input: {
  ruleId: string;
  source: string;
  category: Category;
  severity: Severity;
  message: string;
  location?: Location;
  fixable?: boolean;
  fixed?: boolean;
  fixedBy?: "tool" | "llm";
  snippet?: string;
}): Finding {
  const loc = input.location ? `${input.location.line}:${input.location.column}` : "-";
  counter = (counter + 1) % 1_000_000;
  return {
    id: `${input.ruleId}@${loc}#${counter.toString(36)}`,
    ruleId: input.ruleId,
    source: input.source,
    category: input.category,
    severity: input.severity,
    message: input.message,
    ...(input.location ? { location: input.location } : {}),
    fixable: input.fixable ?? false,
    fixed: input.fixed ?? false,
    ...(input.fixedBy ? { fixedBy: input.fixedBy } : {}),
    ...(input.snippet !== undefined ? { snippet: input.snippet } : {}),
  };
}

/** Return the source line(s) for a location, trimmed to a sane length. */
export function snippetAt(code: string, loc: Location | undefined, maxLen = 200): string | undefined {
  if (!loc) return undefined;
  const lines = code.split("\n");
  const end = Math.min(loc.endLine ?? loc.line, loc.line + 2);
  const text = lines.slice(loc.line - 1, end).join("\n");
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}
