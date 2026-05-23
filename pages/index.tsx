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
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/products").then((r) => r.json()).then(setProducts);
  }, []);

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

  async function handleRefresh() {
    if (!selectedProduct) return;
    setLoadingIngest(true);
    await fetch("/api/agent/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: selectedProduct.name,
        description: selectedProduct.description,
        links: selectedProduct.links,
      }),
    });
    setLoadingIngest(false);
    await loadReleases(selectedProduct.id);
  }

  async function handleCreate() {
    setLoadingIngest(true);
    const links = newLinks.split("\n").map((l) => l.trim()).filter(Boolean);
    const res = await fetch("/api/agent/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: query, description: newDesc, links }),
    });
    const data = await res.json();

    const productsRes = await fetch("/api/products");
    const updated: Product[] = await productsRes.json();
    setProducts(updated);

    const created = updated.find((p) => p.id === data.product_id);
    if (created) {
      setSelectedProduct(created);
      setIsNew(false);
      await loadReleases(created.id);
    }
    setLoadingIngest(false);
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
            <h2 className="text-sm font-semibold text-gray-300">New product</h2>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Description</label>
              <textarea
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none"
                rows={2}
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="What is this product?"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Links (one per line)</label>
              <textarea
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none font-mono"
                rows={3}
                value={newLinks}
                onChange={(e) => setNewLinks(e.target.value)}
                placeholder="https://github.com/org/repo/releases"
              />
            </div>
            <button
              className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-5 py-2 rounded-lg disabled:opacity-50"
              onClick={handleCreate}
              disabled={loadingIngest}
            >
              {loadingIngest ? "Fetching releases…" : "Add & Fetch Releases"}
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
                className="shrink-0 bg-gray-800 hover:bg-gray-700 border border-gray-600 text-sm px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
                onClick={handleRefresh}
                disabled={loadingIngest}
              >
                {loadingIngest ? "Refreshing…" : "↻ Refresh"}
              </button>
            </div>
          </div>
        )}

        {/* Timeline */}
        {(selectedProduct || loadingReleases) && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">
              Releases
            </p>
            {loadingReleases ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : releases.length === 0 ? (
              <p className="text-sm text-gray-500">
                No releases yet — hit Refresh to fetch them.
              </p>
            ) : (
              <div className="relative">
                <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gray-800" />
                <div className="space-y-6">
                  {releases.map((r) => (
                    <div key={r.id} className="flex gap-4 pl-6 relative">
                      <div className="absolute left-0 top-1.5 w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-gray-950 shrink-0" />
                      <div className="flex-1 min-w-0 pb-2">
                        <div className="flex items-baseline gap-3 mb-1">
                          <span className="text-sm font-semibold">{r.name}</span>
                          <span className="text-xs text-gray-500">{r.date}</span>
                        </div>
                        <p className="text-sm text-gray-400">{r.summary}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
