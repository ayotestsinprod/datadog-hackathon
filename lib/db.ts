import { clickhouse } from "./clickhouse";
import { randomUUID } from "crypto";

// --- Types ---

export interface Product {
  id: string;
  name: string;
  description: string;
  links: string[];
  favicon_url: string;
  created_at?: string;
}

export interface Release {
  id: string;
  product_id: string;
  name: string;
  date: string; // YYYY-MM-DD
  summary: string;
}

export interface ReleaseFeedback {
  id: string;
  product_id: string;
  release_id?: string | null;
  date: string; // YYYY-MM-DD
  source_url: string;
  source_type: "twitter" | "youtube" | "blog" | "review_site" | "other";
  score: number; // 1-10
  raw_text: string;
}

export interface AgentPass {
  id: string;
  agent_type: string;
  product_id: string;
  tool_calls: string[];
  rows_created: string[];
}

export interface ActionOutput {
  id: string;
  product_id: string;
  trigger_type: string;
  summary: string;
  published_at?: string | null;
}

// --- Inserts ---

export async function insertProduct(p: Omit<Product, "id">): Promise<string> {
  const id = randomUUID();
  await clickhouse.insert({
    table: "products",
    values: [{ ...p, id }],
    format: "JSONEachRow",
  });
  return id;
}

export async function deleteProduct(id: string): Promise<void> {
  const tables = ["products", "releases", "release_feedback", "agent_passes", "action_outputs"];
  const col = (t: string) => t === "products" ? "id" : "product_id";
  await Promise.all(
    tables.map((table) =>
      clickhouse.command({
        query: `ALTER TABLE ${table} DELETE WHERE ${col(table)} = {id:String}`,
        query_params: { id },
      })
    )
  );
}

export async function updateProduct(id: string, fields: { description?: string; links?: string[]; favicon_url?: string }): Promise<void> {
  const setParts: string[] = [];
  if (fields.description !== undefined) setParts.push(`description = {description:String}`);
  if (fields.links !== undefined) setParts.push(`links = {links:Array(String)}`);
  if (fields.favicon_url !== undefined) setParts.push(`favicon_url = {favicon_url:String}`);
  if (setParts.length === 0) return;
  await clickhouse.command({
    query: `ALTER TABLE products UPDATE ${setParts.join(", ")} WHERE id = {id:String}`,
    query_params: { id, ...fields },
  });
}

export async function insertRelease(r: Omit<Release, "id">): Promise<string> {
  const id = randomUUID();
  await clickhouse.insert({
    table: "releases",
    values: [{ ...r, id }],
    format: "JSONEachRow",
  });
  return id;
}

export async function insertFeedback(f: Omit<ReleaseFeedback, "id">): Promise<string> {
  const id = randomUUID();
  await clickhouse.insert({
    table: "release_feedback",
    values: [{ ...f, id, release_id: f.release_id ?? null }],
    format: "JSONEachRow",
  });
  return id;
}

export async function insertAgentPass(p: Omit<AgentPass, "id">): Promise<string> {
  const id = randomUUID();
  await clickhouse.insert({
    table: "agent_passes",
    values: [{ ...p, id }],
    format: "JSONEachRow",
  });
  return id;
}

export async function insertActionOutput(o: Omit<ActionOutput, "id">): Promise<string> {
  const id = randomUUID();
  await clickhouse.insert({
    table: "action_outputs",
    values: [{ ...o, id, published_at: o.published_at ?? null }],
    format: "JSONEachRow",
  });
  return id;
}

// --- Queries ---

export async function getProducts(): Promise<Product[]> {
  const result = await clickhouse.query({
    query: "SELECT * FROM products ORDER BY created_at DESC",
    format: "JSONEachRow",
  });
  return result.json<Product>();
}

export async function searchProductsByName(name: string): Promise<Product[]> {
  const result = await clickhouse.query({
    query: "SELECT * FROM products WHERE lower(name) = lower({name:String}) LIMIT 5",
    query_params: { name },
    format: "JSONEachRow",
  });
  return result.json<Product>();
}

export async function getFeedbackForProduct(product_id: string): Promise<ReleaseFeedback[]> {
  const result = await clickhouse.query({
    query: "SELECT * FROM release_feedback WHERE product_id = {product_id:String} ORDER BY date DESC",
    query_params: { product_id },
    format: "JSONEachRow",
  });
  return result.json<ReleaseFeedback>();
}

export async function getReleasesForProduct(product_id: string): Promise<Release[]> {
  const result = await clickhouse.query({
    query: "SELECT * FROM releases WHERE product_id = {product_id:String} ORDER BY date DESC",
    query_params: { product_id },
    format: "JSONEachRow",
  });
  return result.json<Release>();
}
