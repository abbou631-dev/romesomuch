# RomeSoMuch

Astro site for RomeSoMuch: experiences, tours and day trips in Rome, with per-experience
booking — a Bokun calendar where live availability exists, a booking request everywhere else.

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | install dependencies |
| `npm run dev` | dev server on http://localhost:4321 |
| `npm run build` | static build into `dist/` |
| `npm run preview` | serve the built site |
| `npm run check` | type-check pages, components and content schemas |

## Content

Everything editable lives in `src/content` and `src/data`, so copy changes never touch components.

- `src/content/experiences/<id>.md` — one file per experience. The frontmatter is validated by the
  schema in `src/content.config.ts`; the markdown body is the "What you do" text. The filename is
  the URL: `colosseum.md` → `/experience/colosseum/`.
- `src/content/journal/<slug>.md` — one file per article, body is the article.
- `src/data/site.json` — categories, the hand-picked `topPicks` list, and the three legal documents.
- `src/assets/experiences/*.jpeg` — photos, referenced by filename without extension:
  `images: [{ "photo": "vatican-gallery" }]`. Where no photo exists yet, use a poster tile instead:
  `{ "poster": "Colosseum", "tone": "ink" }` (tones: `ink`, `blue`, `sun`).

Astro optimises every photo at build time (WebP, responsive `srcset`), so drop full-resolution
files in and let the build size them.

## Bokun

Set the booking channel UUID once, in `.env`:

```
PUBLIC_BOKUN_CHANNEL=your-booking-channel-uuid
```

Then give an experience its product id in frontmatter:

```yaml
bokunProductId: "12345"
```

That experience renders the Bokun widget (calendar, availability, payment) and the request form
moves below it as "Prefer to ask first?". Experiences with `bokunProductId: null` show the request
form alone. With no channel set, the widget slot renders a labelled note instead — nothing breaks.

## Routes

`/` · `/experiences/{all,tours,food,activities,day-trips}/` · `/experience/<id>/` ·
`/journal/` · `/journal/<slug>/` · `/legal/{terms,privacy,cookies}/` · `/about/` · `/contact/` · 404

## Deploy (Cloudflare)

The site is a static build, served by Cloudflare from `dist/`. Configuration lives in
`wrangler.jsonc`; `.node-version` pins the build image to Node 22.

Connected through the Cloudflare dashboard: **Workers & Pages → Create → Import a repository →
`abbou631-dev/romesomuch`**, with

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Build output directory | `dist` |
| Root directory | *(empty)* |

Every push to `main` then builds and deploys on its own. Pull requests get a preview URL.

Environment variables set in the Cloudflare project (Settings → Variables), not in the repo:

```
PUBLIC_BOKUN_CHANNEL = <booking channel UUID>
```

It is read at build time, so changing it needs a redeploy (Deployments → Retry deployment).

## Still to do before launch

- Real catalogue: names, prices, times, capacities, meeting points, copy.
- Real photography — 8 experiences currently ship a poster tile placeholder.
- Legal documents: fill the bracketed company details and have them reviewed.
- Decide where booking requests land (mailbox, CRM, or Bokun checkout everywhere).
- Reviews: none are invented anywhere in this codebase; add real ones when they exist.
