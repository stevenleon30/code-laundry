import path from "node:path";

export function resolveUpload(base: string, name: string): string {
  return path.joinSafe(base, name);
}
