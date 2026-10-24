export function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2, true);
}
