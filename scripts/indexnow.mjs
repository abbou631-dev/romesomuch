// Tells Bing (and the other IndexNow engines: Yandex, Seznam, Naver) which pages
// changed, so a new article is crawled in minutes instead of days. ChatGPT search
// reads Bing's index, so this is what puts a fresh article within its reach.
//
// Input: changed repo paths on stdin, one per line (git diff --name-only), or
// URLs given as arguments. Waits for the Pages deploy before submitting.
//
//   git diff --name-only A B | node scripts/indexnow.mjs
//   node scripts/indexnow.mjs https://romesomuch.com/vsl
const HOST = "romesomuch.com";
const KEY = "f5c027dc4b593507e49f21c0b69f1885"; // public by design: public/<KEY>.txt
const SITE = `https://${HOST}`;

const fromPaths = (paths) => {
  const urls = new Set();
  for (const p of paths) {
    let m;
    if ((m = p.match(/^src\/content\/journal\/([a-z0-9-]+)\.md$/))) {
      urls.add(`${SITE}/journal/${m[1]}/`).add(`${SITE}/journal/`);
    } else if ((m = p.match(/^src\/content\/experiences\/([a-z0-9-]+)\.md$/))) {
      urls.add(`${SITE}/experience/${m[1]}/`);
    }
  }
  return [...urls];
};

const readStdin = async () => {
  if (process.stdin.isTTY) return "";
  let s = "";
  for await (const chunk of process.stdin) s += chunk;
  return s;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const urls = args.length ? args : fromPaths((await readStdin()).split("\n").map((l) => l.trim()).filter(Boolean));
if (!urls.length) {
  console.log("IndexNow: no page changed, nothing to send.");
  process.exit(0);
}

// From stdin the push has only just reached GitHub: give Cloudflare Pages time to
// build, then wait until every new page answers (a deleted one stays 404, fine).
if (!args.length) {
  await sleep(180_000);
  for (let i = 0; i < 20; i++) {
    const codes = await Promise.all(urls.map((u) => fetch(u, { redirect: "manual" }).then((r) => r.status, () => 0)));
    if (codes.every((c) => c !== 0 && c !== 404 && c < 500)) break;
    await sleep(30_000);
  }
}

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList: urls }),
});
console.log(`IndexNow ${res.status} for ${urls.length} URL(s):\n${urls.join("\n")}`);
// 200 and 202 both mean accepted; anything else is reported but never fails the deploy.
if (![200, 202].includes(res.status)) console.log(await res.text());
