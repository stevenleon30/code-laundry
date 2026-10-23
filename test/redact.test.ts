import { describe, expect, it } from "vitest";
import { Redactor } from "../src/core/redact.js";

describe("Redactor", () => {
  it("redacts registered values and known token shapes", () => {
    const r = new Redactor();
    r.add("hunter2-supersecret", "generic");
    const out = r.redact('const a = "hunter2-supersecret"; const k = "AKIAABCDEFGHIJKLMNOP";');
    expect(out).not.toContain("hunter2-supersecret");
    expect(out).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(out).toContain("[REDACTED:generic]");
    expect(out).toContain("[REDACTED:aws-access-key]");
  });
});
