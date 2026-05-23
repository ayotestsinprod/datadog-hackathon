import type { NextApiRequest, NextApiResponse } from "next";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";
import { initializeTools } from "../../../lib/agent-tools";
import { runAgent } from "../../../lib/agent-runner";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const systemPrompt = readFileSync(join(process.cwd(), "prompts/initialize.txt"), "utf-8");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const { product_id, name, description = "", links = [] } = req.body;
  if (!product_id || !name) return res.status(400).json({ error: "product_id and name are required" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  function send(data: object) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  try {
    const result = await runAgent({
      anthropic,
      agentType: "initialize",
      systemPrompt,
      tools: initializeTools,
      model: "claude-opus-4-7",
      maxTokens: 2048,
      product: { product_id, name, description, links },
      send,
    });
    send({ type: "done", run_id: result.runId, status: result.status, tool_failures: result.toolFailures });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send({ type: "error", message });
  } finally {
    res.end();
  }
}
