export function verifyToken(token: string): boolean {
  // In a real application, you would validate the token signature here
  return token.length > 0;
}
