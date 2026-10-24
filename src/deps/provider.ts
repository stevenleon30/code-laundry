import { readFileSync } from "node:fs";
import type { Severity } from "../core/types.js";

export interface PackageInfo {
  name: string;
  latest: string;
  versions: Record<string, { deprecated?: string; tarball?: string }>;
}

export interface VulnQuery {
  name: string;
  version: string;
  tarball?: string;
}

export interface Vuln {
  id: string;
  summary?: string;
  severity: Severity;
  fixed?: string;
}

/** Result of a lookup that may legitimately fail (network). Failures are reported, never treated as "clean". */
export type Lookup<T> = { ok: true; value: T } | { ok: false; error: string };

export interface DepsProvider {
  readonly id: string;
  /** null = package does not exist on the registry. */
  packageInfo(name: string): Promise<Lookup<PackageInfo | null>>;
  /** First publish date. */
  createdAt(name: string): Promise<Lookup<Date | undefined>>;
  weeklyDownloads(name: string): Promise<Lookup<number>>;
  /** Vulnerabilities keyed by `name@version`. */
  vulnerabilities(queries: VulnQuery[]): Promise<Lookup<Map<string, Vuln[]>>>;
}

/** Deterministic provider backed by a JSON file. Used by evals and tests (CODELAUNDRY_DEPS_FIXTURE). */
export interface DepsFixture {
  packages: Record<string, { latest: string; versions?: Record<string, { deprecated?: string }>; created?: string; weeklyDownloads?: number }>;
  vulns?: Record<string, Vuln[]>;
  /** Simulate an unavailable service. */
  unavailable?: Array<"registry" | "downloads" | "osv">;
}

export class FixtureDepsProvider implements DepsProvider {
  readonly id = "fixture";
  constructor(private readonly fx: DepsFixture) {}

  static fromFile(file: string): FixtureDepsProvider {
    return new FixtureDepsProvider(JSON.parse(readFileSync(file, "utf8")) as DepsFixture);
  }

  private down(what: "registry" | "downloads" | "osv"): boolean {
    return this.fx.unavailable?.includes(what) ?? false;
  }

  async packageInfo(name: string): Promise<Lookup<PackageInfo | null>> {
    if (this.down("registry")) return { ok: false, error: "registry unavailable (fixture)" };
    const p = this.fx.packages[name];
    if (!p) return { ok: true, value: null };
    return { ok: true, value: { name, latest: p.latest, versions: p.versions ?? { [p.latest]: {} } } };
  }

  async createdAt(name: string): Promise<Lookup<Date | undefined>> {
    if (this.down("registry")) return { ok: false, error: "registry unavailable (fixture)" };
    const c = this.fx.packages[name]?.created;
    return { ok: true, value: c ? new Date(c) : undefined };
  }

  async weeklyDownloads(name: string): Promise<Lookup<number>> {
    if (this.down("downloads")) return { ok: false, error: "downloads API unavailable (fixture)" };
    return { ok: true, value: this.fx.packages[name]?.weeklyDownloads ?? 0 };
  }

  async vulnerabilities(queries: VulnQuery[]): Promise<Lookup<Map<string, Vuln[]>>> {
    if (this.down("osv")) return { ok: false, error: "OSV unavailable (fixture)" };
    const out = new Map<string, Vuln[]>();
    for (const q of queries) {
      const v = this.fx.vulns?.[`${q.name}@${q.version}`];
      if (v?.length) out.set(`${q.name}@${q.version}`, v);
    }
    return { ok: true, value: out };
  }
}
