import type { NextApiRequest, NextApiResponse } from "next";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";
import { summarizeTools, executeTool } from "../../../lib/agent-tools";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const systemPrompt = readFileSync(join(process.cwd(), "prompts/summarize.txt"), "utf-8");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const { product_id, name, releases = [] } = req.body;
  if (!product_id || !name) return res.status(400).json({ error: "product_id and name are required" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  function send(data: object) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  const releaseSummary = releases.length
    ? `\nKnown releases:\n${releases.map((r: { name: string; date: string }) => `- ${r.name} (${r.date})`).join("\n")}`
    : "";

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Product ID: ${product_id}\nProduct name: "${name}"${releaseSummary}`,
    },
  ];

  let summaries_inserted = 0;

  while (true) {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 8192,
      system: systemPrompt,
      tools: summarizeTools,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") break;

    if (response.stop_reason === "tool_use") {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        send({ type: "tool_call", name: block.name });
        const result = await executeTool(block.name, block.input as Record<string, unknown>);
        if (block.name === "insert_feedback_summary") {
          summaries_inserted++;
          const input = block.input as { start_date: string; end_date: string };
          send({ type: "summary_inserted", start_date: input.start_date, end_date: input.end_date });
        }
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }

      messages.push({ role: "user", content: toolResults });
    } else {
      break;
    }
  }

  send({ type: "done", summaries_inserted });
  res.end();
}
