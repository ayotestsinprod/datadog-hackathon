import Anthropic from "@anthropic-ai/sdk";
import { insertProduct, insertRelease, searchProductsByName, getReleasesForProduct, updateProduct, getFeedbackSummariesForProduct, getFeedbackInRange, insertFeedbackSummary } from "./db";
import { nimbleSearch, type SearchDepth } from "./nimble";

type FeedbackSourceType = "twitter" | "youtube" | "blog" | "review_site" | "other";

const allTools: Anthropic.Tool[] = [
  {
    name: "search_products",
    description: "Search for an existing product by name. Returns matching products with their IDs.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "insert_product",
    description: "Create a new product record. Only call this if search_products returned no match.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        links: { type: "array", items: { type: "string" } },
      },
      required: ["name", "description", "links"],
    },
  },
  {
    name: "update_product",
    description: "Update description, links, and/or favicon_url for a product.",
    input_schema: {
      type: "object" as const,
      properties: {
        product_id: { type: "string" },
        description: { type: "string", description: "Concise 1-2 sentence description of the product" },
        links: { type: "array", items: { type: "string" }, description: "Official URLs: homepage, changelog, GitHub releases, etc." },
        favicon_url: { type: "string", description: "Use https://www.google.com/s2/favicons?domain={main_domain}&sz=64" },
      },
      required: ["product_id"],
    },
  },
  {
    name: "search_releases",
    description: "Get all existing releases for a product. Use before inserting to avoid duplicates.",
    input_schema: {
      type: "object" as const,
      properties: {
        product_id: { type: "string" },
      },
      required: ["product_id"],
    },
  },
  {
    name: "fetch_url",
    description: "Fetch the text content of a URL — changelogs, GitHub releases, homepages, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: { type: "string" },
      },
      required: ["url"],
    },
  },
  {
    name: "nimble_search",
    description: "Search the live web via Nimble for up-to-date information about a product, model, or topic. Returns ranked results with title, description, URL, and (for 'fast' depth) ~2K chars of page content. Use this to discover authoritative release pages, official changelogs, and recent news. Prefer 'fast' when you need content snippets; 'lite' when you just need a list of URLs.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query, e.g. 'Claude Opus 4.7 release notes'" },
        max_results: { type: "integer", description: "Number of results to return (1-20). Default 5." },
        search_depth: { type: "string", enum: ["lite", "fast"], description: "'lite' = titles/descriptions only; 'fast' = adds page content. Default 'fast'." },
        time_range: { type: "string", enum: ["hour", "day", "week", "month", "year"], description: "Restrict results by recency." },
        include_domains: { type: "array", items: { type: "string" }, description: "Whitelist of domains." },
        exclude_domains: { type: "array", items: { type: "string" }, description: "Blacklist of domains." },
      },
      required: ["query"],
    },
  },
  {
    name: "insert_release",
    description: "Insert a new release. Only call for releases not already in the database.",
    input_schema: {
      type: "object" as const,
      properties: {
        product_id: { type: "string" },
        name: { type: "string", description: "Release name or version e.g. 'v3.0', 'Claude 3 Opus'" },
        date: { type: "string", description: "YYYY-MM-DD" },
        summary: { type: "string", description: "1-2 sentence summary of what changed" },
      },
      required: ["product_id", "name", "date", "summary"],
    },
  },
  {
    name: "search_feedback",
    description: "Get all existing feedback rows for a product. Use before inserting to avoid duplicating the same source_url.",
    input_schema: {
      type: "object" as const,
      properties: {
        product_id: { type: "string" },
      },
      required: ["product_id"],
    },
  },
  {
    name: "insert_feedback",
    description: "Insert one feedback row (a single post/comment/review about the product). Classify sentiment with a 1-10 score. Only call for source_urls not already in the database.",
    input_schema: {
      type: "object" as const,
      properties: {
        product_id: { type: "string" },
        source_url: { type: "string", description: "Canonical URL of the post/thread/video/review" },
        source_type: {
          type: "string",
          enum: ["twitter", "youtube", "blog", "review_site", "other"],
          description: "twitter = X/Twitter; youtube = YouTube; blog = vendor/personal blog post; review_site = G2/Product Hunt/Trustpilot/etc; other = Reddit, HN, forums, anything else",
        },
        score: { type: "integer", minimum: 1, maximum: 10, description: "Sentiment 1-10. 1-3 = negative (complaints, churn, frustration). 4-5 = neutral/mixed. 6-7 = mildly positive. 8-10 = strongly positive (praise, recommendations)." },
        date: { type: "string", description: "When the feedback was posted (YYYY-MM-DD). If unknown, use today." },
        raw_text: { type: "string", description: "The actual feedback text — quote, excerpt, or summary of what the author said about the product. Keep under 500 chars." },
        release_id: { type: "string", description: "Optional. Set if this feedback is clearly about a specific release; otherwise omit." },
      },
      required: ["product_id", "source_url", "source_type", "score", "date", "raw_text"],
    },
  },
];

