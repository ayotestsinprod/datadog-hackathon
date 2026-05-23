# Pulse — Product Impression Tracker

A tool that monitors public sentiment around technical products over time, correlating feedback with release history on a scrubbable timeline.

---

## What It Does

1. **You provide**: a product name, short description, and known entry-point URLs (e.g. a changelog page, Twitter handle, product site).
2. **Ingestion Agent** (Nimbly-powered): scrapes public releases and feedback from Twitter/X, YouTube, tech review sites, and blogs. Each piece of feedback is scored 1–10 (1 = very negative, 10 = very positive).
3. **Analysis Agent**: aggregates feedback into an Impression Summary, detects significant drops in sentiment, and publishes a summary post to cited.md via Senso.
4. **Timeline UI**: a scrubbable view showing release events and impression score over time side by side.

---

## Architecture

```
User Input
    │
    ▼
Ingestion Agent (Nimbly)
    ├─ Scrapes: changelogs, Twitter/X, YouTube, review sites
    ├─ Writes: releases, release_feedback (with 1–10 score)
    └─ Logs: agent_passes

Analysis Agent
    ├─ Reads: release_feedback since last pass
    ├─ Produces: impression summary (positive/negative themes)
    ├─ Detects: significant score drops
    └─ Writes: action_outputs → triggers cited.md post via Senso

Frontend (Vercel / TypeScript)
    ├─ Product setup form
    ├─ Feedback feed with scores and source links
    └─ Scrubbable timeline: releases + impression inflection points
```

---

## Data Model (ClickHouse)

| Table | Fields |
|---|---|
| `products` | `id`, `name`, `description`, `entry_links[]`, `created_at` |
| `releases` | `id`, `product_id`, `name`, `date`, `summary` |
| `release_feedback` | `id`, `product_id`, `release_id?`, `date`, `source_url`, `source_type`, `score` (1–10), `raw_text` |
| `agent_passes` | `id`, `agent_type`, `product_id`, `tool_calls[]`, `rows_created[]`, `created_at` |
| `action_outputs` | `id`, `product_id`, `trigger_type` (impression_drop), `summary`, `published_at` |

**Notes:**
- `release_feedback.release_id` is nullable — feedback isn't always tied to a specific release.
- `source_type` enum: `twitter`, `youtube`, `blog`, `review_site`, `other`.
- `agent_passes` is an audit log for debugging agent effectiveness (tool calls made, what was written).
- `action_outputs` drives both the cited.md post and any future notification hooks.

---

## Key Flows

### Flow 1 — Ingest
1. User creates a product via the UI.
2. **Initialize** agent enriches metadata (links, description) using `nimble_search` and `fetch_url`.
3. **Refresh** agent discovers releases via Nimble and writes `releases`.
4. **Feedback** agent searches the web via Nimble (currently **Reddit + X/Twitter only**, rolling **last 3 months** in UTC), scores sentiment, and writes rows to `release_feedback`.
5. **Summarize** agent reads `release_feedback`, merges gaps with release dates, and writes `feedback_summaries`.
6. Each pass is logged to `agent_passes`.

On an existing product, use the ··· menu: **Refresh releases**, **Fetch public feedback**, and **Refresh analysis** to run those steps independently.

### Flow 2 — Analyze
1. Analysis Agent reads new `release_feedback` rows since its last pass.
2. Generates an Impression Summary: key positive themes, key negative themes, overall score delta.
3. If the rolling score drops meaningfully (e.g. >2 points over a window), writes a row to `action_outputs` and publishes a post to cited.md via Senso.

### Flow 3 — Timeline
1. Frontend queries `releases` and `action_outputs` for a product, ordered by date.
2. Renders a scrubbable timeline with two layers: release markers and impression-change markers.
3. Clicking a marker shows the source feedback items and the published summary.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Web scraping | Nimble Search (lite depth; use `fetch_url` for full pages) |
| Data storage | ClickHouse |
| Publishing / notifications | Senso / cited.md |
| Frontend | TypeScript, Next.js |
| Hosting | Vercel |

---

## Open Questions

- Scoring model: LLM-based 1–10 per feedback item, or a two-pass (classify → score)?
- Impression drop threshold: fixed delta or rolling average window?
- Scheduling: manual trigger only for MVP, or cron-based re-scrape?
- Auth: single-tenant for hackathon or multi-product dashboard from day one?
