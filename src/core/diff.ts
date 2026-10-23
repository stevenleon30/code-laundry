import { createTwoFilesPatch } from "diff";

export function unifiedDiff(before: string, after: string, filename: string): string {
  if (before === after) return "";
  return createTwoFilesPatch(`a/${filename}`, `b/${filename}`, before, after, undefined, undefined, { context: 3 });
}
