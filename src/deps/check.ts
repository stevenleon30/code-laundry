import { readFile } from "node:fs/promises";
import path from "node:path";
import semver from "semver";
import { type LaundryConfig, matchesPattern } from "../core/config.js";
import { makeFinding } from "../core/stage.js";
import { type Finding, type Location, type Mode, severityRank } from "../core/types.js";
import { isValidPackageName, typosquatTarget } from "./names.js";
import { NetworkDepsProvider } from "./npm.js";
import { POPULAR_SET } from "./popular.js";
import { type DepsProvider, FixtureDepsProvider, type Vuln, type VulnQuery } from "./provider.js";

let provider: DepsProvider | undefined;

export function getDepsProvider(): DepsProvider {
  if (!provider) {
    const fixture = process.env.CODELAUNDRY_DEPS_FIXTURE;
    provider = fixture ? FixtureDepsProvider.fromFile(fixture) : new NetworkDepsProvider();
  }
  return provider;
}

export function setDepsProvider(p: DepsProvider | undefined): void {
  provider = p;
}

export interface DepRequest {
  name: string;
  /** Exact version or semver range (from package.json). */
  range?: string;
  location?: Location;
}

export interface PackageReport {
  name: string;
  status: "ok" | "flagged" | "allowed" | "unknown";
  exists?: boolean;
  version?: string;
  latest?: string;
  deprecated?: string;
  ageDays?: number;
  weeklyDownloads?: number;
  typosquatOf?: string;
  vulnerabilities: Vuln[];
}

export interface DepCheckResult {
  findings: Finding[];
  packages: PackageReport[];
  notes: string[];
  /** Services that could not be reached; their checks did not happen. */
  unavailable: string[];
}

export interface DepCheckOptions {
  config: LaundryConfig;
  mode: Mode;
  projectRoot?: string;
  /** Names declared in the project's package.json; enables the "undeclared import" check. */
  declared?: ReadonlySet<string>;
  provider?: DepsProvider;
}

async function installedVersion(projectRoot: string | undefined, name: string): Promise<string | undefined> {
  if (!projectRoot) return undefined;
  try {
    const pkg = JSON.parse(await readFile(path.join(projectRoot, "node_modules", name, "package.json"), "utf8")) as { version?: string };
    return pkg.version;
  } catch {
    return undefined;
  }
}

export async function readDeclaredDependencies(projectRoot: string): Promise<Set<string> | undefined> {
  try {
    const pkg = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    const names = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap((k) => Object.keys(pkg[k] ?? {}));
    return new Set(names);
  } catch {
    return undefined;
  }
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i] as T);
      }
    }),
  );
  return out;
}

const DAY = 24 * 60 * 60 * 1000;