export const summarizeToolDefs: Anthropic.Tool[] = [
  {
    name: "get_existing_summaries",
    description: "Get all existing feedback summaries for a product. Returns their date ranges so you know what time periods are already covered.",
    input_schema: {
      type: "object" as const,
      properties: { product_id: { type: "string" } },
      required: ["product_id"],
    },
  },
  {
    name: "get_feedback_in_range",
    description: "Get feedback items for a product within a date range (YYYY-MM-DD). Returns up to 200 items with date, score, source_type, and raw_text.",
    input_schema: {
      type: "object" as const,
      properties: {
        product_id: { type: "string" },
        start_date: { type: "string", description: "YYYY-MM-DD" },
        end_date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["product_id", "start_date", "end_date"],
    },
  },
  {
    name: "insert_feedback_summary",
    description: "Insert a qualitative summary for a time span of feedback. Include 5–10 representative highlight quotes.",
    input_schema: {
      type: "object" as const,
      properties: {
        product_id: { type: "string" },
        start_date: { type: "string", description: "YYYY-MM-DD" },
        end_date: { type: "string", description: "YYYY-MM-DD" },
        summary: { type: "string", description: "2-4 sentence qualitative narrative of what users felt during this period and why." },
        highlights: {
          type: "array",
          description: "5–10 feedback quotes that best represent the overall sentiment of this period.",
          items: {
            type: "object",
            properties: {
              raw_text: { type: "string" },
              source_type: { type: "string" },
              score: { type: "number" },
              date: { type: "string" },
            },
            required: ["raw_text", "source_type", "score", "date"],
          },
        },
      },
      required: ["product_id", "start_date", "end_date", "summary", "highlights"],
    },
  },
];

/** Full tool set for ingest-style agents */
export const tools = allTools;

// Scoped tool sets per agent
export const initializeTools = allTools.filter((t) =>
  ["update_product", "fetch_url", "nimble_search"].includes(t.name)
);

export const refreshTools = allTools.filter((t) =>
  ["search_releases", "fetch_url", "nimble_search", "insert_release"].includes(t.name)
);

export const summarizeTools = summarizeToolDefs;

export async function executeTool(
  toolName: string,
  input: Record<string, unknown>
): Promise<string> {
  if (toolName === "search_products") {
    const products = await searchProductsByName(input.name as string);
    return JSON.stringify(products);
  }

  if (toolName === "insert_product") {
    const id = await insertProduct({
      name: input.name as string,
      description: input.description as string,
      links: (input.links as string[]) ?? [],
      favicon_url: "",
    });
    return JSON.stringify({ id });
  }

  if (toolName === "update_product") {
    await updateProduct(input.product_id as string, {
      description: input.description as string | undefined,
      links: input.links as string[] | undefined,
      favicon_url: input.favicon_url as string | undefined,
    });
    return JSON.stringify({ ok: true });
  }

  if (toolName === "search_releases") {
    const releases = await getReleasesForProduct(input.product_id as string);
    return JSON.stringify(releases);
  }

  if (toolName === "fetch_url") {
    try {
      const res = await fetch(input.url as string, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; PulseBot/1.0)" },
      });
      if (!res.ok) {
        const body = await res.text();
        return JSON.stringify({
          error: `Failed to fetch ${input.url}: HTTP ${res.status} ${res.statusText}`,
          status: res.status,
          body_preview: body.slice(0, 500),
        });
      }
      const html = await res.text();
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 6000);
      return JSON.stringify({ url: input.url, content: text });
    } catch (err) {
      return JSON.stringify({ error: `Failed to fetch ${input.url}: ${(err as Error).message}` });
    }
  }

  if (toolName === "insert_release") {
    const id = await insertRelease({
      product_id: input.product_id as string,
      name: input.name as string,
      date: input.date as string,
      summary: input.summary as string,
    });
    return JSON.stringify({ id });
  }

  if (toolName === "search_feedback") {
    const feedback = await getFeedbackForProduct(input.product_id as string);
    return JSON.stringify(feedback.map((f) => ({ id: f.id, source_url: f.source_url, source_type: f.source_type, score: f.score, date: f.date })));
  }

  if (toolName === "insert_feedback") {
    const id = await insertFeedback({
      product_id: input.product_id as string,
      release_id: (input.release_id as string | undefined) ?? null,
      date: input.date as string,
      source_url: input.source_url as string,
      source_type: input.source_type as FeedbackSourceType,
      score: input.score as number,
      raw_text: input.raw_text as string,
    });
    return JSON.stringify({ id });
  }

  if (toolName === "nimble_search") {
    try {
      const result = await nimbleSearch({
        query: input.query as string,
        max_results: (input.max_results as number) ?? 5,
        search_depth: ((input.search_depth as SearchDepth) ?? "fast"),
        time_range: input.time_range as "hour" | "day" | "week" | "month" | "year" | undefined,
        include_domains: input.include_domains as string[] | undefined,
        exclude_domains: input.exclude_domains as string[] | undefined,
      });
      return JSON.stringify({
        total_results: result.total_results,
        results: result.results.map((r) => ({
          title: r.title,
          description: r.description,
          url: r.url,
          content: r.content,
        })),
      });
    } catch (err) {
      return JSON.stringify({ error: (err as Error).message });
    }
  }

  if (toolName === "get_existing_summaries") {
    const summaries = await getFeedbackSummariesForProduct(input.product_id as string);
    return JSON.stringify(summaries.map(s => ({ id: s.id, start_date: s.start_date, end_date: s.end_date })));
  }

  if (toolName === "get_feedback_in_range") {
    const fb = await getFeedbackInRange(input.product_id as string, input.start_date as string, input.end_date as string);
    return JSON.stringify(fb.map(f => ({
      id: f.id,
      date: f.date,
      score: f.score,
      source_type: f.source_type,
      raw_text: (f.raw_text ?? "").slice(0, 250),
    })));
  }

  if (toolName === "insert_feedback_summary") {
    const highlights = (input.highlights as Array<{ raw_text: string; source_type: string; score: number; date: string }>)
      .map(h => JSON.stringify(h));
    const id = await insertFeedbackSummary({
      product_id: input.product_id as string,
      start_date: input.start_date as string,
      end_date: input.end_date as string,
      summary: input.summary as string,
      highlights,
    });
    return JSON.stringify({ id });
  }

  return JSON.stringify({ error: `Unknown tool: ${toolName}` });
}
