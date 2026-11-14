# RomeSoMuch

Astro site for RomeSoMuch: experiences, tours and day trips in Rome, with per-experience
booking — our own calendar with a deposit paid online where the site sells the experience, a booking request everywhere else.

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
| Experiences | `src/content/experiences/*.md` | order, title, category, blurb, price, unit, duration, durationLabel, maxGuests, languages, meetingPoint, photos, what's included, cancellation policy, liveBooking (sold on the site), golfCart, requestOnly, body |
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

## Bookings (our own experiences)

The experiences RomeSoMuch runs itself are booked on the site, not through Bokun (since 14 Nov 2026).
An experience with `liveBooking: true` in frontmatter shows `src/components/TourBooking.astro`:
guests, a calendar of open start times, the customer's details, then a **deposit** paid with
Stripe's Payment Element. The balance is paid on the day.

- Prices, deposit %, start times, days, seats per time, sales cut-off and closed days live in D1
  (tables `tours`, `tour_closures`, `tour_bookings`, migration `0018_tours.sql`) and are edited in
  the CRM at **/crm/tour/** (Esperienze). The row's `slug` is the experience's file name. The card
  price comes from frontmatter, so change it in both places.
- Bookings are managed at /crm/tour/ (edit, cancel with a Stripe refund, resend the confirmation).
- Server: `server/tours.js`; public API `functions/api/tours/` (availability, hold, confirm, the
  Stripe webhook at `/api/tours/stripe`, and `/api/tours/reminders` called daily by
  `workers/report-reminder`).
- Emails (confirmation, update, cancellation, day-before reminder) go through Resend.
- Secrets on the Pages project: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
  `STRIPE_WEBHOOK_SECRET` (webhook event `payment_intent.succeeded`).
- Golf cart tours are not part of this: the partner's own box and Stripe handle them.

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

Secrets set on the Cloudflare project (Settings → Variables), never in the repo: see the
Bookings section above and the CRM notes.

## Still to do before launch

- Catalogue gaps: group sizes and languages are missing for most experiences, and the micromosaic
  workshop has no meeting point. See [`docs/catalogo-live-cms.md`](docs/catalogo-live-cms.md).
- Fiat 500 Tour: not on the site.
- Photography: the six experiences use photos taken from romesomuch.com — five each, three for the
  micromosaic workshop — plus the five vertical clips in `public/media/` (1080x1920, H.264/AAC).
  The page opens on a full-width band of 9:16 tiles — four on desktop, one on a phone — with a
  lightbox that shows each frame whole. A lead video autoplays muted and loops, with a sound toggle.
- Legal documents: fill the bracketed company details and have them reviewed.
- Reviews: none are invented anywhere in this codebase; add real ones when they exist.
