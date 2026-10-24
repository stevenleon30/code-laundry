import { mkdir } from "node:fs/promises";
import path from "node:path";
import { run, which, withTempFile } from "../core/exec.js";
import type { Severity } from "../core/types.js";
import type { DepsProvider, Lookup, PackageInfo, Vuln, VulnQuery } from "./provider.js";

const REGISTRY = (process.env.CODELAUNDRY_NPM_REGISTRY ?? "https://registry.npmjs.org").replace(/\/$/, "");
const DOWNLOADS_API = "https://api.npmjs.org/downloads/point/last-week";
const OSV_API = "https://api.osv.dev/v1";
const TTL_MS = 6 * 60 * 60 * 1000;
/** Failures are cached briefly so one run (and its re-verification) doesn't retry a dead service. */
const FAILURE_TTL_MS = 2 * 60 * 1000;
const TIMEOUT_MS = 10_000;

const cache = new Map<string, { at: number; ttl: number; value: Promise<Lookup<unknown>> }>();

function cached<T>(key: string, load: () => Promise<Lookup<T>>): Promise<Lookup<T>> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value as Promise<Lookup<T>>;
  const entry = { at: Date.now(), ttl: TTL_MS, value: load() as Promise<Lookup<unknown>> };
  void entry.value.then((r) => {
    if (!r.ok) entry.ttl = FAILURE_TTL_MS;
  });
  cache.set(key, entry);
  return entry.value as Promise<Lookup<T>>;
}

async function getJson(url: string, init: RequestInit = {}): Promise<{ status: number; body?: unknown; error?: string }> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 404) return { status: 404 };
    if (!res.ok) return { status: res.status, error: `HTTP ${res.status} from ${new URL(url).host}` };
    return { status: res.status, body: await res.json() };
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    return { status: 0, error: `${new URL(url).host} unreachable (${e.cause?.code ?? e.name})` };
  }
}

const encodeName = (name: string) => name.replace("/", "%2F");

interface AbbreviatedDoc {
  name: string;
  "dist-tags"?: { latest?: string };
  versions?: Record<string, { deprecated?: string; dist?: { tarball?: string } }>;
}

function osvSeverity(label: string | undefined, score?: number): Severity {
  const l = (label ?? "").toUpperCase();
  if (l === "CRITICAL" || (score ?? 0) >= 9) return "critical";
  if (l === "HIGH" || (score ?? 0) >= 7) return "high";
  if (l === "MODERATE" || l === "MEDIUM" || (score ?? 0) >= 4) return "medium";
  return "low";
}

interface OsvVulnDoc {
  id: string;
  summary?: string;
  database_specific?: { severity?: string };
  affected?: Array<{ package?: { name?: string }; ranges?: Array<{ events?: Array<{ fixed?: string }> }> }>;
}

function fixedVersion(doc: OsvVulnDoc, pkg: string): string | undefined {
  for (const a of doc.affected ?? []) {
    if (a.package?.name && a.package.name !== pkg) continue;
    for (const r of a.ranges ?? []) for (const e of r.events ?? []) if (e.fixed) return e.fixed;
  }
  return undefined;
}

/** Live provider: npm registry + downloads API + OSV (osv-scanner, falling back to the OSV API). */
export class NetworkDepsProvider implements DepsProvider {
  readonly id = "network";

  packageInfo(name: string): Promise<Lookup<PackageInfo | null>> {
    return cached(`pkg:${name}`, async () => {
      const r = await getJson(`${REGISTRY}/${encodeName(name)}`, { headers: { accept: "application/vnd.npm.install-v1+json" } });
      if (r.status === 404) return { ok: true, value: null };
      if (r.error || !r.body) return { ok: false, error: r.error ?? "empty registry response" };
      const doc = r.body as AbbreviatedDoc;
      const versions: PackageInfo["versions"] = {};
      for (const [v, meta] of Object.entries(doc.versions ?? {})) {
        versions[v] = { ...(meta.deprecated ? { deprecated: meta.deprecated } : {}), ...(meta.dist?.tarball ? { tarball: meta.dist.tarball } : {}) };
      }
      const latest = doc["dist-tags"]?.latest ?? Object.keys(versions).pop() ?? "";
      return { ok: true, value: { name, latest, versions } };
    });
  }

  createdAt(name: string): Promise<Lookup<Date | undefined>> {
    return cached(`created:${name}`, async () => {
      // The full packument is the only registry document with publish times.
      const r = await getJson(`${REGISTRY}/${encodeName(name)}`);
      if (r.status === 404) return { ok: true, value: undefined };
      if (r.error || !r.body) return { ok: false, error: r.error ?? "empty registry response" };
      const created = (r.body as { time?: { created?: string } }).time?.created;
      return { ok: true, value: created ? new Date(created) : undefined };
    });
  }

  weeklyDownloads(name: string): Promise<Lookup<number>> {
    return cached(`dl:${name}`, async () => {
      const r = await getJson(`${DOWNLOADS_API}/${name}`);
      if (r.status === 404) return { ok: true, value: 0 };
      if (r.error || !r.body) return { ok: false, error: r.error ?? "empty downloads response" };
      return { ok: true, value: (r.body as { downloads?: number }).downloads ?? 0 };
    });
  }

