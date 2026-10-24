import type { RepairEdits } from "./llm.js";

export interface LineRange {
  startLine: number;
  endLine: number;
}

/** Pad each flagged range by `context` lines, clamp to the file, merge overlaps. */
export function allowedWindows(flagged: readonly LineRange[], context: number, lineCount: number): LineRange[] {
  const padded = flagged
    .map((r) => ({ startLine: Math.max(1, r.startLine - context), endLine: Math.min(lineCount, r.endLine + context) }))
    .sort((a, b) => a.startLine - b.startLine);
  const merged: LineRange[] = [];
  for (const r of padded) {
    const last = merged[merged.length - 1];
    if (last && r.startLine <= last.endLine + 1) last.endLine = Math.max(last.endLine, r.endLine);
    else merged.push({ ...r });
  }
  return merged;
}

export interface PatchResult {
  code: string;
  applied: number;
  rejected: Array<{ edit: LineRange; reason: string }>;
}

/**
 * Apply line-range replacements, enforcing that every edit lies entirely inside one
 * allowed window and that edits don't overlap. Out-of-range or overlapping edits are
 * rejected individually; the rest apply.
 */
export function applyEdits(code: string, edits: RepairEdits["edits"], windows: readonly LineRange[]): PatchResult {
  const lines = code.split("\n");
  const rejected: PatchResult["rejected"] = [];
  const accepted: RepairEdits["edits"] = [];
  for (const e of [...edits].sort((a, b) => a.startLine - b.startLine)) {
    const range = { startLine: e.startLine, endLine: e.endLine };
    if (e.endLine < e.startLine || e.endLine > lines.length) {
      rejected.push({ edit: range, reason: "invalid line range" });
    } else if (!windows.some((w) => e.startLine >= w.startLine && e.endLine <= w.endLine)) {
      rejected.push({ edit: range, reason: "outside the flagged ranges" });
    } else if (accepted.some((a) => e.startLine <= a.endLine && a.startLine <= e.endLine)) {
      rejected.push({ edit: range, reason: "overlaps another edit" });
    } else {
      accepted.push(e);
    }
  }
  for (const e of [...accepted].sort((a, b) => b.startLine - a.startLine)) {
    lines.splice(e.startLine - 1, e.endLine - e.startLine + 1, ...e.replacement.replace(/\n$/, "").split("\n"));
  }
  return { code: lines.join("\n"), applied: accepted.length, rejected };
}

export function numbered(code: string, w: LineRange): string {
  const lines = code.split("\n");
  const width = String(w.endLine).length;
  return lines
    .slice(w.startLine - 1, w.endLine)
    .map((l, i) => `${String(w.startLine + i).padStart(width)}| ${l}`)
    .join("\n");
}
