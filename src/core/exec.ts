import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Variables passed through to tools; everything else (API keys, tokens) is dropped. */
const PASS_ENV = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy", "REQUESTS_CA_BUNDLE", "OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY", "XDG_CACHE_HOME"];

export function scrubbedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of PASS_ENV) if (process.env[k] !== undefined) env[k] = process.env[k];
  return { ...env, ...extra };
}

/**
 * Run a tool without a shell. Arguments are passed as an array, so nothing in them
 * (including file names derived from input) is interpreted by a shell.
 */
export function run(
  cmd: string,
  args: readonly string[],
  opts: { cwd?: string; timeoutMs?: number; maxBuffer?: number; env?: Record<string, string> } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? 60_000,
        maxBuffer: opts.maxBuffer ?? 32 * 1024 * 1024,
        env: scrubbedEnv(opts.env),
        windowsHide: true,
        shell: false,
      },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
        if (e && e.code === "ENOENT") {
          resolve({ code: null, stdout: "", stderr: `${cmd}: not found`, timedOut: false });
          return;
        }
        resolve({
          code: e ? (typeof e.code === "number" ? e.code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
          timedOut: Boolean(e?.killed),
        });
      },
    );
  });
}

const whichCache = new Map<string, Promise<string | undefined>>();

async function findOnPath(cmd: string): Promise<string | undefined> {
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + ext);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        /* keep looking */
      }
    }
  }
  return undefined;
}

/**
 * Locate a binary on PATH (or via an env override such as CODELAUNDRY_SEMGREP).
 * Looks at the filesystem only: running `tool --version` can trigger slow network
 * update checks (semgrep's takes minutes when its server is unreachable).
 */
export function which(cmd: string, envOverride?: string): Promise<string | undefined> {
  const override = envOverride ? process.env[envOverride] : undefined;
  if (override) return Promise.resolve(override);
  let p = whichCache.get(cmd);
  if (!p) {
    p = findOnPath(cmd);
    whichCache.set(cmd, p);
  }
  return p;
}

/**
 * Temporary directory (mode 0700) holding a copy of the submitted code for tools
 * that only read files (Semgrep, gitleaks). The code is data: it is never executed.
 * Always removed afterwards.
 */
export async function withTempFile<T>(filename: string, content: string, fn: (dir: string, file: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codelaundry-"));
  const file = path.join(dir, path.basename(filename));
  try {
    await writeFile(file, content, { mode: 0o600 });
    return await fn(dir, file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
