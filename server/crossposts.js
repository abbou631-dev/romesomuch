// Instagram shows a reel shared to Facebook with the views of both, and the
// agency reports Instagram the same way: wherever videos are listed, the
// Facebook copy of an Instagram video (same day, same title) joins its row and
// the numbers are added up. A Facebook video with no Instagram twin stays as
// it is. Shared by the CRM, the client area and the monthly report.

const METRICS = ["views", "reach", "likes", "comments", "shares", "saves"];
const key = (v) => `${v.published_on}|${String(v.title ?? "").trim().toLowerCase()}`;

// The joined row keeps the Instagram video's fields with the summed metrics,
// plus `ig` and `fb`, the two original rows.
/** @param {Record<string, any>[]} videos @returns {Record<string, any>[]} */
export function withFacebook(videos) {
  const facebook = new Map();
  for (const v of videos) if (v.platform === "facebook" && v.title && !facebook.has(key(v))) facebook.set(key(v), v);
  const joined = new Set();
  const rows = videos.map((v) => {
    const fb = v.platform === "instagram" && v.title && facebook.get(key(v));
    if (!fb || joined.has(fb)) return v;
    joined.add(fb);
    const sum = Object.fromEntries(METRICS.map((k) => [k, v[k] == null && fb[k] == null ? null : (v[k] ?? 0) + (fb[k] ?? 0)]));
    return { ...v, ...sum, ig: v, fb };
  });
  return rows.filter((v) => !joined.has(v));
}

// Views per platform, Instagram including its Facebook copies.
export function platformViews(videos) {
  const views = new Map();
  for (const v of withFacebook(videos)) views.set(v.platform, (views.get(v.platform) ?? 0) + (v.views ?? 0));
  return views;
}
