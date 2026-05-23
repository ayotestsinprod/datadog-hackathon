import type { NextApiRequest, NextApiResponse } from "next";
import { getProducts, insertProduct } from "../../lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    const products = await getProducts();
    return res.status(200).json(products);
  }
  if (req.method === "POST") {
    const { name, description = "", links = [] } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });
    const id = await insertProduct({ name, description, links });
    return res.status(201).json({ id });
  }
  res.status(405).end();
}
