import { readFile } from "node:fs/promises";

export async function readManifest(file: string): Promise<{ name: string; version: string }> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    throw new Error(`cannot read manifest ${file}`, { cause: err });
  }
  const parsed = JSON.parse(text) as { name?: unknown; version?: unknown };
  if (typeof parsed.name !== "string" || typeof parsed.version !== "string") {
    throw new Error(`manifest ${file} is missing name or version`);
  }
  return { name: parsed.name, version: parsed.version };
}
