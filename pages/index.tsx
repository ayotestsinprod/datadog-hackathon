import { useState, useEffect, useRef } from "react";

interface Product {
  id: string;
  name: string;
  description: string;
  links: string[];
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
  const dropdownRef = useRef<HTMLDivElement>(null);
  const refreshButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fetch("/api/products").then((r) => r.json()).then(setProducts);
  }, []);

  useEffect(() => {
    if (selectedProduct) refreshButtonRef.current?.focus();
  }, [selectedProduct]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
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
    setSelectedProduct(p);
    setIsNew(false);
    setQuery(p.name);
    setShowDropdown(false);
    await loadReleases(p.id);
  }

  async function runIngest(body: object, onDone: (product_id: string) => Promise<void>) {
    setLoadingIngest(true);
    setStreamLog([]);

    const res = await fetch("/api/agent/ingest", {
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
        const event = JSON.parse(line.slice(6));
        if (event.type === "tool_call") {
          setStreamLog((l) => [...l, `→ ${event.name}`]);
        } else if (event.type === "release_inserted") {
          setStreamLog((l) => [...l, `  ✓ ${event.name}`]);
        } else if (event.type === "done") {
          await onDone(event.product_id);
        }
      }
    }

    setLoadingIngest(false);
  }

  async function handleRefresh() {
    if (!selectedProduct) return;
    await runIngest(
      { name: selectedProduct.name, description: selectedProduct.description, links: selectedProduct.links },
      async (product_id) => {
        await loadReleases(product_id ?? selectedProduct.id);
      }
    );
  }

  async function handleCreate() {
    const links = newLinks.split("\n").map((l) => l.trim()).filter(Boolean);

    // Create the product row immediately so we can show the card right away
    const createRes = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: query, description: newDesc, links }),
    });
    const { id: product_id } = await createRes.json();

    // Show the product card before ingest starts
    setSelectedProduct({ id: product_id, name: query, description: newDesc, links });
    setIsNew(false);
    fetch("/api/products").then((r) => r.json()).then(setProducts);

    // Stream ingest — we already know the product_id so use it directly
    await runIngest(
      { name: query, description: newDesc, links },
      async () => loadReleases(product_id)
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-8 tracking-tight">Pulse</h1>

        {/* Combobox */}
        <div className="relative mb-6" ref={dropdownRef}>
          <input
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500"
            placeholder="Search or add a product..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowDropdown(true);
              setSelectedProduct(null);
              setIsNew(false);
              setReleases([]);
              setHighlightedIndex(-1);
            }}
            onFocus={() => setShowDropdown(true)}
            onKeyDown={(e) => {
              // items = filtered products + optional "Add" entry at the end
              const itemCount = filtered.length + (!exactMatch && query.trim() ? 1 : 0);
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlightedIndex((i) => Math.min(i + 1, itemCount - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlightedIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (highlightedIndex >= 0 && highlightedIndex < filtered.length) {
                  selectProduct(filtered[highlightedIndex]);
                } else if (highlightedIndex === filtered.length && !exactMatch && query.trim()) {
                  setIsNew(true);
                  setShowDropdown(false);
                }
              } else if (e.key === "Escape") {
                setShowDropdown(false);
              }
            }}
          />
          {showDropdown && query.length > 0 && (
            <div className="absolute top-full mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-10 overflow-hidden">
              {filtered.map((p, i) => (
                <button
                  key={p.id}
                  className={`w-full text-left px-4 py-3 text-sm border-b border-gray-800 last:border-0 ${highlightedIndex === i ? "bg-gray-800" : "hover:bg-gray-800"}`}
                  onMouseDown={() => selectProduct(p)}
                  onMouseEnter={() => setHighlightedIndex(i)}
                >
                  {p.name}
                </button>
              ))}
              {!exactMatch && query.trim() && (
                <button
                  className={`w-full text-left px-4 py-3 text-sm text-blue-400 ${highlightedIndex === filtered.length ? "bg-gray-800" : "hover:bg-gray-800"}`}
                  onMouseDown={() => { setIsNew(true); setShowDropdown(false); }}
                  onMouseEnter={() => setHighlightedIndex(filtered.length)}
                >
                  + Add &quot;{query}&quot;
                </button>
              )}
            </div>
          )}
        </div>

        {/* New product form */}
        {isNew && (
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-5 mb-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-300">New product: {query}</h2>
              <span className="text-xs text-gray-500">description and links are optional</span>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Description</label>
              <textarea
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none"
                rows={2}
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="What is this product? (optional)"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Links (one per line)</label>
              <textarea
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none font-mono"
                rows={2}
                value={newLinks}
                onChange={(e) => setNewLinks(e.target.value)}
                placeholder="https://github.com/org/repo/releases (optional)"
              />
            </div>
            <button
              className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-5 py-2 rounded-lg disabled:opacity-50"
              onClick={handleCreate}
              disabled={loadingIngest}
            >
              {loadingIngest ? "Fetching releases…" : "Fetch Releases"}
            </button>
          </div>
        )}

        {/* Selected product */}
        {selectedProduct && (
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-5 mb-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold mb-1">{selectedProduct.name}</h2>
                {selectedProduct.description && (
                  <p className="text-sm text-gray-400 mb-2">{selectedProduct.description}</p>
                )}
                {selectedProduct.links?.length > 0 && (
                  <div className="flex flex-col gap-1">
                    {selectedProduct.links.map((l, i) => (
                      <a
                        key={i}
                        href={l}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-400 hover:underline truncate"
                      >
                        {l}
                      </a>
                    ))}
                  </div>
                )}
              </div>
              <button
                ref={refreshButtonRef}
                className="shrink-0 bg-gray-800 hover:bg-gray-700 border border-gray-600 text-sm px-4 py-2 rounded-lg disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                onClick={handleRefresh}
                disabled={loadingIngest}
              >
                {loadingIngest ? "Refreshing…" : "↻ Refresh"}
              </button>
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
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-6">
              Releases
            </p>
            {loadingReleases || (loadingIngest && releases.length === 0) ? (
              <p className="text-sm text-gray-500 animate-pulse">Loading…</p>
            ) : releases.length === 0 ? (
              <p className="text-sm text-gray-500">
                No releases yet — hit Refresh to fetch them.
              </p>
            ) : (
              <div
                className="overflow-x-auto -mx-8 px-8 pb-2"
                style={{ scrollbarWidth: "thin", scrollbarColor: "#374151 transparent" }}
              >
                {(() => {
                  const ITEM_W = 140;
                  const TOOLTIP_W = 220;
                  const AXIS_Y = 170;
                  const totalWidth = Math.max(releases.length * ITEM_W + 60, 500);
                  return (
                    <div className="relative" style={{ width: totalWidth, height: AXIS_Y + 60 }}>
                      {/* Axis line */}
                      <div className="absolute bg-gray-700" style={{ top: AXIS_Y, left: 20, right: 20, height: 1 }} />
                      {releases.map((r, i) => {
                        const cx = 20 + i * ITEM_W + ITEM_W / 2;
                        const isHovered = hoveredReleaseId === r.id;
                        // Clamp tooltip so it never overflows the scroll container
                        const rawLeft = cx - TOOLTIP_W / 2;
                        const tooltipLeft = Math.max(4, Math.min(rawLeft, totalWidth - TOOLTIP_W - 4));
                        return (
                          <div
                            key={r.id}
                            className="absolute cursor-default"
                            style={{ left: cx - ITEM_W / 2, top: 0, width: ITEM_W, height: AXIS_Y + 60 }}
                            onMouseEnter={() => setHoveredReleaseId(r.id)}
                            onMouseLeave={() => setHoveredReleaseId(null)}
                          >
                            {/* Tooltip — clamped to stay within scroll bounds, max height to prevent vertical overflow */}
                            {isHovered && (
                              <div
                                className="absolute z-20 bg-gray-800 border border-gray-600 rounded-lg p-3 shadow-xl overflow-y-auto"
                                style={{ top: 4, left: tooltipLeft - (cx - ITEM_W / 2), width: TOOLTIP_W, maxHeight: AXIS_Y - 16 }}
                              >
                                <p className="text-xs font-semibold text-white mb-1">{r.name}</p>
                                <p className="text-xs text-gray-400 mb-2">{r.date}</p>
                                <p className="text-xs text-gray-300 leading-relaxed">{r.summary}</p>
                              </div>
                            )}
                            {/* Tick */}
                            <div className="absolute bg-gray-600" style={{ left: "50%", top: AXIS_Y - 10, width: 1, height: 11 }} />
                            {/* Dot */}
                            <div
                              className={`absolute rounded-full border-2 border-gray-950 transition-colors ${isHovered ? "bg-blue-400" : "bg-blue-500"}`}
                              style={{ left: "50%", top: AXIS_Y - 6, transform: "translateX(-50%)", width: 14, height: 14 }}
                            />
                            {/* Label below axis */}
                            <div className="absolute text-center" style={{ top: AXIS_Y + 12, left: 0, right: 0 }}>
                              <p className="text-xs font-medium text-gray-300 truncate px-2">{r.name}</p>
                              <p className="text-xs text-gray-600 mt-0.5">{r.date}</p>
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
    </main>
  );
}
