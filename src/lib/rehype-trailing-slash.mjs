// Site pages live at directory URLs (`build.format: "directory"`), so
// `/journal/x` answers with a 301 to `/journal/x/`. Google reports every such
// link as "Page with redirect" and spends crawl budget on it. Articles are
// written by hand and by the Journal agents, so the slash is added here, once,
// for every internal link in Markdown, instead of trusting each author.
const NEEDS_SLASH = /^\/(?!api\/|media\/|_astro\/)[^?#]*[^/?#.][^/?#]*$/;
const LAST_SEGMENT_HAS_DOT = /\.[^/]*$/;

function fix(href) {
  const base = href.replace(/^https:\/\/(www\.)?romesomuch\.com(?=\/)/, "");
  const [, path, rest] = base.match(/^([^?#]*)(.*)$/);
  if (!NEEDS_SLASH.test(path) || LAST_SEGMENT_HAS_DOT.test(path)) return href;
  return `${path}/${rest}`;
}

function walk(node) {
  if (node.type === "element" && node.tagName === "a" && typeof node.properties?.href === "string") {
    node.properties.href = fix(node.properties.href);
  }
  node.children?.forEach(walk);
}

export default function rehypeTrailingSlash() {
  return walk;
}
