import Anthropic from "@anthropic-ai/sdk";
import { insertProduct, insertRelease, searchProductsByName, getReleasesForProduct } from "../../../lib/db";

export const tools: Anthropic.Tool[] = [
  {
    name: "search_products",
    description: "Search for an existing product by name. Returns matching products with their IDs.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "The product name to search for" },
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
    name: "search_releases",
    description: "Get all existing releases for a product. Use this before inserting to avoid duplicates.",
    input_schema: {
      type: "object" as const,
      properties: {
        product_id: { type: "string", description: "The product ID to fetch releases for" },
      },
      required: ["product_id"],
    },
  },
  {
    name: "insert_release",
    description: "Insert a new release for a product. Only call this for releases not already in the database.",
    input_schema: {
      type: "object" as const,
      properties: {
        product_id: { type: "string" },
        name: { type: "string", description: "Release name or version e.g. 'v3.0', 'Claude 3 Opus'" },
        date: { type: "string", description: "Release date in YYYY-MM-DD format" },
        summary: { type: "string", description: "1-2 sentence summary of what changed" },
      },
      required: ["product_id", "name", "date", "summary"],
    },
  },
];

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
    });
    return JSON.stringify({ id });
  }

  if (toolName === "search_releases") {
    const releases = await getReleasesForProduct(input.product_id as string);
    return JSON.stringify(releases);
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
