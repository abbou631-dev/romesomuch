import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import rehypeTrailingSlash from "./src/lib/rehype-trailing-slash.mjs";

// Pages that must not be offered to search engines: the private tools, the
// link-only itinerary page (it carries noindex) and the 404.
const PRIVATE = /^\/(admin|crm|area-clienti|bespoke-itinerary|404)(\/|$)/;

export default defineConfig({
  site: "https://romesomuch.com",
  build: { format: "directory" },
  markdown: { rehypePlugins: [rehypeTrailingSlash] },
  integrations: [sitemap({ filter: (page) => !PRIVATE.test(new URL(page).pathname) })],
});
