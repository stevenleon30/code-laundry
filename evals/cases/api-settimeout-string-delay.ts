export function later(fn: () => void): void {
  setTimeout(fn, "1000");
}
