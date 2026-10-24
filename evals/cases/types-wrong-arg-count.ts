function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export const pct = (n: number): number => clamp(n, 0);
