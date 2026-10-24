async function loadConfig(): Promise<Record<string, string>> {
  const res = await fetch("/config.json");
  if (!res.ok) throw new Error(`config: HTTP ${res.status}`);
  return res.json();
}

export async function configOrDefault(): Promise<Record<string, string>> {
  try {
    return loadConfig();
  } catch (err) {
    throw new Error("could not load config", { cause: err });
  }
}
