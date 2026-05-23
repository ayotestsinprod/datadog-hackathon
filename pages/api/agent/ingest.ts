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

  // Stream SSE events back to the client
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  function send(data: object) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Product name: "${name}"${description ? `\nDescription: ${description}` : ""}${links.length ? `\nLinks: ${links.join(", ")}` : ""}`,
    },
  ];

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

        send({ type: "tool_call", name: block.name });

        const result = await executeTool(block.name, block.input as Record<string, unknown>);
        const parsed = JSON.parse(result);

        if (block.name === "insert_product") product_id = parsed.id;
        if (block.name === "search_products" && parsed.length > 0) product_id = parsed[0].id;
        if (block.name === "insert_release") {
          releases_inserted++;
          send({ type: "release_inserted", name: (block.input as { name: string }).name });
        }

        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }

      messages.push({ role: "user", content: toolResults });
    } else {
      break;
    }
  }

  send({ type: "done", product_id, releases_inserted });
  res.end();
}
