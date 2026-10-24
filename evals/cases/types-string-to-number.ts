export function parsePort(env: Record<string, string | undefined>): number {
  const port: number = env.PORT || "3000";
  return port;
}
