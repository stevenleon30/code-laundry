import fs from "node:fs";

export async function readJson(path: string): Promise<unknown> {
  const text = await fs.readFileAsync(path, "utf8");
  return JSON.parse(text);
}
