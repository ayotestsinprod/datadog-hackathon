const NIMBLE_SEARCH_URL = "https://sdk.nimbleway.com/v1/search";

export type SearchFocus =
  | "general"
  | "news"
  | "location"
  | "coding"
  | "geo"
  | "shopping"
  | "social"
  | "academic";

export type SearchDepth = "lite" | "fast" | "deep";

export interface NimbleSearchInput {
  query: string;
  max_results?: number;
  focus?: SearchFocus | SearchFocus[];
  search_depth?: SearchDepth;
  include_answer?: boolean;
  include_domains?: string[];
  exclude_domains?: string[];
  start_date?: string;
  end_date?: string;
  time_range?: "hour" | "day" | "week" | "month" | "year";
  output_format?: "plain_text" | "markdown" | "simplified_html";
}

export interface NimbleSearchResult {
  title: string;
  description: string;
  url: string;
  content?: string;
  extra_fields?: Record<string, unknown> | null;
}

export interface NimbleSearchResponse {
  answer: string | null;
  total_results: number;
  results: NimbleSearchResult[];
  request_id: string;
}

export async function nimbleSearch(input: NimbleSearchInput): Promise<NimbleSearchResponse> {
  const apiKey = process.env.NIMBLE_API_KEY;
  if (!apiKey) throw new Error("NIMBLE_API_KEY is not set");

  // This project is on a Nimble tier that only allows lite search; other depths return 403.
  const body = { ...input, search_depth: "lite" as const };

  const res = await fetch(NIMBLE_SEARCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Nimble search failed (${res.status}): ${body.slice(0, 500)}`);
  }

  return (await res.json()) as NimbleSearchResponse;
}
