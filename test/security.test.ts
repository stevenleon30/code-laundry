import { describe, expect, it } from "vitest";
import { which } from "../src/core/exec.js";
import { launder } from "../src/core/pipeline.js";
import { builtinScan } from "../src/stages/shared/secrets.js";
import { SYNTHETIC_SECRETS as S } from "../evals/synthetic-secrets.js";

const hasSemgrep = Boolean(await which("semgrep", "CODELAUNDRY_SEMGREP"));
const rules = (r: { findings: { ruleId: string }[] }) => r.findings.map((f) => f.ruleId);

describe("secrets", () => {
  it("finds known token shapes and generic high-entropy assignments", () => {
    const code = [
      `const a = "${S.AWS_KEY_ID}";`,
      `const ghToken = "${S.GITHUB}";`,
      'const config = { apiKey: "q8Zr2LmX9vKp4TnB7wYc" };',
      'const db = "postgres://admin:S3cr3tPass!@db.internal:5432/app";',
    ].join("\n");
    const hits = builtinScan(code);
    expect(hits.map((h) => h.rule)).toEqual(expect.arrayContaining(["aws-access-key", "github-token", "generic-secret", "url-credentials"]));
  });

  it("ignores placeholders and env lookups", () => {
    const code = [
      'const apiKey = "your-api-key-here";',
      "const token = process.env.TOKEN;",
      'const password = "password";',
      'const secret = "${SECRET}";',
      'const authHeader = "Bearer token";',
    ].join("\n");
    expect(builtinScan(code)).toEqual([]);
  });

  it("rejects and redacts secrets everywhere in the result", async () => {
    const code = `export const key = "${S.ANTHROPIC}";\n`;
    const r = await launder({ code, mode: "fix" });
    expect(r.verdict).toBe("reject");
    expect(r.verdictReasons).toContain("secret detected");
    expect(rules(r)).toContain("secrets/anthropic-key");
    expect(JSON.stringify(r)).not.toContain("AbCdEfGhIjKlMnOp");
  });

  it("redacts generic secrets (no known shape) from cleanedCode and diff", async () => {
    const code = 'export const config = { clientSecret: "q8Zr2LmX9vKp4TnB7wYc" }\n';
    const r = await launder({ code, mode: "fix" });
    expect(r.verdict).toBe("reject");
    expect(r.diff).not.toBe("");
    expect(JSON.stringify(r)).not.toContain("q8Zr2LmX9vKp4TnB7wYc");
  });
});

describe.skipIf(!hasSemgrep)("semgrep rules", () => {
  it("detects SQL injection from request data and string-built SQL", async () => {
    const code = `import express from "express";
const app = express();
const db = { query: async (q: string, p?: unknown[]) => [q, p] };
app.get("/u", async (req, res) => {
  res.json(await db.query(\`SELECT * FROM users WHERE id = \${req.query.id}\`));
});
export async function byName(name: string) {
  return db.query("SELECT * FROM users WHERE name = '" + name + "'");
}
export async function safe(id: string) {
  return db.query("SELECT * FROM users WHERE id = $1", [id]);
}
`;
    const r = await launder({ code, mode: "check" });
    const sql = r.findings.filter((f) => f.ruleId.startsWith("semgrep/sql-injection"));
    expect(sql.map((f) => f.location?.line)).toEqual(expect.arrayContaining([5, 8]));
    expect(sql.some((f) => f.location?.line === 11)).toBe(false);
    expect(r.verdict).toBe("reject");
  });

  it("detects command injection, path traversal, SSRF, weak crypto", async () => {
    const code = `import { exec } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import express from "express";
const app = express();
export function run(dir: string): void {
  exec(\`ls \${dir}\`);
}
app.get("/f", (req, res) => {
  res.send(fs.readFileSync("/data/" + req.params.name));
});
app.get("/p", async (req, res) => {
  res.send(await (await fetch(req.query.url as string)).text());
});
export function digest(s: string): string {
  return crypto.createHash("md5").update(s).digest("hex");
}
`;
    const r = await launder({ code, mode: "check" });
    expect(rules(r)).toEqual(
      expect.arrayContaining(["semgrep/command-injection", "semgrep/path-traversal", "semgrep/ssrf", "semgrep/weak-hash"]),
    );
  });
});

describe("security tools unavailable", () => {
  it("records a skipped semgrep stage explicitly", async () => {
    const prev = process.env.CODELAUNDRY_SEMGREP;
    try {
      process.env.CODELAUNDRY_SEMGREP = "/nonexistent/semgrep";
      const r = await launder({ code: "export const x = 1;\n", mode: "strict" });
      const sg = r.stagesRun.find((s) => s.id === "ts.semgrep");
      expect(sg?.status).toBe("failed");
      expect(r.verdict).toBe("reject"); // strict: a security stage that didn't run is blocking
      expect(rules(r)).toContain("laundry/stage-unavailable");
    } finally {
      if (prev === undefined) delete process.env.CODELAUNDRY_SEMGREP;
      else process.env.CODELAUNDRY_SEMGREP = prev;
    }
  });
});
