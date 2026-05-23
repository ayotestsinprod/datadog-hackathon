import type { NextApiRequest, NextApiResponse } from "next";
import { getFeedbackForProduct } from "../../lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();
  const { product_id } = req.query;
  if (!product_id || typeof product_id !== "string") return res.status(400).json({ error: "product_id required" });
  const feedback = await getFeedbackForProduct(product_id);
  res.status(200).json(feedback);
}
