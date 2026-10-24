import { readJson } from "node:fs/promises";

export async function loadSettings(): Promise<unknown> {
  return readJson("./settings.json");
}
