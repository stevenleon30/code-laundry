import crypto from "node:crypto";

export function encrypt(text: string, key: string): string {
  const cipher = crypto.createCipher("aes-256-cbc", key);
  return cipher.update(text, "utf8", "hex") + cipher.final("hex");
}
