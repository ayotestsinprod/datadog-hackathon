import Anthropic from "@anthropic-ai/sdk";
import { insertProduct, insertRelease, updateProduct, searchProductsByName, getReleasesForProduct } from "../../../lib/db";

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
];

// Scoped tool sets per agent
export const initializeTools = allTools.filter((t) =>
  ["update_product", "fetch_url"].includes(t.name)
);

export const refreshTools = allTools.filter((t) =>
  ["search_releases", "fetch_url", "insert_release"].includes(t.name)
);

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

  return JSON.stringify({ error: `Unknown tool: ${toolName}` });
}