  vulnerabilities(queries: VulnQuery[]): Promise<Lookup<Map<string, Vuln[]>>> {
    if (queries.length === 0) return Promise.resolve({ ok: true, value: new Map() });
    const key = `vulns:${queries.map((q) => `${q.name}@${q.version}`).sort().join(",")}`;
    return cached(key, () => this.lookupVulns(queries));
  }

  private async lookupVulns(queries: VulnQuery[]): Promise<Lookup<Map<string, Vuln[]>>> {
    const errors: string[] = [];
    const bin = await which("osv-scanner", "CODELAUNDRY_OSV_SCANNER");
    if (bin) {
      const r = await this.viaScanner(bin, queries);
      if (r.ok) return r;
      errors.push(r.error);
    } else {
      errors.push("osv-scanner not installed");
    }
    const api = await this.viaApi(queries);
    if (api.ok) return api;
    errors.push(api.error);
    return { ok: false, error: errors.join("; ") };
  }

  /**
   * osv-scanner reads lockfiles, so we write a synthetic package-lock.json. Entries need
   * a registry `resolved` URL, otherwise osv-scanner silently skips them.
   */
  private async viaScanner(bin: string, queries: VulnQuery[]): Promise<Lookup<Map<string, Vuln[]>>> {
    const packages: Record<string, unknown> = { "": { name: "codelaundry-check", version: "0.0.0" } };
    for (const q of queries) {
      packages[`node_modules/${q.name}`] = {
        version: q.version,
        resolved: q.tarball ?? `${REGISTRY}/${q.name}/-/${q.name.split("/").pop()}-${q.version}.tgz`,
      };
    }
    const lock = JSON.stringify({ name: "codelaundry-check", version: "0.0.0", lockfileVersion: 3, requires: true, packages });
    const offline = process.env.CODELAUNDRY_OSV_OFFLINE === "1";
    return withTempFile("package-lock.json", lock, async (dir, file) => {
      const cacheDir = process.env.OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY ?? path.join(process.env.HOME ?? dir, ".cache", "osv-scanner");
      if (offline) await mkdir(cacheDir, { recursive: true });
      const args = ["scan", "source", "--format", "json", "-L", file, ...(offline ? ["--offline-vulnerabilities", "--download-offline-databases"] : [])];
      const res = await run(bin, args, { cwd: dir, timeoutMs: offline ? 600_000 : 60_000, env: { OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY: cacheDir } });
      // 0 = clean, 1 = vulnerabilities found; anything else is a failure (e.g. API blocked).
      if (res.code !== 0 && res.code !== 1) {
        const line = res.stderr.split("\n").find((l) => /error|forbidden|failed/i.test(l)) ?? `exit ${res.code}`;
        return { ok: false, error: `osv-scanner failed: ${line.slice(0, 160)}` };
      }
      let parsed: { results?: Array<{ packages?: Array<{ package: { name: string; version: string }; vulnerabilities?: OsvVulnDoc[]; groups?: Array<{ ids: string[]; max_severity?: string }> }> }> };
      try {
        parsed = JSON.parse(res.stdout);
      } catch {
        return { ok: false, error: "osv-scanner produced no JSON" };
      }
      const out = new Map<string, Vuln[]>();
      for (const r of parsed.results ?? []) {
        for (const p of r.packages ?? []) {
          const vulns = (p.vulnerabilities ?? []).map((v) => {
            const group = p.groups?.find((g) => g.ids.includes(v.id));
            const score = group?.max_severity ? Number(group.max_severity) : undefined;
            const fixed = fixedVersion(v, p.package.name);
            return { id: v.id, ...(v.summary ? { summary: v.summary } : {}), severity: osvSeverity(v.database_specific?.severity, score), ...(fixed ? { fixed } : {}) };
          });
          if (vulns.length) out.set(`${p.package.name}@${p.package.version}`, vulns);
        }
      }
      return { ok: true, value: out };
    });
  }

  private async viaApi(queries: VulnQuery[]): Promise<Lookup<Map<string, Vuln[]>>> {
    const r = await getJson(`${OSV_API}/querybatch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ queries: queries.map((q) => ({ package: { name: q.name, ecosystem: "npm" }, version: q.version })) }),
    });
    if (r.error || !r.body) return { ok: false, error: `OSV API: ${r.error ?? "empty response"}` };
    const results = (r.body as { results?: Array<{ vulns?: Array<{ id: string }> }> }).results ?? [];
    const out = new Map<string, Vuln[]>();
    let detailBudget = 25;
    for (const [i, res] of results.entries()) {
      const q = queries[i];
      if (!q || !res.vulns?.length) continue;
      const vulns: Vuln[] = [];
      for (const { id } of res.vulns) {
        if (detailBudget-- <= 0) {
          vulns.push({ id, severity: "medium" });
          continue;
        }
        const d = await getJson(`${OSV_API}/vulns/${encodeURIComponent(id)}`);
        const doc = d.body as OsvVulnDoc | undefined;
        const fixed = doc ? fixedVersion(doc, q.name) : undefined;
        vulns.push({ id, ...(doc?.summary ? { summary: doc.summary } : {}), severity: osvSeverity(doc?.database_specific?.severity), ...(fixed ? { fixed } : {}) });
      }
      out.set(`${q.name}@${q.version}`, vulns);
    }
    return { ok: true, value: out };
  }
}

