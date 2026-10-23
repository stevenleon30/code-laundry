import * as prettier from "prettier";
import { makeFinding, type Stage } from "../../core/stage.js";

function changedLines(before: string, after: string): number {
  const a = before.split("\n");
  const b = after.split("\n");
  let n = Math.abs(a.length - b.length);
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) n++;
  return n;
}

export const formatStage: Stage = {
  id: "ts.format",
  kind: "format",
  languages: ["typescript", "javascript"],
  canFix: true,
  defaultEnabled: true,
  available: async () => ({ ok: true }),
  async run(ctx) {
    const notes: string[] = [];
    let options: prettier.Options = {};
    if (ctx.projectRoot && ctx.config.useProjectConfigs && ctx.detected.projectConfigs.prettier) {
      try {
        options = (await prettier.resolveConfig(ctx.filePath, { editorconfig: true })) ?? {};
        notes.push(`using project Prettier config ${ctx.detected.projectConfigs.prettier}`);
      } catch (err) {
        notes.push(`project Prettier config unusable (${(err as Error).message}); used defaults`);
      }
    }
    const formatted = await prettier.format(ctx.code, { ...options, filepath: ctx.filePath });
    if (formatted === ctx.code) return { findings: [], notes };
    const n = changedLines(ctx.code, formatted);
    const finding = makeFinding({
      ruleId: "format/prettier",
      source: "prettier",
      category: "format",
      severity: "low",
      message: `Code is not formatted (${n} line(s) differ from Prettier output)`,
      fixable: true,
      fixed: ctx.allowFix,
      ...(ctx.allowFix ? { fixedBy: "tool" as const } : {}),
    });
    return { findings: [finding], code: formatted, notes };
  },
};
