/** CSV category → UI filter (Buchkapitel) */
export const FILTERS = [
  { id: "figuren", label: "01 Figuren", categories: ["Figuren"] },
  { id: "vasen", label: "02 Vasen", categories: ["Keramik"] },
  { id: "artefakte", label: "03 Artefakte", categories: ["Alltagswerkzeuge"] },
  { id: "random", label: "04 Zufall", categories: null },
];

export function normalizeCategory(value) {
  return (value || "").trim();
}

export function filterItems(allItems, filterId) {
  const def = FILTERS.find((f) => f.id === filterId);
  if (!def) return allItems.slice();

  if (filterId === "random") {
    const out = allItems.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  const allowed = new Set(def.categories);
  return allItems.filter((item) => allowed.has(normalizeCategory(item.category)));
}

export function countForFilter(allItems, filterId) {
  return filterItems(allItems, filterId).length;
}

/** Katalog-Index des ersten Objekts einer Kategorie. */
export function firstCatalogIndex(allItems, filterId) {
  if (filterId === "random") return 0;
  const def = FILTERS.find((f) => f.id === filterId);
  if (!def?.categories) return 0;
  const allowed = new Set(def.categories);
  const idx = allItems.findIndex((item) =>
    allowed.has(normalizeCategory(item.category))
  );
  return idx >= 0 ? idx : 0;
}

/** Kategorie eines Objekts → Filter-ID für die HUD. */
export function filterIdForItem(item) {
  if (!item) return "figuren";
  const cat = normalizeCategory(item.category);
  for (const f of FILTERS) {
    if (f.id === "random" || !f.categories) continue;
    if (f.categories.includes(cat)) return f.id;
  }
  return "figuren";
}
