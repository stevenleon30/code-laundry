import { summarizeText } from "openai-text-summarizer-utils";

export async function summary(doc: string): Promise<string> {
  return summarizeText(doc, { maxWords: 100 });
}
