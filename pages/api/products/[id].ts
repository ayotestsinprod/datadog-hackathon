import type { NextApiRequest, NextApiResponse } from "next";
import { deleteProduct } from "../../../lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "DELETE") return res.status(405).end();
  const { id } = req.query;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "id required" });
  await deleteProduct(id);
  res.status(200).json({ ok: true });
}