export async function checkDependencies(requests: readonly DepRequest[], opts: DepCheckOptions): Promise<DepCheckResult> {
  const p = opts.provider ?? getDepsProvider();
  const { deps } = opts.config;
  const findings: Finding[] = [];
  const notes: string[] = [];
  const unavailable = new Set<string>();
  const unique = [...new Map(requests.map((r) => [r.name, r])).values()];
  const vulnQueries: Array<VulnQuery & { report: PackageReport; location?: Location }> = [];

  const flag = (report: PackageReport, f: Parameters<typeof makeFinding>[0]) => {
    report.status = "flagged";
    findings.push(makeFinding(f));
  };

  const packages = await mapLimit(unique, 8, async (req): Promise<PackageReport> => {
    const { name, location } = req;
    const report: PackageReport = { name, status: "ok", vulnerabilities: [] };
    const at = location ? { location } : {};
    if (matchesPattern(name, opts.config.allowedPackages)) return { ...report, status: "allowed" };

    if (!isValidPackageName(name)) {
      flag(report, {
        ruleId: "deps/invalid-name",
        source: "code-laundry",
        category: "hallucinated-dependency",
        severity: "critical",
        message: `"${name}" is not a valid npm package name, so it cannot be a real dependency.`,
        ...at,
      });
      return { ...report, exists: false };
    }

    const installed = await installedVersion(opts.projectRoot, name);
    const info = await p.packageInfo(name);
    const suggestion = typosquatTarget(name);
    if (!info.ok) {
      unavailable.add(`npm registry (${info.error})`);
      return { ...report, status: "unknown", ...(installed ? { version: installed } : {}) };
    }
    if (info.value === null) {
      if (installed) {
        notes.push(`${name} is not on the public registry but is installed locally (private package?)`);
        return { ...report, exists: true, version: installed };
      }
      flag(report, {
        ruleId: "deps/not-found",
        source: "npm-registry",
        category: "hallucinated-dependency",
        severity: "critical",
        message:
          `Package "${name}" does not exist on the npm registry (likely hallucinated; the name could be registered by an attacker).` +
          (suggestion ? ` Did you mean "${suggestion}"?` : "") +
          " If it is a private package, add it to allowedPackages.",
        ...at,
      });
      return { ...report, exists: false, ...(suggestion ? { typosquatOf: suggestion } : {}) };
    }

    const pkg = info.value;
    report.exists = true;
    report.latest = pkg.latest;
    if (/-security$/.test(pkg.latest) && Object.keys(pkg.versions).length <= 2) {
      flag(report, {
        ruleId: "deps/removed-malicious",
        source: "npm-registry",
        category: "hallucinated-dependency",
        severity: "critical",
        message:
          `npm replaced "${name}" with a security placeholder (${pkg.latest}): the original package was removed as malicious.` +
          (suggestion ? ` Did you mean "${suggestion}"?` : ""),
        ...at,
      });
      return { ...report, ...(suggestion ? { typosquatOf: suggestion } : {}) };
    }
    const versions = Object.keys(pkg.versions);
    const fromRange = req.range && semver.validRange(req.range) ? semver.maxSatisfying(versions, req.range) : null;
    const version = installed ?? fromRange ?? pkg.latest;
    report.version = version;

    const deprecated = pkg.versions[version]?.deprecated;
    if (deprecated) {
      report.deprecated = deprecated;
      flag(report, {
        ruleId: "deps/deprecated",
        source: "npm-registry",
        category: "dependency",
        severity: "medium",
        message: `${name}@${version} is deprecated: ${deprecated.slice(0, 200)}`,
        ...at,
      });
    }

    let suspicious = false;
    if (!POPULAR_SET.has(name)) {
      const created = await p.createdAt(name);
      if (!created.ok) unavailable.add(`npm registry publish dates (${created.error})`);
      else if (created.value) {
        const ageDays = Math.floor((Date.now() - created.value.getTime()) / DAY);
        report.ageDays = ageDays;
        if (ageDays < deps.minAgeDays) {
          suspicious = true;
          flag(report, {
            ruleId: "deps/new-package",
            source: "npm-registry",
            category: "dependency",
            severity: "medium",
            message: `${name} was first published ${ageDays} day(s) ago (threshold ${deps.minAgeDays}). New packages are a common malware vector; verify it is the intended package.`,
            ...at,
          });
        }
      }
      const dl = await p.weeklyDownloads(name);
      if (!dl.ok) unavailable.add(`npm downloads API (${dl.error})`);
      else {
        report.weeklyDownloads = dl.value;
        if (dl.value < deps.minWeeklyDownloads) {
          suspicious = true;
          flag(report, {
            ruleId: "deps/low-downloads",
            source: "npm-downloads",
            category: "dependency",
            severity: "medium",
            message: `${name} has ${dl.value} weekly downloads (threshold ${deps.minWeeklyDownloads}). Low adoption means little scrutiny; verify the package.`,
            ...at,
          });
        }
      }
    }

    if (suggestion) {
      report.typosquatOf = suggestion;
      flag(report, {
        ruleId: "deps/typosquat",
        source: "code-laundry",
        category: "dependency",
        severity: suspicious ? "high" : "medium",
        message: `"${name}" looks like a misspelling of the popular package "${suggestion}" (possible typosquat). Use "${suggestion}" unless "${name}" is really intended.`,
        ...at,
      });
    }

    if (opts.declared && !opts.declared.has(name)) {
      flag(report, {
        ruleId: "deps/undeclared",
        source: "code-laundry",
        category: "dependency",
        severity: "medium",
        message: `${name} is imported but not declared in package.json.`,
        ...at,
      });
    }

    const tarball = pkg.versions[version]?.tarball;
    vulnQueries.push({ name, version, ...(tarball ? { tarball } : {}), report, ...(location ? { location } : {}) });
    return report;
  });

  if (vulnQueries.length > 0) {
    const vulns = await p.vulnerabilities(vulnQueries.map(({ name, version, tarball }) => ({ name, version, ...(tarball ? { tarball } : {}) })));
    if (!vulns.ok) unavailable.add(`vulnerability database (${vulns.error})`);
    else {
      for (const q of vulnQueries) {
        const list = vulns.value.get(`${q.name}@${q.version}`);
        if (!list?.length) continue;
        q.report.vulnerabilities = list;
        const worst = list.reduce((a, b) => (severityRank[b.severity] > severityRank[a.severity] ? b : a));
        const fixes = list.map((v) => v.fixed).filter((v): v is string => Boolean(v && semver.valid(v)));
        const fixedIn = fixes.length ? fixes.sort(semver.rcompare)[0] : undefined;
        flag(q.report, {
          ruleId: "deps/vulnerable",
          source: "osv",
          category: "dependency",
          severity: worst.severity,
          message:
            `${q.name}@${q.version} has ${list.length} known vulnerabilit${list.length === 1 ? "y" : "ies"}: ` +
            `${list.slice(0, 5).map((v) => v.id).join(", ")}${list.length > 5 ? ", …" : ""}` +
            (worst.summary ? ` (worst: ${worst.summary.slice(0, 120)})` : "") +
            (fixedIn ? `. Upgrade to ${fixedIn} or later.` : "."),
          ...(q.location ? { location: q.location } : {}),
        });
      }
    }
  }

  const unavailableList = [...unavailable];
  for (const u of unavailableList) notes.push(`not checked: ${u}`);
  // In strict mode, an unreachable registry or vulnerability database is not a clean result.
  if (opts.mode === "strict") {
    for (const u of unavailableList.filter((x) => !x.startsWith("npm downloads"))) {
      findings.push(
        makeFinding({
          ruleId: "laundry/stage-unavailable",
          source: "code-laundry",
          category: "pipeline",
          severity: "high",
          message: `Dependency check incomplete in strict mode: ${u}`,
        }),
      );
    }
  }
  return { findings, packages, notes, unavailable: unavailableList };
}
