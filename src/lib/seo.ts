// Structured data (schema.org) for Journal articles, so search engines and AI
// assistants can read the article, its date and its questions without guessing.
import { postTime } from "./site";

const ORG = { "@type": "Organization", name: "RomeSoMuch", url: "https://romesomuch.com/" };

const plain = (md: string) =>
  md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links keep their text
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// The "## Good to know" section: every "### question" and the text under it.
export const faqFromBody = (body = ""): { q: string; a: string }[] => {
  const section = body.split(/^## Good to know\s*$/m)[1];
  if (!section) return [];
  const until = section.split(/^## /m)[0];
  return until
    .split(/^### /m)
    .slice(1)
    .map((block) => {
      const [q, ...rest] = block.split("\n");
      return { q: plain(q), a: plain(rest.join("\n")) };
    })
    .filter((item) => item.q && item.a);
};

const isoDate = (date: string) => {
  const t = postTime(date);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : undefined;
};

export const articleSchema = (o: {
  title: string;
  excerpt: string;
  date: string;
  url: string;
  image?: string;
  body?: string;
}) => {
  const words = plain(o.body ?? "").split(" ").filter(Boolean).length;
  const out: object[] = [
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: o.title,
      description: o.excerpt,
      datePublished: isoDate(o.date),
      dateModified: isoDate(o.date),
      mainEntityOfPage: o.url,
      url: o.url,
      ...(o.image && { image: [o.image] }),
      author: ORG,
      publisher: { ...ORG, logo: { "@type": "ImageObject", url: "https://romesomuch.com/favicon-192.png" } },
      inLanguage: "en",
      wordCount: words,
      about: { "@type": "City", name: "Rome", sameAs: "https://en.wikipedia.org/wiki/Rome" },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://romesomuch.com/" },
        { "@type": "ListItem", position: 2, name: "Journal", item: "https://romesomuch.com/journal/" },
        { "@type": "ListItem", position: 3, name: o.title, item: o.url },
      ],
    },
  ];
  const faq = faqFromBody(o.body);
  if (faq.length) {
    out.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    });
  }
  return out;
};
