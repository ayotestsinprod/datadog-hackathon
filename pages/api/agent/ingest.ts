import type { NextApiRequest, NextApiResponse } from "next";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";
import { tools, executeTool } from "./tools";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const systemPrompt = readFileSync(join(process.cwd(), "prompts/ingest.txt"), "utf-8");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const { name, description = "", links = [] } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Product name: "${name}"${description ? `\nDescription: ${description}` : ""}${links.length ? `\nLinks: ${links.join(", ")}` : ""}`,
    },
  ];

  const toolCallLog: string[] = [];
  let releases_inserted = 0;
  let product_id: string | null = null;

  while (true) {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") break;

    if (response.stop_reason === "tool_use") {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        toolCallLog.push(block.name);
        const result = await executeTool(block.name, block.input as Record<string, unknown>);
        const parsed = JSON.parse(result);

        if (block.name === "insert_product") product_id = parsed.id;
        if (block.name === "search_products" && parsed.length > 0) product_id = parsed[0].id;
        if (block.name === "insert_release") releases_inserted++;

        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }

      messages.push({ role: "user", content: toolResults });
    } else {
      break;
    }
  }

  res.status(200).json({ product_id, releases_inserted, tool_calls: toolCallLog });
}
