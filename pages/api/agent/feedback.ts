import type { NextApiRequest, NextApiResponse } from "next";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";
import { feedbackTools } from "../../../lib/agent-tools";
import { runAgent } from "../../../lib/agent-runner";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const systemPrompt = readFileSync(join(process.cwd(), "prompts/feedback.txt"), "utf-8");

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Rolling ~90-day window for feedback discovery (UTC calendar dates). */
function feedbackSearchWindow(): { start_date: string; end_date: string } {
  const end = new Date();
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 3);
  return { start_date: ymd(start), end_date: ymd(end) };
}

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
    const { start_date, end_date } = feedbackSearchWindow();
    const result = await runAgent({
      anthropic,
      agentType: "feedback",
      systemPrompt,
      tools: feedbackTools,
      model: "claude-opus-4-7",
      maxTokens: 8192,
      product: { product_id, name, description, links },
      additionalUserContent: `\n\nFeedback discovery scope:\n- start_date: ${start_date}\n- end_date: ${end_date}\n- Sources only: reddit.com and (x.com OR twitter.com). Ignore any other domains even if you know of useful feedback elsewhere.`,
      send,
    });
    send({
      type: "done",
      run_id: result.runId,
      status: result.status,
      feedback_inserted: result.feedbackInserted,
      tool_failures: result.toolFailures,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send({ type: "error", message });
  } finally {
    res.end();
  }
}
