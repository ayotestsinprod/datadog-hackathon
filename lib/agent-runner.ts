import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "crypto";
import { insertAgentPass } from "./db";
import { executeTool } from "./agent-tools";

const MAX_AGENT_ITERATIONS = 12;
const PREVIEW_LIMIT = 900;

type AgentStatus = "succeeded" | "completed_with_tool_errors" | "failed";

interface AgentProductInput {
  product_id: string;
  name: string;
  description?: string;
  links?: string[];
}

interface RunAgentOptions {
  anthropic: Anthropic;
  agentType: string;
  systemPrompt: string;
  tools: Anthropic.Tool[];
  model: string;
  maxTokens: number;
  product: AgentProductInput;
  additionalUserContent?: string;
  send: (data: Record<string, unknown>) => void;
}

export interface RunAgentResult {
  runId: string;
  status: AgentStatus;
  releasesInserted: number;
  summariesInserted: number;
  feedbackInserted: number;
  rowsCreated: string[];
  toolFailures: number;
  durationMs: number;
}

function compact(value: unknown, limit = PREVIEW_LIMIT): string {
  const raw = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  if (raw.length <= limit) return raw;
  return `${raw.slice(0, limit)}...`;
}

function auditString(value: unknown, limit = 3000): string {
  const raw = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  if (raw.length <= limit) return raw;
  return JSON.stringify({
    truncated: true,
    preview: raw.slice(0, limit),
  });
}

function errorMessage(err: unknown): string {
  if (err instanceof AggregateError) {
    const reasons = err.errors
      .map((error) => errorMessage(error))
      .filter(Boolean)
      .join("; ");
    return err.message || reasons || err.name;
  }

  if (err instanceof Error) {
    return err.message || err.name;
  }

  return String(err);
}

