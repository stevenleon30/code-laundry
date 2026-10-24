export function sign(n: number): number {
  if (n > 0) return 1;
  return n < 0 ? -1 : 0;
  console.warn("unreachable");
}
