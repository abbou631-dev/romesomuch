// /llms.txt: a plain-text map of the site for AI assistants (llmstxt.org).
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { newestFirst, money } from "../lib/site";

const SITE = "https://romesomuch.com";

export const GET: APIRoute = async () => {
  const posts = newestFirst(await getCollection("journal"));
  const experiences = (await getCollection("experiences")).sort((a, b) => a.data.order - b.data.order);
  const lines = [
    "# RomeSoMuch",
    "",
    "> RomeSoMuch is a Rome-based travel brand: small-group tours, food experiences and classes in Rome,",
    "> plus the Journal, practical guides to eating and visiting in Rome with addresses and opening days",
    "> checked on each venue's official website.",
    "",
    "## Journal",
    "",
    ...posts.map((p) => `- [${p.data.title}](${SITE}/journal/${p.id}/): ${p.data.excerpt}`),
    "",
    "## Experiences",
    "",
    ...experiences.map(
      (e) => `- [${e.data.title}](${SITE}/experience/${e.id}/): ${e.data.blurb.replace(/[.!?]?$/, ".")} From ${money(e.data.price)} per ${e.data.unit}, ${e.data.durationLabel}.`,
    ),
    "",
    "## About",
    "",
    `- [About RomeSoMuch](${SITE}/about/)`,
    `- [Contact](${SITE}/contact/)`,
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