function errorStack(err: unknown): string | undefined {
  return err instanceof Error ? err.stack : undefined;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function rowCreatedForTool(
  toolName: string,
  input: Record<string, unknown>,
  result: Record<string, unknown> | null
): string | null {
  if (toolName === "insert_release" && typeof result?.id === "string") {
    return `release:${result.id}`;
  }

  if (toolName === "insert_feedback" && typeof result?.id === "string") {
    return `release_feedback:${result.id}`;
  }

  if (toolName === "insert_feedback_summary" && typeof result?.id === "string") {
    return `feedback_summary:${result.id}`;
  }

  if (toolName === "insert_product" && typeof result?.id === "string") {
    return `product:${result.id}`;
  }

  if (toolName === "update_product" && typeof input.product_id === "string") {
    return `product:update:${input.product_id}`;
  }

  return null;
}

export async function runAgent({
  anthropic,
  agentType,
  systemPrompt,
  tools,
  model,
  maxTokens,
  product,
  additionalUserContent = "",
  send,
}: RunAgentOptions): Promise<RunAgentResult> {
  const runId = randomUUID();
  const startedAt = Date.now();
  const toolCalls: string[] = [];
  const rowsCreated: string[] = [];
  let releasesInserted = 0;
  let summariesInserted = 0;
  let feedbackInserted = 0;
  let toolFailures = 0;
  let status: AgentStatus = "succeeded";

  const log = (event: string, details: Record<string, unknown> = {}) => {
    const entry = {
      ts: new Date().toISOString(),
      run_id: runId,
      event,
      ...details,
    };
    toolCalls.push(auditString(entry));
    console.info(`[agent:${agentType}] ${runId} ${event}`, details);
  };

  const failRun = (err: unknown) => {
    status = "failed";
    const details = {
      message: errorMessage(err),
      stack: compact(errorStack(err) ?? "", 3000),
    };
    log("run_failed", details);
    console.error(`[agent:${agentType}] ${runId} failed`, err);
  };

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Product ID: ${product.product_id}\nProduct name: "${product.name}"${
        product.description ? `\nDescription: ${product.description}` : ""
      }${product.links?.length ? `\nLinks: ${product.links.join(", ")}` : ""}${additionalUserContent}`,
    },
  ];

  send({
    type: "run_started",
    run_id: runId,
    agent_type: agentType,
    product_id: product.product_id,
  });
  log("run_started", {
    product_id: product.product_id,
    product_name: product.name,
    model,
    tool_names: tools.map((tool) => tool.name),
  });

  try {
    for (let iteration = 1; iteration <= MAX_AGENT_ITERATIONS; iteration++) {
      log("model_request", { iteration, message_count: messages.length });

      const response = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        tools,
        messages,
      });

      log("model_response", {
        iteration,
        stop_reason: response.stop_reason,
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      });
      send({
        type: "model_response",
        run_id: runId,
        iteration,
        stop_reason: response.stop_reason,
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      });

      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "end_turn") {
        break;
      }

      if (response.stop_reason !== "tool_use") {
        throw new Error(`Agent stopped before completion: ${response.stop_reason ?? "unknown"}`);
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        const input = block.input as Record<string, unknown>;
        const toolStartedAt = Date.now();
        send({ type: "tool_call", run_id: runId, name: block.name, input });
        log("tool_call", { name: block.name, input: compact(input) });

        let content: string;
        let ok = true;
        let parsedResult: Record<string, unknown> | null = null;

        try {
          content = await executeTool(block.name, input);
          parsedResult = parseJsonObject(content);
          ok = !parsedResult?.error;
        } catch (err) {
          ok = false;
          content = JSON.stringify({ error: errorMessage(err) });
          parsedResult = parseJsonObject(content);
          log("tool_exception", {
            name: block.name,
            message: errorMessage(err),
            stack: compact(errorStack(err) ?? "", 3000),
          });
          console.error(`[agent:${agentType}] ${runId} tool ${block.name} threw`, err);
        }

        const durationMs = Date.now() - toolStartedAt;
        if (!ok) toolFailures++;

        const created = ok ? rowCreatedForTool(block.name, input, parsedResult) : null;
        if (created) rowsCreated.push(created);

        if (ok && block.name === "insert_release") {
          releasesInserted++;
          send({ type: "release_inserted", run_id: runId, name: input.name });
        }

        if (ok && block.name === "insert_feedback_summary") {
          summariesInserted++;
          send({
            type: "summary_inserted",
            run_id: runId,
            start_date: input.start_date,
            end_date: input.end_date,
          });
        }

        if (ok && block.name === "insert_feedback") {
          feedbackInserted++;
          send({
            type: "feedback_inserted",
            run_id: runId,
            source_type: input.source_type,
            score: input.score,
          });
        }

        const toolEvent = {
          name: block.name,
          ok,
          duration_ms: durationMs,
          output_preview: compact(content),
        };
        log(ok ? "tool_result" : "tool_error", toolEvent);
        send({ type: ok ? "tool_result" : "tool_error", run_id: runId, ...toolEvent });

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content,
        });
      }

      messages.push({ role: "user", content: toolResults });

      if (iteration === MAX_AGENT_ITERATIONS) {
        throw new Error(`Agent exceeded ${MAX_AGENT_ITERATIONS} iterations`);
      }
    }

    if (toolFailures > 0) {
      status = "completed_with_tool_errors";
    }

    log("run_completed", {
      status,
      duration_ms: Date.now() - startedAt,
      tool_failures: toolFailures,
      rows_created: rowsCreated,
    });
  } catch (err) {
    failRun(err);
    throw err;
  } finally {
    try {
      await insertAgentPass({
        agent_type: agentType,
        product_id: product.product_id,
        tool_calls: toolCalls,
        rows_created: rowsCreated,
      });
    } catch (err) {
      console.error(`[agent:${agentType}] ${runId} failed to persist agent_pass`, err);
      send({ type: "audit_error", run_id: runId, message: errorMessage(err) });
    }
  }

  return {
    runId,
    status,
    releasesInserted,
    summariesInserted,
    feedbackInserted,
    rowsCreated,
    toolFailures,
    durationMs: Date.now() - startedAt,
  };
}
