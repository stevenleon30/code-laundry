import { describe, expect, it } from "vitest";
import { SYNTHETIC_SECRETS as S } from "../evals/synthetic-secrets.js";
import { Redactor } from "../src/core/redact.js";

describe("Redactor", () => {
  it("redacts registered values and known token shapes", () => {
    const r = new Redactor();
    r.add("hunter2-supersecret", "generic");
    const out = r.redact(`const a = "hunter2-supersecret"; const k = "${S.AWS_KEY_ID}";`);
    expect(out).not.toContain("hunter2-supersecret");
    expect(out).not.toContain(S.AWS_KEY_ID);
    expect(out).toContain("[REDACTED:generic]");
    expect(out).toContain("[REDACTED:aws-access-key]");
  });
});
