import site from "../data/site.json";

export type CategorySlug = "all" | "tours" | "food" | "activities" | "day-trips";

export const categories = site.categories as { slug: CategorySlug; name: string; blurb: string }[];
export const topPicks = site.topPicks as string[];
export const legal = site.legal as unknown as Record<string, LegalDoc>;

export type LegalDoc = { t: string; l: string; u: string; s: [string, string][] };

export const categoryName = (slug: string) =>
  categories.find((c) => c.slug === slug)?.name ?? slug;

export const money = (n: number) => `€${n}`;

export const total = (price: number, unit: "person" | "group", guests: number) =>
  unit === "group" ? price : price * guests;
