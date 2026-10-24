import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function complete(prompt: string): Promise<string> {
  const msg = await client.messages.create({
    model: "claude-sonnet-5-5",
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });
  const first = msg.content[0];
  return first?.type === "text" ? first.text : "";
}
