import jwt from "jsonwebtoken";

export function issueToken(userId: string): string {
  return jwt.sign({ sub: userId }, "x9F2kLq8Zt4mVb7NwP3r", { expiresIn: "1h" });
}
