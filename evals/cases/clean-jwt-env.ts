import jwt from "jsonwebtoken";

export function issueToken(userId: string, secret: string = process.env.JWT_SECRET ?? ""): string {
  if (!secret) throw new Error("JWT_SECRET is not configured");
  return jwt.sign({ sub: userId }, secret, { expiresIn: "1h", algorithm: "HS256" });
}
