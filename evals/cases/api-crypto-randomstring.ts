import crypto from "node:crypto";

export function newApiToken(): string {
  return crypto.randomString(32);
}
