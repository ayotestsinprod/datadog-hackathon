import { createClient } from "@clickhouse/client";

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

const tables = [
  `
  CREATE TABLE IF NOT EXISTS products (
    id        String,
    name      String,
    description String,
    links     Array(String),
    favicon_url String DEFAULT '',
    created_at DateTime DEFAULT now()
  ) ENGINE = MergeTree()
  ORDER BY id
  `,
  `
  CREATE TABLE IF NOT EXISTS releases (
    id         String,
    product_id String,
    name       String,
    date       Date,
    summary    String,
    created_at DateTime DEFAULT now()
  ) ENGINE = MergeTree()
  ORDER BY (product_id, date)
  `,
  `
  CREATE TABLE IF NOT EXISTS release_feedback (
    id          String,
    product_id  String,
    release_id  Nullable(String),
    date        Date,
    source_url  String,
    source_type Enum('twitter', 'youtube', 'blog', 'review_site', 'other'),
    score       UInt8,
    raw_text    String,
    created_at  DateTime DEFAULT now()
  ) ENGINE = MergeTree()
  ORDER BY (product_id, date)
  `,
  `
  CREATE TABLE IF NOT EXISTS feedback_summaries (
    id         String,
    product_id String,
    start_date Date,
    end_date   Date,
    summary    String,
    highlights Array(String),
    created_at DateTime DEFAULT now()
  ) ENGINE = MergeTree()
  ORDER BY (product_id, start_date)
  `,
  `
  CREATE TABLE IF NOT EXISTS agent_passes (
    id           String,
    agent_type   String,
    product_id   String,
    tool_calls   Array(String),
    rows_created Array(String),
    created_at   DateTime DEFAULT now()
  ) ENGINE = MergeTree()
  ORDER BY created_at
  `,
  `
  CREATE TABLE IF NOT EXISTS action_outputs (
    id           String,
    product_id   String,
    trigger_type String,
    summary      String,
    published_at Nullable(DateTime),
    created_at   DateTime DEFAULT now()
  ) ENGINE = MergeTree()
  ORDER BY created_at
  `,
];

const alterations = [
  {
    name: "products.favicon_url",
    query: "ALTER TABLE products ADD COLUMN IF NOT EXISTS favicon_url String DEFAULT ''",
  },
];

async function migrate() {
  for (const ddl of tables) {
    await clickhouse.command({ query: ddl });
    const name = ddl.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1];
    console.log(`✓ ${name}`);
  }
  for (const alteration of alterations) {
    await clickhouse.command({ query: alteration.query });
    console.log(`✓ ${alteration.name}`);
  }
  console.log("Migration complete.");
  await clickhouse.close();
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
