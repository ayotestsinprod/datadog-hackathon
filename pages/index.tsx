import { useState, useEffect, useRef } from "react";

const TIMELINE_LEFT_PAD = 700;

interface Product {
  id: string;
  name: string;
  description: string;
  links: string[];
  favicon_url: string;
}

interface Release {
  id: string;
  product_id: string;
  name: string;
  date: string;
  summary: string;
}

interface Feedback {
  id: string;
  product_id: string;
  release_id: string | null;
  date: string;
  score: number;
  source_type: string;
  raw_text: string;
}

interface FeedbackSummary {
  id: string;
  product_id: string;
  start_date: string;
  end_date: string;
  summary: string;
  highlights: string[];
}

const SOURCE_COLORS: Record<string, string> = {
  twitter: "#1d9bf0",
  youtube: "#ff4444",
  blog: "#f59e0b",
  review_site: "#8b5cf6",
  other: "#6b7280",
};

function SimplePie({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).filter(([, v]) => v > 0);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return null;
  const R = 22, cx = 24, cy = 24;
  let angle = -Math.PI / 2;
  return (
    <svg width={48} height={48} className="shrink-0">
      {entries.map(([type, count]) => {
        const sweep = (count / total) * 2 * Math.PI;
        const x1 = cx + R * Math.cos(angle);
        const y1 = cy + R * Math.sin(angle);
        angle += sweep;
        const x2 = cx + R * Math.cos(angle);
        const y2 = cy + R * Math.sin(angle);
        const large = sweep > Math.PI ? 1 : 0;
        return <path key={type} d={`M ${cx} ${cy} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`}
          fill={SOURCE_COLORS[type] ?? "#6b7280"} />;
      })}
    </svg>
  );
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [newDesc, setNewDesc] = useState("");
  const [newLinks, setNewLinks] = useState("");
  const [releases, setReleases] = useState<Release[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [summaries, setSummaries] = useState<FeedbackSummary[]>([]);
  const [expandedSummaryId, setExpandedSummaryId] = useState<string | null>(null);
  const [timelineScrollLeft, setTimelineScrollLeft] = useState(0);
  const [loadingReleases, setLoadingReleases] = useState(false);
  const [loadingIngest, setLoadingIngest] = useState(false);
  const [streamLog, setStreamLog] = useState<string[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [showMenu, setShowMenu] = useState(false);
  const [everLoaded, setEverLoaded] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const refreshButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/products").then((r) => r.json()).then(setProducts);
  }, []);

  useEffect(() => {
    if (selectedProduct) refreshButtonRef.current?.focus();
  }, [selectedProduct]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (scrollRef.current && releases.length > 0) {
      const el = scrollRef.current;
      const ITEM_W = 140;
      const sorted = [...releases].reverse();
      const lastCx = TIMELINE_LEFT_PAD + 20 + (sorted.length - 1) * ITEM_W + ITEM_W / 2;
      const newScrollLeft = Math.max(0, lastCx - el.clientWidth / 2);
      el.scrollLeft = newScrollLeft;
      setTimelineScrollLeft(newScrollLeft);
    }
  }, [releases]);


  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase())
  );
  const exactMatch = products.some(
    (p) => p.name.toLowerCase() === query.toLowerCase()
  );

  async function loadReleases(productId: string) {
    setLoadingReleases(true);
    const [relRes, fbRes, sumRes] = await Promise.all([
      fetch(`/api/releases?product_id=${productId}`),
      fetch(`/api/feedback?product_id=${productId}`),
      fetch(`/api/summaries?product_id=${productId}`),
    ]);
    setReleases(await relRes.json());
    setFeedback(await fbRes.json());
    setSummaries(await sumRes.json());
    setLoadingReleases(false);
  }

  async function selectProduct(p: Product) {
    setEverLoaded(true);
    setSelectedProduct(p);
    setIsNew(false);
    setQuery(p.name);
    setShowDropdown(false);
    await loadReleases(p.id);

    // Backfill missing metadata for older products
    if (p.id !== "9a6188ba-eda0-45e0-a6f0-507fecbfed0a" && (!p.description || !p.favicon_url || p.links.length === 0)) {
      setLoadingIngest(true);
      setStreamLog([]);
      await streamAgent("/api/agent/initialize", { product_id: p.id, name: p.name, description: p.description, links: p.links });
      const updated: Product[] = await fetch("/api/products").then((r) => r.json());
      setProducts(updated);
      const fresh = updated.find((x) => x.id === p.id);
      if (fresh) setSelectedProduct(fresh);
      setLoadingIngest(false);
    }
  }

  async function streamAgent(endpoint: string, body: object): Promise<void> {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const event = JSON.parse(line.slice(6)) as Record<string, unknown>;
        if (event.type === "tool_call") setStreamLog(() => [`→ ${event.name}`]);
        if (event.type === "release_inserted") setStreamLog(() => [`✓ ${event.name}`]);
        if (event.type === "summary_inserted") setStreamLog(() => [`✓ summary ${event.start_date} → ${event.end_date}`]);
      }
    }
  }

  async function handleDelete() {
    if (!selectedProduct) return;
    setShowMenu(false);
    await fetch(`/api/products/${selectedProduct.id}`, { method: "DELETE" });
    setSelectedProduct(null);
    setReleases([]);
    setFeedback([]);
    setSummaries([]);
    setQuery("");
    const updated: Product[] = await fetch("/api/products").then((r) => r.json());
    setProducts(updated);
  }

  async function handleRefresh() {
    if (!selectedProduct) return;
    if (selectedProduct.id === "9a6188ba-eda0-45e0-a6f0-507fecbfed0a") { setShowMenu(false); return; }
    setShowMenu(false);
    setLoadingIngest(true);
    setStreamLog([]);
    const p = selectedProduct;
    await streamAgent("/api/agent/refresh", { product_id: p.id, name: p.name, description: p.description, links: p.links });
    await loadReleases(p.id);
    const updated: Product[] = await fetch("/api/products").then((r) => r.json());
    const fresh = updated.find((x) => x.id === p.id);
    if (fresh) { setSelectedProduct(fresh); setProducts(updated); }
    setLoadingIngest(false);
  }

  async function handleSummarize() {
    if (!selectedProduct) return;
    setShowMenu(false);
    setLoadingIngest(true);
    setStreamLog([]);
    const p = selectedProduct;
    await streamAgent("/api/agent/summarize", { product_id: p.id, name: p.name, releases });
    await loadReleases(p.id);
    setLoadingIngest(false);
  }

  async function handleCreate() {
    const links = newLinks.split("\n").map((l) => l.trim()).filter(Boolean);

    // Create product row immediately
    const createRes = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: query, description: newDesc, links }),
    });
    const { id: product_id } = await createRes.json();

    setEverLoaded(true);
    setSelectedProduct({ id: product_id, name: query, description: newDesc, links, favicon_url: "" });
    setIsNew(false);

    setLoadingIngest(true);
    setStreamLog([]);
    const agentBody = { product_id, name: query, description: newDesc, links };

    // Run agents sequentially: populate metadata, fetch releases, then summarize feedback
    await streamAgent("/api/agent/initialize", agentBody);
    await streamAgent("/api/agent/refresh", agentBody);
    await streamAgent("/api/agent/summarize", { product_id, name: query });

    // Re-fetch product to get populated description/links/favicon
    const updated: Product[] = await fetch("/api/products").then((r) => r.json());
    setProducts(updated);
    const fresh = updated.find((p) => p.id === product_id);
    if (fresh) setSelectedProduct(fresh);

    await loadReleases(product_id);
    setLoadingIngest(false);
  }

  const isIdle = !everLoaded && !selectedProduct && !isNew;

  // Scroll-based active release/summary detection
  // Read live from DOM so centerX always matches the visual center line position
  const ITEM_W_C = 140;
  const sortedForActive = releases.length > 0 ? [...releases].reverse() : [];
  const centerX = (scrollRef.current?.scrollLeft ?? timelineScrollLeft)
    + (scrollRef.current?.clientWidth ?? 0) / 2;
  let activeRelease: Release | null = null;
  let activeSummary: FeedbackSummary | null = null;
  if (sortedForActive.length > 0) {
    const firstCxC = TIMELINE_LEFT_PAD + 20 + ITEM_W_C / 2;
    const lastCxC = TIMELINE_LEFT_PAD + 20 + (sortedForActive.length - 1) * ITEM_W_C + ITEM_W_C / 2;
    const firstTsC = new Date(sortedForActive[0].date).getTime();
    const lastTsC = new Date(sortedForActive[sortedForActive.length - 1].date).getTime();
    const spanC = lastTsC - firstTsC || 1;
    let minDist = Infinity;
    sortedForActive.forEach((r, i) => {
      const rcx = TIMELINE_LEFT_PAD + 20 + i * ITEM_W_C + ITEM_W_C / 2;
      const dist = Math.abs(rcx - centerX);
      if (dist < minDist) { minDist = dist; activeRelease = r; }
    });
    const centerTs = firstTsC + ((centerX - firstCxC) / Math.max(lastCxC - firstCxC, 1)) * spanC;
    const clampedTs = Math.max(firstTsC, Math.min(lastTsC, centerTs));
    const centerDate = new Date(clampedTs).toISOString().slice(0, 10);
    activeSummary = summaries.find(s => s.start_date <= centerDate && s.end_date >= centerDate) ?? null;
  }

  // Shared combobox input props
  const inputProps = {
    value: query,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value);
      setShowDropdown(true);
      setHighlightedIndex(-1);
      setSelectedProduct(null);
      setReleases([]);
      setFeedback([]);
      setSummaries([]);
    },
    onFocus: () => setShowDropdown(true),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      const itemCount = filtered.length + (!exactMatch && query.trim() ? 1 : 0);
      if (e.key === "ArrowDown") { e.preventDefault(); setHighlightedIndex((i) => Math.min(i + 1, itemCount - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setHighlightedIndex((i) => Math.max(i - 1, 0)); }
      else if (e.key === "Enter") {
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < filtered.length) selectProduct(filtered[highlightedIndex]);
        else if (highlightedIndex === filtered.length && !exactMatch && query.trim()) { setIsNew(true); setShowDropdown(false); }
      } else if (e.key === "Escape") { setShowDropdown(false); }
    },
  };

  const Dropdown = () => showDropdown && query.length > 0 ? (
    <div className="absolute top-full mt-1 w-full bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-10 overflow-hidden">
      {filtered.map((p, i) => (
        <button key={p.id}
          className={`w-full text-left px-4 py-3 text-sm flex items-center gap-2 border-b border-gray-800 last:border-0 ${highlightedIndex === i ? "bg-gray-800" : "hover:bg-gray-800"}`}
          onMouseDown={() => selectProduct(p)} onMouseEnter={() => setHighlightedIndex(i)}>
          {p.favicon_url && <img src={p.favicon_url} alt="" className="w-3.5 h-3.5 rounded-sm shrink-0" />}
          {p.name}
        </button>
      ))}
      {!exactMatch && query.trim() && (
        <button
          className={`w-full text-left px-4 py-3 text-sm text-teal-400 ${highlightedIndex === filtered.length ? "bg-gray-800" : "hover:bg-gray-800"}`}
          onMouseDown={() => { setIsNew(true); setShowDropdown(false); }}
          onMouseEnter={() => setHighlightedIndex(filtered.length)}>
          + Add &quot;{query}&quot;
        </button>
      )}
    </div>
  ) : null;

  return (
    <main className="min-h-screen text-gray-100" style={{ background: "#030712" }}>

      {/* ── HERO (idle) ── */}
      {isIdle && (
        <div className="min-h-screen flex flex-col items-center justify-center px-6 pb-24"
          style={{ background: "radial-gradient(ellipse 70% 40% at 50% 0%, rgba(20,184,166,0.10) 0%, transparent 70%)" }}>

          {/* Brand */}
          <div className="animate-fade-in-up flex flex-col items-center mb-10">
            <div className="flex items-center gap-2 mb-6">
              <span className="w-2 h-2 rounded-full bg-teal-400 glow-pulse inline-block" />
              <span className="text-xs font-mono text-teal-400 tracking-[0.2em] uppercase">Pulse</span>
            </div>
            <h1 className="text-5xl font-bold text-center text-white mb-4 tracking-tight leading-tight">
              Track what the world<br />thinks of your product.
            </h1>
            <p className="text-gray-500 text-base text-center max-w-sm">
              Releases, public sentiment, and the moments they intersect — on one timeline.
            </p>
          </div>

          {/* Search */}
          <div className="animate-fade-in-up-delay w-full max-w-md relative" ref={dropdownRef}>
            <input {...inputProps}
              className="w-full bg-gray-900/80 border border-gray-700 rounded-xl px-5 py-4 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/40 placeholder-gray-600 shadow-lg"
              placeholder="Search or add a product…" />
            <Dropdown />
          </div>

        </div>
      )}

      {/* ── PRODUCT VIEW ── */}
      {!isIdle && (
        <>
          {/* Header + search + product card */}
          <div className="max-w-2xl mx-auto px-8 pt-8">

            {/* Compact header */}
            <div className="flex items-center gap-3 mb-8">
              <button
                className="text-gray-600 hover:text-teal-400 transition-colors text-sm"
                onClick={() => { setSelectedProduct(null); setIsNew(false); setQuery(""); setReleases([]); setFeedback([]); setSummaries([]); }}>
                ← back
              </button>
              <span className="text-xs font-mono text-teal-500 tracking-widest">Pulse</span>
            </div>

            {/* Combobox (compact) */}
            <div className="relative mb-6" ref={dropdownRef}>
              <input {...inputProps}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-teal-500"
                placeholder="Search or add a product…" />
              <Dropdown />
            </div>

            {/* New product form */}
            {isNew && (
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 mb-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-300">New product: {query}</h2>
                  <span className="text-xs text-gray-500">description and links are optional</span>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Description</label>
                  <textarea
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-teal-500 resize-none"
                    rows={2} value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="What is this product? (optional)" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Links (one per line)</label>
                  <textarea
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-teal-500 resize-none font-mono"
                    rows={2} value={newLinks} onChange={(e) => setNewLinks(e.target.value)}
                    placeholder="https://github.com/org/repo/releases (optional)" />
                </div>
                <button
                  className="bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium px-5 py-2 rounded-lg disabled:opacity-50 transition-colors"
                  onClick={handleCreate} disabled={loadingIngest}>
                  {loadingIngest ? "Fetching releases…" : "Fetch Releases"}
                </button>
              </div>
            )}

            {/* Selected product */}
            {selectedProduct && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {selectedProduct.favicon_url && (
                        <img src={selectedProduct.favicon_url} alt="" className="w-4 h-4 rounded-sm" />
                      )}
                      <h2 className="text-base font-semibold">{selectedProduct.name}</h2>
                    </div>
                    {selectedProduct.description && (
                      <p className="text-sm text-gray-400 mb-2">{selectedProduct.description}</p>
                    )}
                    {selectedProduct.links?.length > 0 && (
                      <div className="flex flex-col gap-1">
                        {selectedProduct.links.map((l, i) => (
                          <a key={i} href={l} target="_blank" rel="noreferrer"
                            className="text-xs text-teal-500 hover:text-teal-300 hover:underline truncate transition-colors">
                            {l}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Context menu */}
                  <div className="relative shrink-0" ref={menuRef}>
                    <button
                      ref={refreshButtonRef}
                      className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-gray-200 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-teal-500/40 transition-colors"
                      onClick={() => setShowMenu((v) => !v)} disabled={loadingIngest}>
                      <span className="text-lg leading-none tracking-widest">···</span>
                    </button>
                    {showMenu && (
                      <div className="absolute right-0 top-full mt-1 w-52 bg-gray-900 border border-gray-700 rounded-xl shadow-xl z-30 overflow-hidden">
                        <button className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-800 flex items-center gap-2" onClick={handleRefresh}>
                          <span>↻</span> Refresh releases
                        </button>
                        <button className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-800 flex items-center gap-2 border-t border-gray-800" onClick={handleSummarize}>
                          <span>✦</span> Refresh analysis
                        </button>
                        <button className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-gray-800 flex items-center gap-2 border-t border-gray-800" onClick={handleDelete}>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {loadingIngest && streamLog.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-800">
                    <p className="text-xs text-gray-500 font-mono animate-pulse">
                      {streamLog[streamLog.length - 1] ?? "…"}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Loading / empty states */}
            {(selectedProduct || loadingReleases) && (
              <div className="mb-4">
                {(loadingReleases || (loadingIngest && releases.length === 0)) && (
                  <p className="text-sm text-gray-600 animate-pulse">Loading…</p>
                )}
                {!loadingReleases && !loadingIngest && releases.length === 0 && (
                  <p className="text-sm text-gray-600">No releases yet — use ··· to refresh.</p>
                )}
              </div>
            )}
          </div>

          {/* Full-width timeline */}
          {selectedProduct && !loadingReleases && releases.length > 0 && (
            <div className="relative">
              {/* edge fades */}
              <div className="absolute left-0 top-0 bottom-0 w-24 z-10 pointer-events-none"
                style={{ background: "linear-gradient(to right, #030712 20%, transparent)" }} />
              <div className="absolute right-0 top-0 bottom-0 w-24 z-10 pointer-events-none"
                style={{ background: "linear-gradient(to left, #030712 20%, transparent)" }} />
              {/* legend — pinned top-right, above fades */}
              {feedback.length > 0 && (
                <div className="absolute top-3 right-32 z-20 flex flex-col gap-1.5 pointer-events-none bg-gray-900/90 border border-gray-800 rounded-lg px-3 py-2">
                  {[["#2dd4bf", "Positive"], ["#6b7280", "Neutral"], ["#f87171", "Negative"]].map(([color, label]) => (
                    <span key={label} className="flex items-center gap-1.5">
                      <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                      <span className="text-xs font-mono" style={{ color: "#6b7280" }}>{label}</span>
                    </span>
                  ))}
                </div>
              )}
              {/* Center indicator line */}
              <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: "50%", width: 2, transform: "translateX(-50%)", background: "rgba(45,212,191,0.45)", zIndex: 15 }} />
              <div ref={scrollRef} className="overflow-x-auto no-scrollbar" style={{ scrollbarWidth: "none", msOverflowStyle: "none" } as React.CSSProperties}
                onScroll={(e) => setTimelineScrollLeft(e.currentTarget.scrollLeft)}>
                {(() => {
                  const ITEM_W = 140;
                  const AXIS_Y = 170;
                  const GRAPH_TOP = 24;
                  const GRAPH_BOTTOM = AXIS_Y - 14;
                  const GRAPH_H = GRAPH_BOTTOM - GRAPH_TOP;
                  const sorted = [...releases].reverse(); // oldest → newest left → right
                  const LEFT_PAD = TIMELINE_LEFT_PAD;
                  const totalWidth = LEFT_PAD + sorted.length * ITEM_W + 60 + 800;
                  const firstCx = LEFT_PAD + 20 + ITEM_W / 2;
                  const lastCx = LEFT_PAD + 20 + (sorted.length - 1) * ITEM_W + ITEM_W / 2;
                  const firstRelTs = new Date(sorted[0].date).getTime();
                  const lastRelTs = new Date(sorted[sorted.length - 1].date).getTime();
                  const relSpan = lastRelTs - firstRelTs || 1;
                  const dateToX = (d: string) => firstCx + ((new Date(d).getTime() - firstRelTs) / relSpan) * (lastCx - firstCx);
                  const SPAN_Y = AXIS_Y + 52;
                  const SPAN_H = 10;

                  let graphEl: React.ReactNode = null;
                  if (feedback.length > 0 && sorted.length > 0) {
                    const buckets: Record<string, { pos: number; neu: number; neg: number }> = {};
                    for (const f of feedback) {
                      const month = f.date.slice(0, 7);
                      if (!buckets[month]) buckets[month] = { pos: 0, neu: 0, neg: 0 };
                      if (f.score >= 6) buckets[month].pos++;
                      else if (f.score >= 4) buckets[month].neu++;
                      else buckets[month].neg++;
                    }
                    const months = Object.keys(buckets).sort();
                    const mToX = (m: string) => dateToX(m + "-15");
                    const maxCount = Math.max(...months.map(m => Math.max(buckets[m].pos, buckets[m].neu, buckets[m].neg)), 1);
                    const toY = (n: number) => GRAPH_BOTTOM - (n / maxCount) * GRAPH_H;
                    const smooth = (pts: [number, number][]) => {
                      if (pts.length === 0) return "";
                      if (pts.length === 1) return `M ${pts[0][0]} ${pts[0][1]}`;
                      let d = `M ${pts[0][0]} ${pts[0][1]}`;
                      for (let i = 1; i < pts.length; i++) {
                        const cpx = (pts[i - 1][0] + pts[i][0]) / 2;
                        d += ` C ${cpx} ${pts[i - 1][1]}, ${cpx} ${pts[i][1]}, ${pts[i][0]} ${pts[i][1]}`;
                      }
                      return d;
                    };
                    const posPath = smooth(months.map(m => [mToX(m), toY(buckets[m].pos)]));
                    const neuPath = smooth(months.map(m => [mToX(m), toY(buckets[m].neu)]));
                    const negPath = smooth(months.map(m => [mToX(m), toY(buckets[m].neg)]));
                    graphEl = (
                      <svg style={{ position: "absolute", left: 0, top: 0, width: totalWidth, height: AXIS_Y, pointerEvents: "none" }}>
                        {[0.33, 0.66, 1].map(t => (
                          <line key={t} x1={0} x2={totalWidth} y1={toY(maxCount * t)} y2={toY(maxCount * t)} stroke="#1f2937" strokeWidth={1} />
                        ))}
                        <path d={negPath} fill="none" stroke="#f87171" strokeWidth={1.5} />
                        <path d={neuPath} fill="none" stroke="#6b7280" strokeWidth={1.5} />
                        <path d={posPath} fill="none" stroke="#2dd4bf" strokeWidth={1.5} />
                      </svg>
                    );
                  }

                  return (
                    <div className="relative" style={{ width: totalWidth, height: AXIS_Y + 90 }}>
                      {graphEl}
                      <div className="absolute bg-gray-800" style={{ top: AXIS_Y, left: firstCx - ITEM_W / 2, right: 20, height: 1 }} />
                      {sorted.map((r, i) => {
                        const cx = LEFT_PAD + 20 + i * ITEM_W + ITEM_W / 2;
                        const isActive = activeRelease?.id === r.id;
                        return (
                          <div key={r.id} className="absolute cursor-default"
                            style={{ left: cx - ITEM_W / 2, top: 0, width: ITEM_W, height: AXIS_Y + 50 }}>
                            <div className="absolute bg-gray-700" style={{ left: "50%", top: AXIS_Y - 10, width: 1, height: 11 }} />
                            <div className={`absolute rounded-full border-2 border-[#030712] transition-colors ${isActive ? "bg-teal-400" : "bg-teal-600"}`}
                              style={{ left: "50%", top: AXIS_Y - 6, transform: "translateX(-50%)", width: 14, height: 14 }} />
                            <div className="absolute text-center" style={{ top: AXIS_Y + 12, left: 0, right: 0 }}>
                              <p className="text-xs font-medium text-gray-400 truncate px-2">{r.name}</p>
                              <p className="text-xs text-gray-700 mt-0.5">{r.date}</p>
                            </div>
                          </div>
                        );
                      })}
                      {/* Summary spans */}
                      {summaries.map(s => {
                        const x1 = Math.max(firstCx - ITEM_W / 2, dateToX(s.start_date));
                        const x2 = Math.min(lastCx + ITEM_W / 2, dateToX(s.end_date));
                        if (x2 - x1 < 4) return null;
                        const isHov = activeSummary?.id === s.id;
                        const color = isHov ? "#2dd4bf" : "#0f766e";
                        return (
                          <div key={s.id} className="absolute"
                            style={{ left: x1, top: SPAN_Y - 4, width: x2 - x1, height: SPAN_H + 8, zIndex: 5 }}>
                            <div className="absolute" style={{
                              left: 0, top: 4, right: 0, height: SPAN_H,
                              borderTop: `1px solid ${color}`,
                              borderBottom: `1px solid ${color}`,
                              borderLeft: `2px solid ${color}`,
                              borderRight: `2px solid ${color}`,
                              borderRadius: 2,
                              background: isHov ? "rgba(45,212,191,0.08)" : "rgba(15,118,110,0.06)",
                            }} />
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Info panel — always visible when product loaded */}
          {selectedProduct && !loadingReleases && releases.length > 0 && (
            <div className="max-w-4xl mx-auto px-8 pt-6 pb-16">
              <div className="grid grid-cols-5 gap-8">
                {/* Left: Release */}
                <div className="col-span-2">
                  <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">Release</p>
                  {activeRelease ? (
                    <div>
                      <p className="text-sm font-semibold text-white mb-0.5">{activeRelease.name}</p>
                      <p className="text-xs text-teal-500 mb-1.5">{activeRelease.date}</p>
                      <p className="text-sm text-gray-400 leading-relaxed">{activeRelease.summary}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-600">—</p>
                  )}
                </div>

                {/* Right: Feedback */}
                <div className="col-span-3">
                  <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">Feedback</p>
                  {activeSummary ? (() => {
                    const s = activeSummary!;
                    const fbInSpan = feedback.filter(f => f.date >= s.start_date && f.date <= s.end_date);
                    const sourceCounts: Record<string, number> = {};
                    fbInSpan.forEach(f => { sourceCounts[f.source_type] = (sourceCounts[f.source_type] || 0) + 1; });
                    const pos = fbInSpan.filter(f => f.score >= 6).length;
                    const neu = fbInSpan.filter(f => f.score >= 4 && f.score < 6).length;
                    const neg = fbInSpan.filter(f => f.score < 4).length;
                    const avg = fbInSpan.length ? (fbInSpan.reduce((sum, f) => sum + f.score, 0) / fbInSpan.length).toFixed(1) : "—";
                    let highlights: { raw_text: string; source_type: string; score: number; date: string }[] = [];
                    try { highlights = s.highlights.map(h => JSON.parse(h)); } catch { /* */ }
                    const showAll = expandedSummaryId === s.id;
                    const displayed = showAll ? highlights : highlights.slice(0, 5);
                    return (
                      <div>
                        <div className="flex items-start gap-3 mb-4">
                          <SimplePie counts={sourceCounts} />
                          <div className="flex flex-col gap-1 pt-1">
                            {Object.entries(sourceCounts).map(([type, count]) => (
                              <span key={type} className="flex items-center gap-1.5 text-xs text-gray-500">
                                <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: SOURCE_COLORS[type] ?? "#6b7280" }} />
                                {type} ({count})
                              </span>
                            ))}
                          </div>
                          <div className="ml-auto flex flex-col gap-1 text-xs text-right">
                            <span className="text-gray-500">avg <span className="text-white font-medium">{avg}/10</span></span>
                            <span className="text-teal-400">{pos} positive</span>
                            <span className="text-gray-400">{neu} neutral</span>
                            <span className="text-red-400">{neg} negative</span>
                          </div>
                        </div>
                        <p className="text-sm text-gray-300 leading-relaxed mb-4 border-l-2 border-gray-800 pl-3">{s.summary}</p>
                        <div className="space-y-3">
                          {displayed.map((h, i) => (
                            <div key={i} className="border-l-2 border-gray-800 pl-3">
                              <p className="text-xs text-gray-400 leading-relaxed">&ldquo;{h.raw_text}&rdquo;</p>
                              <p className="text-xs text-gray-600 mt-0.5">{h.source_type} · {h.date} · {h.score}/10</p>
                            </div>
                          ))}
                        </div>
                        {highlights.length > 5 && (
                          <button className="text-xs text-teal-500 hover:text-teal-300 mt-3 transition-colors"
                            onClick={() => setExpandedSummaryId(e => e === s.id ? null : s.id)}>
                            {showAll ? "Show less ↑" : `Show all ${highlights.length} pieces ↓`}
                          </button>
                        )}
                      </div>
                    );
                  })() : (
                    <p className="text-sm text-gray-600">No analysis for this period.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
