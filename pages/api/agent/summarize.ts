import type { NextApiRequest, NextApiResponse } from "next";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";
import { summarizeTools } from "../../../lib/agent-tools";
import { runAgent } from "../../../lib/agent-runner";

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

  try {
    const result = await runAgent({
      anthropic,
      agentType: "summarize",
      systemPrompt,
      tools: summarizeTools,
      model: "claude-opus-4-7",
      maxTokens: 8192,
      product: { product_id, name },
      additionalUserContent: releaseSummary,
      send,
    });
    send({
      type: "done",
      run_id: result.runId,
      status: result.status,
      summaries_inserted: result.summariesInserted,
      tool_failures: result.toolFailures,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send({ type: "error", message });
  } finally {
    res.end();
  }
}
