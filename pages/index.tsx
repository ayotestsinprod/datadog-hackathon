import { useState, useEffect, useRef } from "react";

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

export default function Home() {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [newDesc, setNewDesc] = useState("");
  const [newLinks, setNewLinks] = useState("");
  const [releases, setReleases] = useState<Release[]>([]);
  const [loadingReleases, setLoadingReleases] = useState(false);
  const [loadingIngest, setLoadingIngest] = useState(false);
  const [streamLog, setStreamLog] = useState<string[]>([]);
  const [hoveredReleaseId, setHoveredReleaseId] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [showMenu, setShowMenu] = useState(false);
  const [everLoaded, setEverLoaded] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const refreshButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase())
  );
  const exactMatch = products.some(
    (p) => p.name.toLowerCase() === query.toLowerCase()
  );

  async function loadReleases(productId: string) {
    setLoadingReleases(true);
    const res = await fetch(`/api/releases?product_id=${productId}`);
    setReleases(await res.json());
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
    if (!p.description || !p.favicon_url || p.links.length === 0) {
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

  async function streamAgent(endpoint: string, body: object, onEvent?: (e: Record<string, unknown>) => void): Promise<void> {
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
        onEvent?.(event);
      }
    }
  }

  async function handleDelete() {
    if (!selectedProduct) return;
    setShowMenu(false);
    await fetch(`/api/products/${selectedProduct.id}`, { method: "DELETE" });
    setSelectedProduct(null);
    setReleases([]);
    setQuery("");
    const updated: Product[] = await fetch("/api/products").then((r) => r.json());
    setProducts(updated);
  }

  async function handleRefresh() {
    if (!selectedProduct) return;
    setShowMenu(false);
    setLoadingIngest(true);
    setStreamLog([]);
    const p = selectedProduct;
    const agentBody = { product_id: p.id, name: p.name, description: p.description, links: p.links };
    await streamAgent("/api/agent/refresh", agentBody);
    await loadReleases(p.id);
    // Re-fetch product to pick up any updated metadata
    const updated: Product[] = await fetch("/api/products").then((r) => r.json());
    const fresh = updated.find((x) => x.id === p.id);
    if (fresh) { setSelectedProduct(fresh); setProducts(updated); }
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

    // Run both agents sequentially: first populate metadata, then fetch releases
    await streamAgent("/api/agent/initialize", agentBody);
    await streamAgent("/api/agent/refresh", agentBody);

    // Re-fetch product to get populated description/links/favicon
    const updated: Product[] = await fetch("/api/products").then((r) => r.json());
    setProducts(updated);
    const fresh = updated.find((p) => p.id === product_id);
    if (fresh) setSelectedProduct(fresh);

    await loadReleases(product_id);
    setLoadingIngest(false);
  }

  const isIdle = !everLoaded && !selectedProduct && !isNew;

  // Shared combobox input props
  const inputProps = {
    value: query,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value);
      setShowDropdown(true);
      setHighlightedIndex(-1);
      setSelectedProduct(null);
      setReleases([]);
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
        <div className="max-w-2xl mx-auto px-8 pt-8 pb-16">

          {/* Compact header */}
          <div className="flex items-center gap-3 mb-8">
            <button
              className="text-gray-600 hover:text-teal-400 transition-colors text-sm"
              onClick={() => { setSelectedProduct(null); setIsNew(false); setQuery(""); setReleases([]); }}>
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
                  <div className="absolute right-0 top-full mt-1 w-44 bg-gray-900 border border-gray-700 rounded-xl shadow-xl z-30 overflow-hidden">
                    <button className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-800 flex items-center gap-2" onClick={handleRefresh}>
                      <span>↻</span> Refresh releases
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

        {/* Timeline */}
        {(selectedProduct || loadingReleases) && (
          <div>
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-6">Releases</p>
            {loadingReleases || (loadingIngest && releases.length === 0) ? (
              <p className="text-sm text-gray-600 animate-pulse">Loading…</p>
            ) : releases.length === 0 ? (
              <p className="text-sm text-gray-600">No releases yet — use ··· to refresh.</p>
            ) : (
              <div className="overflow-x-auto -mx-8 px-8 pb-2"
                style={{ scrollbarWidth: "thin", scrollbarColor: "#374151 transparent" }}>
                {(() => {
                  const ITEM_W = 140;
                  const TOOLTIP_W = 220;
                  const AXIS_Y = 170;
                  const totalWidth = Math.max(releases.length * ITEM_W + 60, 500);
                  return (
                    <div className="relative" style={{ width: totalWidth, height: AXIS_Y + 60 }}>
                      <div className="absolute bg-gray-800" style={{ top: AXIS_Y, left: 20, right: 20, height: 1 }} />
                      {releases.map((r, i) => {
                        const cx = 20 + i * ITEM_W + ITEM_W / 2;
                        const isHovered = hoveredReleaseId === r.id;
                        const rawLeft = cx - TOOLTIP_W / 2;
                        const tooltipLeft = Math.max(4, Math.min(rawLeft, totalWidth - TOOLTIP_W - 4));
                        return (
                          <div key={r.id} className="absolute cursor-default"
                            style={{ left: cx - ITEM_W / 2, top: 0, width: ITEM_W, height: AXIS_Y + 60 }}
                            onMouseEnter={() => setHoveredReleaseId(r.id)}
                            onMouseLeave={() => setHoveredReleaseId(null)}>
                            {isHovered && (
                              <div className="absolute z-20 bg-gray-900 border border-gray-700 rounded-xl p-3 shadow-xl overflow-y-auto"
                                style={{ top: 4, left: tooltipLeft - (cx - ITEM_W / 2), width: TOOLTIP_W, maxHeight: AXIS_Y - 16 }}>
                                <p className="text-xs font-semibold text-white mb-1">{r.name}</p>
                                <p className="text-xs text-teal-500 mb-2">{r.date}</p>
                                <p className="text-xs text-gray-400 leading-relaxed">{r.summary}</p>
                              </div>
                            )}
                            <div className="absolute bg-gray-700" style={{ left: "50%", top: AXIS_Y - 10, width: 1, height: 11 }} />
                            <div className={`absolute rounded-full border-2 border-[#030712] transition-colors ${isHovered ? "bg-teal-400" : "bg-teal-600"}`}
                              style={{ left: "50%", top: AXIS_Y - 6, transform: "translateX(-50%)", width: 14, height: 14 }} />
                            <div className="absolute text-center" style={{ top: AXIS_Y + 12, left: 0, right: 0 }}>
                              <p className="text-xs font-medium text-gray-400 truncate px-2">{r.name}</p>
                              <p className="text-xs text-gray-700 mt-0.5">{r.date}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}
        </div>
      )}
    </main>
  );
}
