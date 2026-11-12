import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const picture = z.union([
  z.object({ photo: z.string() }),
  // A vertical clip, served straight from public/media — Astro does not process video.
  z.object({ video: z.string(), videoPoster: z.string().nullable().default(null) }),
  z.object({ poster: z.string(), tone: z.enum(["ink", "blue", "sun"]) }),
]);

const experiences = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/experiences" }),
  schema: z.object({
    order: z.number().int(),
    title: z.string(),
    category: z.enum(["tours", "food", "activities", "day-trips"]),
    blurb: z.string(),
    // Null only on a partner tour (live price) or a request-only tour (price on request).
    price: z.number().positive().nullable().default(null),
    unit: z.enum(["person", "group"]),
    duration: z.number().positive(),
    durationLabel: z.string(),
    maxGuests: z.number().int().positive().nullable().default(null),
    languages: z.string().nullable().default(null),
    meetingPoint: z.string().nullable().default(null),
    // Coordinates of the meeting point, "lat,lon". Absent where the experience has
    // no fixed spot — a hotel pickup has nothing to put on a map.
    meetingCoords: z.string().regex(/^-?\d+\.\d+,-?\d+\.\d+$/).nullable().default(null),
    // Flags the card while an experience is worth pointing at. Set by hand, and
    // meant to be taken off by hand — nothing stays new on its own.
    isNew: z.boolean().default(false),
    images: z.array(picture).min(1),
    included: z.array(z.string()).min(1),
    cancellationPolicy: z.string().nullable().default(null),
    bokunProductId: z.string().nullable().default(null),
    bokunEmbed: z.string().nullable().default(null),
    // Golf cart tours sold through the partner's booking box instead of Bokun:
    // the id of the tour in the partner's catalogue.
    golfCart: z.enum(["vip", "night", "oneday"]).nullable().default(null),
    // Tours we arrange ourselves: no online payment, the page takes a request
    // (date, guests, WhatsApp) and the price is given when we answer.
    requestOnly: z.boolean().default(false),
  }).refine((d) => d.golfCart !== null || d.requestOnly || d.price !== null, {
    message: "price is required unless golfCart or requestOnly is set",
    path: ["price"],
  }),
});

const journal = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/journal" }),
  schema: z.object({
    title: z.string(),
    // Printed as written, so one shape only: "3 October 2026".
    date: z.string().regex(/^([1-9]|[12]\d|3[01]) (January|February|March|April|May|June|July|August|September|October|November|December) 20\d\d$/),
    excerpt: z.string(),
    cover: z.string(),
  }),
});

export const collections = { experiences, journal };
