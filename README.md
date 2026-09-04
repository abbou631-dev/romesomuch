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

## CMS (Sveltia)

The editing interface is [Sveltia CMS](https://github.com/sveltia/sveltia-cms), served as a static
page from `public/admin/`. It is git-based: every save is a commit on `main`, and every commit on
`main` redeploys the site.

- `public/admin/index.html` — loads the CMS.
- `public/admin/config.yml` — the collections. Fields here mirror the Zod schema in
  `src/content.config.ts`; change one and change the other.
- Live at `/admin/` (locally: http://localhost:4321/admin/).

**Collections**

| Collection | Files | Fields |
| --- | --- | --- |
| Experiences | `src/content/experiences/*.md` | order, title, category, blurb, price, unit, duration, durationLabel, maxGuests, languages, meetingPoint, photos, what's included, cancellation policy, Bokun product id, Bokun embed code, body |
| Journal | `src/content/journal/*.md` | title, date, excerpt, cover, body |

Cancellation is opt-out: leave `cancellationPolicy` empty and the experience shows the house rule
from `cancellationDefault` in `src/data/site.json` — all sales are final. Fill the field in for the
experiences that differ, and that text shows on the page and under the booking calendar.

Photos are uploaded into `src/assets/experiences/` and the build optimises them. The `Photos` field
takes either a real photo or a poster placeholder (word + tone), which is why every entry carries a
`type` key.

**Sign-in.** The GitHub backend needs an OAuth relay, since the site is on Cloudflare and not
Netlify. That relay is part of this repository — two Cloudflare Pages Functions deployed with the
site, so there is no separate worker to maintain:

- `functions/auth.js` → `/auth` sends the CMS pop-up to GitHub, asking only for the scopes the CMS
  needs and setting a one-time state cookie.
- `functions/callback.js` → `/callback` swaps the code for a token and posts it back to the CMS
  window, only if that window's origin is on the allowlist.

What has to be done once, by hand:

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.
   Homepage `https://romesomuch.pages.dev`, callback `https://romesomuch.pages.dev/callback`.
2. Cloudflare Pages → project `romesomuch` → Settings → Variables and Secrets. Add
   `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` as secrets, for Production and Preview.
3. Redeploy (any push to `main` does it, or Deployments → Retry deployment).

Optional: `ALLOWED_ORIGINS`, a comma-separated list of the origins allowed to receive a token.
Defaults to `romesomuch.pages.dev`, its preview subdomains and localhost.

Two ways to edit without any of that:

- **Work with Local Repository** on the sign-in screen — pick the project folder and edit the files
  on this machine, no GitHub involved.
- **Sign In Using Access Token** — a GitHub personal access token with read/write access to the
  contents of this repository.

## Bokun

Set the booking channel UUID once, in `.env`:

```
PUBLIC_BOKUN_CHANNEL=your-booking-channel-uuid
```

Then give an experience its product id in frontmatter:

```yaml
bokunProductId: "12345"
```

That experience renders the Bokun widget (calendar, availability, payment).

Or skip both and paste the whole snippet Bokun gives you into the **Bokun embed code** field in the
CMS (`bokunEmbed` in frontmatter). The channel UUID is read out of the snippet, so that field alone
is enough and it takes precedence over the product id. With neither set, the widget slot renders a
labelled note instead — nothing breaks.

## Routes

`/` · `/experiences/{all,tours,food,activities,day-trips}/` · `/experience/<id>/` ·
`/journal/` · `/journal/<slug>/` · `/legal/{terms,privacy,cookies}/` · `/about/` · `/contact/` · 404

## Deploy (Cloudflare)

The site is a static build, served by Cloudflare from `dist/`. Configuration lives in
`wrangler.jsonc` (`pages_build_output_dir`); `.node-version` pins the build image to Node 22.

Cloudflare Pages project `romesomuch`, connected to this repository:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Live URL | https://romesomuch.pages.dev |

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
