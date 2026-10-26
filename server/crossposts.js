// Instagram shows a reel shared to Facebook with the views of both, and the
// agency reports Instagram the same way: wherever videos are listed, an
// Instagram video's views include those of its Facebook copy (same day, same
// title). Every platform keeps its own row; the Facebook one shows its own
// views. Shared by the CRM, the client area and the monthly report.
// Totals across platforms are summed from the stored rows, not from these.

const key = (v) => `${v.published_on}|${String(v.title ?? "").trim().toLowerCase()}`;

/** @param {Record<string, any>[]} videos @returns {Record<string, any>[]} */
export function withFacebook(videos) {
  const facebook = new Map();
  for (const v of videos) if (v.platform === "facebook" && v.title && !facebook.has(key(v))) facebook.set(key(v), v);
  return videos.map((v) => {
    const fb = v.platform === "instagram" && v.title && facebook.get(key(v));
    return fb && fb.views != null ? { ...v, views: (v.views ?? 0) + fb.views } : v;
  });
}

// Views per platform, Instagram including its Facebook copies.
export function platformViews(videos) {
  const views = new Map();
  for (const v of withFacebook(videos)) views.set(v.platform, (views.get(v.platform) ?? 0) + (v.views ?? 0));
  return views;
}
