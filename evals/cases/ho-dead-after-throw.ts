export function assertPositive(n: number): number {
  if (n <= 0) {
    throw new RangeError("must be positive");
    return 0;
  }
  return n;
}
