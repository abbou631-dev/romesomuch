---
name: journal
description: Turn one of our social posts (Instagram or TikTok link, plus caption) into a Journal article on romesomuch.com. Use when the user runs /journal or sends a post link asking for a blog article.
---

# /journal <post link> [caption]

Write a Journal article from one RomeSoMuch social post. Nothing is published until the user says so.

## 1. Read the post

- **TikTok:** fetch `https://www.tiktok.com/oembed?url=<link>`; `title` is the caption.
- **Instagram:** Instagram blocks unauthenticated reads. Try fetching the link once; if the caption does not come back, ask the user to paste it. Do not guess it from the thumbnail.
- Note every place the post names or shows (venue, street, dish, event, date).

## 2. Write the article

- Model it on `src/content/journal/night-bars.md`: English, a short scene-setting intro, then one `##` section per place, each ending with `**Address, postcode Rome** · [Website](official url)`.
- Same voice as the site: concrete, dry, no superlatives the facts do not earn. The caption is the brief, not the text: expand it, never paste it.
- File: `src/content/journal/<slug>.md`, slug short and descriptive (it becomes `/journal/<slug>/`). Frontmatter: `title`, `date` as `"3 October 2026"`, `excerpt` (one sentence, shown on cards), `cover` (an image name from step 4).

## 3. Verify every fact

- Every address, opening detail and website comes from the place's **official** site or Google Maps listing, never from the caption or memory. Venues inside hotels link to the hotel's page for them.
- Anything that cannot be verified is left out, not softened.
- No invented proof: no ratings, review quotes or visitor numbers that the user has not supplied.

## 4. Images — licensed sources only

Do **not** take images from Google Images, other creators, photographers or stock sites (Getty, Alamy, Shutterstock…): finding the same photo without the text does not make it ours, and using it on a commercial site is copyright infringement. In order of preference:

1. **Our own originals.** The post is our content, so the unedited file (before the text overlay) is in the user's camera roll or editor. Ask for it first.
2. **The venue's own press or website images**, credited as `*Photo: @venue*` under the image, as `night-bars.md` does. Prefer a press kit; when unsure, tell the user permission may be needed.
3. **Openly licensed photos** for places and streets: Wikimedia Commons (credit author and licence under the image), Unsplash or Pexels (credit the photographer). Record the source URL in the reply.

A reverse image search (Google Lens) is fine to find **who owns** a frame used in the post, so it can be credited or asked for, not to fetch a copy.

Images go in `src/assets/experiences/<name>.jpeg` and are referenced from the article as `../../assets/experiences/<name>.jpeg` with descriptive alt text.

## 5. Preview, then publish on approval

1. Run `npm run dev`, screenshot the article and the Journal card at ~390px and ~1200px, and open the article in Chrome.
2. Report: the article URL, the sources used for each fact, each image's source and credit, and anything left out.
3. Only when the user approves: `npm run build`, commit on `main` (message in plain English), `git push origin main`, wait for the Pages deployment, check the live URL returns 200.
