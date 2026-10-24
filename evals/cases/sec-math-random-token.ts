export function createSessionToken(): string {
  const sessionToken = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return sessionToken;
}
