import { verifyToken } from "@auth/jwt-verify-pro";

export function isValid(token: string): boolean {
  return verifyToken(token).valid;
}
