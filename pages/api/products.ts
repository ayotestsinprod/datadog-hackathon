import type { NextApiRequest, NextApiResponse } from "next";
import { getProducts } from "../../lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();
  const products = await getProducts();
  res.status(200).json(products);
}
