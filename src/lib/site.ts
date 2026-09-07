import site from "../data/site.json";

export type CategorySlug = "all" | "tours" | "food" | "activities" | "day-trips";

export const categories = site.categories as { slug: CategorySlug; name: string; blurb: string }[];
export const topPicks = site.topPicks as string[];
export const cancellationDefault = site.cancellationDefault as string;
export const legal = site.legal as unknown as Record<string, LegalDoc>;

export type LegalDoc = { t: string; l: string; u: string; s: [string, string][] };

export const categoryName = (slug: string) =>
  categories.find((c) => c.slug === slug)?.name ?? slug;

export const money = (n: number) => `€${n}`;

export const total = (price: number, unit: "person" | "group", guests: number) =>
  unit === "group" ? price : price * guests;

// Nav and category rails only show a category once something is filed under it,
// so an empty catalogue slot never becomes a dead link.
export const liveCategories = (used: Iterable<string>) => {
  const filled = new Set(used);
  return categories.filter((c) => c.slug === "all" || filled.has(c.slug));
};

// Cards want a still: if the gallery opens on a video, fall through to the first photo
// so the rails keep serving optimised images.
export const cardImage = <T extends object>(images: T[]): T =>
  images.find((i) => "photo" in i) ?? images[0];

// Filter chips are built from the catalogue on the page, not hard-coded: a band with
// nothing in it is dropped, so the bar never offers a filter that returns an empty grid.
export type Band = { value: string; label: string; min: number; max: number };

const priceBands: Band[] = [
  { value: "lt100", label: "Under €100", min: 0, max: 99.99 },
  { value: "100-200", label: "€100–200", min: 100, max: 200 },
  { value: "200-500", label: "€200–500", min: 200.01, max: 500 },
  { value: "gt500", label: "Over €500", min: 500.01, max: Infinity },
];

const lengthBands: Band[] = [
  { value: "lt2", label: "Up to 2h", min: 0, max: 2 },
  { value: "half", label: "Half day", min: 2.01, max: 4 },
  { value: "full", label: "Full day", min: 4.01, max: Infinity },
];

const live = (bands: Band[], values: number[]) =>
  bands.filter((b) => values.some((v) => v >= b.min && v <= b.max));

export const bandsFor = (values: number[], kind: "price" | "length") =>
  live(kind === "price" ? priceBands : lengthBands, values);
