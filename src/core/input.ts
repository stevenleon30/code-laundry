import { applyPatch, parsePatch } from "diff";
import { readFile } from "node:fs/promises";
import path from "node:path";

export class InputError extends Error {}

export const MAX_CODE_BYTES = Number(process.env.CODELAUNDRY_MAX_BYTES ?? 1_000_000);

export function assertSize(code: string): void {
  const bytes = Buffer.byteLength(code, "utf8");
  if (bytes > MAX_CODE_BYTES) throw new InputError(`Input is ${bytes} bytes; limit is ${MAX_CODE_BYTES} (CODELAUNDRY_MAX_BYTES)`);
}

/**
 * Optional allow-list for projectRoot (colon-separated absolute paths in
 * CODELAUNDRY_ALLOWED_ROOTS). Project ESLint/Prettier configs are JS and get loaded,
 * so operators can pin which directories a caller may point at.
 */
export function assertAllowedRoot(projectRoot: string | undefined): void {
  const allowed = process.env.CODELAUNDRY_ALLOWED_ROOTS;
  if (!projectRoot || !allowed) return;
  const root = path.resolve(projectRoot);
  const ok = allowed
    .split(path.delimiter)
    .filter(Boolean)
    .some((a) => {
      const rel = path.relative(path.resolve(a), root);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    });
  if (!ok) throw new InputError(`projectRoot ${root} is outside CODELAUNDRY_ALLOWED_ROOTS`);
}

/**
 * Resolve a unified diff into the full new file content. The base file is read from
 * projectRoot/filename (missing file = new file). The diff must touch a single file.
 */
export async function codeFromDiff(diffText: string, opts: { projectRoot?: string; filename?: string }): Promise<{ code: string; filename: string }> {
  const patches = parsePatch(diffText);
  if (patches.length !== 1 || !patches[0]) throw new InputError(`diff must contain exactly one file (got ${patches.length})`);
  const patch = patches[0];
  const fromDiff = (patch.newFileName ?? patch.oldFileName ?? "").replace(/^[ab]\//, "");
  const filename = opts.filename ?? (fromDiff && fromDiff !== "/dev/null" ? fromDiff : undefined);
  if (!filename) throw new InputError("diff input needs a filename (none in diff headers)");

  let base = "";
  if (opts.projectRoot) {
    const target = path.resolve(opts.projectRoot, filename);
    const rel = path.relative(path.resolve(opts.projectRoot), target);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new InputError(`filename ${filename} escapes projectRoot`);
    try {
      base = await readFile(target, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  } else if (patch.hunks.some((h) => h.oldLines > 0)) {
    throw new InputError("diff modifies an existing file; pass context.projectRoot so the base file can be read");
  }
  const result = applyPatch(base, patch);
  if (result === false) throw new InputError(`diff does not apply cleanly to ${filename}`);
  return { code: result, filename };
}
