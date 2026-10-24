import { z } from "zod";
import { type LaundryConfig } from "../core/config.js";
import { InputError } from "../core/input.js";
import { Finding, type Mode, Verdict } from "../core/types.js";
import { computeVerdict } from "../core/verdict.js";
import { checkDependencies, type DepRequest, readDeclaredDependencies } from "./check.js";
import { packageNameFromSpecifier } from "./names.js";

export const DepsToolResult = z.object({
  verdict: Verdict,
  verdictReasons: z.array(z.string()),
  findings: z.array(Finding),
  packages: z.array(
    z.object({
      name: z.string(),
      status: z.enum(["ok", "flagged", "allowed", "unknown"]),
      exists: z.boolean().optional(),
      version: z.string().optional(),
      latest: z.string().optional(),
      deprecated: z.string().optional(),
      ageDays: z.number().optional(),
      weeklyDownloads: z.number().optional(),
      typosquatOf: z.string().optional(),
      vulnerabilities: z.array(z.object({ id: z.string(), summary: z.string().optional(), severity: z.string(), fixed: z.string().optional() })),
    }),
  ),
  notes: z.array(z.string()),
});
export type DepsToolResult = z.infer<typeof DepsToolResult>;

/** "lodash", "lodash@4.17.15", "@scope/pkg@^1.0.0", or an import specifier like "lodash/fp". */
export function parseImportArg(arg: string): DepRequest | undefined {
  const at = arg.lastIndexOf("@");
  const hasVersion = at > 0;
  const spec = hasVersion ? arg.slice(0, at) : arg;
  const name = packageNameFromSpecifier(spec.trim());
  if (!name) return undefined;
  const range = hasVersion ? arg.slice(at + 1).trim() : undefined;
  return { name, ...(range ? { range } : {}) };
}

export function requestsFromPackageJson(pkgJson: unknown): DepRequest[] {
  const parsed = typeof pkgJson === "string" ? (JSON.parse(pkgJson) as unknown) : pkgJson;
  if (!parsed || typeof parsed !== "object") throw new InputError("packageJson must be a JSON object");
  const out: DepRequest[] = [];
  for (const key of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const deps = (parsed as Record<string, unknown>)[key];
    if (!deps || typeof deps !== "object") continue;
    for (const [name, range] of Object.entries(deps as Record<string, unknown>)) {
      // Non-registry specs (git, file, workspace, aliases) can't be checked against the registry.
      const r = typeof range === "string" ? range : "";
      if (/^(?:file:|link:|workspace:|git|github:|https?:|npm:)/.test(r)) continue;
      out.push({ name, ...(r ? { range: r } : {}) });
    }
  }
  return out;
}

export async function runDepsTool(
  input: { packageJson?: unknown; imports?: string[]; projectRoot?: string },
  config: LaundryConfig,
  mode: Mode,
): Promise<DepsToolResult> {
  if ((input.packageJson === undefined) === (input.imports === undefined)) throw new InputError("provide exactly one of `packageJson` or `imports`");
  let requests: DepRequest[];
  try {
    requests = input.packageJson !== undefined ? requestsFromPackageJson(input.packageJson) : (input.imports ?? []).map(parseImportArg).filter((r): r is DepRequest => Boolean(r));
  } catch (err) {
    throw err instanceof InputError ? err : new InputError(`invalid packageJson: ${(err as Error).message}`);
  }
  if (requests.length > 500) throw new InputError("at most 500 packages per call");
  const declared = input.imports && input.projectRoot ? await readDeclaredDependencies(input.projectRoot) : undefined;
  const res = await checkDependencies(requests, { config, mode, ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}), ...(declared ? { declared } : {}) });
  const { verdict, reasons } = computeVerdict(res.findings, config, mode);
  if (res.unavailable.length) reasons.push(`incomplete: ${res.unavailable.join("; ")}`);
  return { verdict, verdictReasons: reasons, findings: res.findings, packages: res.packages, notes: res.notes };
}
