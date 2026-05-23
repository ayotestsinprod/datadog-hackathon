import type { NextApiRequest, NextApiResponse } from "next";
import { clickhouse } from "../../lib/clickhouse";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const result = await clickhouse.query({ query: "SELECT 1", format: "JSON" });
  const data = await result.json();
  res.status(200).json(data);
}
