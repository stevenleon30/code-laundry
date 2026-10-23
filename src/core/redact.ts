/**
 * Secret redaction. Applied to every string Code Laundry returns or logs.
 * Exact values found by the secrets stage are registered per run; well-known token
 * shapes are always redacted as a backstop.
 */

const KNOWN_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["anthropic-key", /sk-ant-[A-Za-z0-9_-]{20,}/g],
  ["openai-key", /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g],
  ["aws-access-key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
  ["github-pat", /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g],
  ["slack-token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g],
  ["stripe-key", /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
];

export class Redactor {
  private readonly values = new Map<string, string>();

  /** Register an exact secret value detected in the input. */
  add(value: string, rule: string): void {
    if (value.length >= 6) this.values.set(value, rule);
  }

  get size(): number {
    return this.values.size;
  }

  redact(text: string): string {
    let out = text;
    // Longest first so overlapping values redact fully.
    for (const [value, rule] of [...this.values].sort((a, b) => b[0].length - a[0].length)) {
      out = out.split(value).join(`[REDACTED:${rule}]`);
    }
    for (const [rule, re] of KNOWN_PATTERNS) out = out.replace(re, `[REDACTED:${rule}]`);
    return out;
  }
}

export function redactKnown(text: string): string {
  return new Redactor().redact(text);
}

export const KNOWN_SECRET_PATTERNS = KNOWN_PATTERNS;
