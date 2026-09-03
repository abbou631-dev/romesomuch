import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const picture = z.union([
  z.object({ photo: z.string() }),
  z.object({ poster: z.string(), tone: z.enum(["ink", "blue", "sun"]) }),
]);

const experiences = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/experiences" }),
  schema: z.object({
    order: z.number().int(),
    title: z.string(),
    category: z.enum(["tours", "food", "activities", "day-trips"]),
    blurb: z.string(),
    price: z.number().positive(),
    unit: z.enum(["person", "group"]),
    duration: z.number().positive(),
    durationLabel: z.string(),
    maxGuests: z.number().int().positive(),
    languages: z.string(),
    meetingPoint: z.string(),
    slots: z.array(z.string()).min(1),
    images: z.array(picture).min(1),
    included: z.array(z.string()).min(1),
    bokunProductId: z.string().nullable().default(null),
    bokunEmbed: z.string().nullable().default(null),
  }),
});

const journal = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/journal" }),
  schema: z.object({
    title: z.string(),
    date: z.string(),
    excerpt: z.string(),
    cover: z.string(),
  }),
});

export const collections = { experiences, journal };
