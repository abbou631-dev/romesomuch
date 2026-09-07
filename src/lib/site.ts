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
