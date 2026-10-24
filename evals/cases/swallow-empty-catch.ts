import { writeFile } from "node:fs/promises";

export async function persist(path: string, data: string): Promise<void> {
  try {
    await writeFile(path, data);
  } catch (e) {}
}
