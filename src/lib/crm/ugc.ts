// The UGC creators who applied from the site's /ugc/ form, as cards with
// filters. Shared by the CRM (/crm/b2b/#/ugc, every application with its contacts)
// and the client area (/area-clienti/#/ugc), where the server sends a
// creator's email, WhatsApp and full name only when they agreed to share them
// with partner venues; social handles are public and always shown.

import { type Row, esc, num, day, today, addDays, kpi } from "./ui";

// The form's follower bands, smallest first: their order is what "at least" compares.
const FOLLOWERS = ["Under 5k", "5k–20k", "20k–100k", "100k–500k", "Over 500k"];
const NICHES = ["Travel", "Food", "Lifestyle", "Couples", "Family", "Luxury", "Other"];
const INTEREST = { Experiences: "Esperienze", Restaurants: "Ristoranti", Both: "Entrambi" } as Record<string, string>;

// The page's filters; kept while moving around the page.
const filter = { q: "", followers: "", niche: "", interest: "", when: "", tiktok: false, sort: "recenti" };
let rows: Row[] = [];
let staff = false;

const band = (u: Row) => FOLLOWERS.indexOf(u.followers);
// "15k", "15.000", "1,2M" → a number, for sorting by views; text it cannot read counts as 0.
const viewsOf = (u: Row) => {
  const m = String(u.views ?? "").toLowerCase().replace(/\s/g, "").match(/(\d+(?:[.,]\d+)?)(k|m)?/);
  if (!m) return 0;
  const n = parseFloat(m[1].replace(/[.,](\d{3})$/, "$1").replace(",", "."));
  return n * (m[2] === "m" ? 1e6 : m[2] === "k" ? 1e3 : 1);
};
// In Rome at some point between two days (inclusive).
const inRome = (u: Row, from: string, to: string) => !!u.arrival && u.arrival <= to && (u.departure || u.arrival) >= from;
const WHEN: Record<string, [string, (u: Row) => boolean]> = {
  ora: ["A Roma adesso", (u) => inRome(u, today(), today())],
  "30": ["A Roma nei prossimi 30 giorni", (u) => inRome(u, today(), addDays(today(), 30))],
  futuri: ["Arrivano più avanti", (u) => (u.arrival ?? "") > today()],
  passati: ["Già ripartiti", (u) => !!u.departure && u.departure < today()],
};
const matches = (u: Row) => {
  const f = filter;
  if (f.followers && band(u) < Number(f.followers)) return false;
  if (f.niche && u.niche !== f.niche) return false;
  // Someone who wants both fits either search.
  if (f.interest && u.interest !== f.interest && u.interest !== "Both") return false;
  if (f.when && !WHEN[f.when][1](u)) return false;
  if (f.tiktok && !u.tiktok) return false;
  if (f.q) {
    const text = [u.name, u.email, u.whatsapp, u.country, u.instagram, u.tiktok, u.languages, u.message, u.party].join(" ").toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).every((word) => text.includes(word))) return false;
  }
  return true;
};
const SORT: Record<string, [string, (a: Row, b: Row) => number]> = {
  recenti: ["Più recenti", (a, b) => b.created_at.localeCompare(a.created_at)],
  follower: ["Più follower", (a, b) => band(b) - band(a) || viewsOf(b) - viewsOf(a)],
  views: ["Più views", (a, b) => viewsOf(b) - viewsOf(a)],
  arrivo: ["Arrivo più vicino", (a, b) => (a.arrival ?? "9999").localeCompare(b.arrival ?? "9999")],
};

// A handle or a pasted profile link, as "Instagram · @handle" linking to the
// profile. Only web addresses become links.
const profile = (value: string | null, base: string, label: string) => {
  if (!value) return "";
  const text = value.trim();
  const href = /^https?:\/\/\S+$/i.test(text) ? text : /^@?[\w.]+$/.test(text) ? `${base}${text.replace(/^@/, "")}` : "";
  if (!href) return `<span class="mute">${label}: ${esc(text)}</span>`;
  const handle = (href.replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop() ?? "").replace(/^@/, "");
  return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}${handle ? ` · @${esc(handle)}` : ""}</a>`;
};
// Free text where people paste links: the links become clickable, the rest stays text.
const linkify = (text: string | null) => esc(text ?? "").replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
const stay = (u: Row) => (u.arrival ? `${day(u.arrival)}${u.departure && u.departure !== u.arrival ? ` → ${day(u.departure)}` : ""}` : "—");

// Contacts: the email opens a Gmail draft, the number a WhatsApp chat
// (wa.me wants the digits only, country code first, no 00).
const gmail = (u: Row) => `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(u.email)}&su=${encodeURIComponent(staff ? "RomeSoMuch · UGC" : "Collaboration in Rome")}`;
const whatsapp = (u: Row) => {
  const digits = String(u.whatsapp ?? "").replace(/\D/g, "").replace(/^00/, "");
  return digits.length >= 7 ? `https://wa.me/${digits}` : "";
};

// One application as a card: who, the four numbers that matter, how to reach
// them, the rest folded away. The CRM adds the agency's own actions.
const card = (u: Row) => {
  const wa = whatsapp(u);
  // Social handles are public; email and WhatsApp come only when shared.
  const contacts = [
    u.email ? `<a class="btn small" href="${esc(gmail(u))}" target="_blank" rel="noopener noreferrer" title="Scrivi da Gmail">✉︎ ${esc(u.email)}</a>` : "",
    wa ? `<a class="btn small wa" href="${esc(wa)}" target="_blank" rel="noopener noreferrer">WhatsApp · ${esc(u.whatsapp)}</a>`
      : staff ? `<button class="link mute" data-edit="ugc" data-id="${u.id}">+ WhatsApp</button>` : "",
    profile(u.instagram, "https://www.instagram.com/", "Instagram"),
    profile(u.tiktok, "https://www.tiktok.com/@", "TikTok"),
  ].filter(Boolean);
  const facts: [string, string][] = [
    ["Follower", esc(u.followers ?? "—")], ["Views", esc(u.views ?? "—")],
    ["Nicchia", esc(u.niche ?? "—")], ["A Roma", stay(u)],
  ];
  const details: [string, string][] = ([
    ["Vuole provare", esc(INTEREST[u.interest] ?? u.interest ?? "")],
    ["Lavori migliori", linkify(u.portfolio)], ["Cosa consegnerebbe", esc(u.deliverables ?? "")], ["Chi viene", esc(u.party ?? "")],
    ["Lingue", esc(u.languages ?? "")], ["Messaggio", esc(u.message ?? "")],
  ] as [string, string][]).filter(([, v]) => v);
  const shared = staff
    ? `<small class="${u.share_contacts ? "pos" : "mute"}">${u.share_contacts ? "Contatti visibili ai locali" : "Contatti visibili solo a noi"}</small>`
    : "";
  return `<article class="creator">
    <header>
      <div><h3>${esc(u.name)}</h3><small class="mute">${u.country ? `${esc(u.country)} · ` : ""}ricevuta ${day(u.created_at)}</small></div>
      ${shared}
    </header>
    <dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
    <div class="contacts">${contacts.join("")}</div>
    ${details.length ? `<details class="ugc-more"><summary>Dettagli</summary><dl>${details.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></details>` : ""}
    ${staff ? `<footer>${wa ? `<button class="link" data-edit="ugc" data-id="${u.id}">Cambia numero</button>` : "<span></span>"}<button class="link danger" data-del="ugc" data-id="${u.id}">Elimina</button></footer>` : ""}
  </article>`;
};

// How many filters differ from the defaults, shown on the folded filter bar.
const active = () => Object.entries(filter).filter(([k, v]) => !["q", "sort"].includes(k) && v).length;
export function drawUgc() {
  const list = document.getElementById("ugc-list");
  if (!list) return;
  const shown = rows.filter(matches).sort(SORT[filter.sort][1]);
  const n = active();
  const count = document.getElementById("ugc-active");
  if (count) count.textContent = n ? String(n) : "";
  list.innerHTML = `<p class="sub">${shown.length} di ${rows.length} ${staff ? "candidature" : "creator"}</p>` +
    (shown.length ? `<div class="creators">${shown.map(card).join("")}</div>` : '<p class="empty">Nessun creator con questi filtri.</p>');
}

// The filter bar stays open on wide screens; on phones it folds under one line.
let filtersOpen = matchMedia("(min-width: 900px)").matches;

// KPIs, search, filters and the list holder for `list`; call mountUgc once it is on the page.
export function ugcSection(list: Row[], asStaff: boolean) {
  rows = list;
  staff = asStaff;
  const f = filter;
  const select = (key: string, label: string, options: [string, string][]) =>
    `<label>${label} <select data-ugc="${key}">${options.map(([k, l]) => `<option value="${esc(k)}"${String((f as Row)[key]) === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
  return `<div class="kpis">
      ${kpi(staff ? "Candidature" : "Creator", num(rows.length))}
      ${kpi("A Roma adesso", num(rows.filter(WHEN.ora[1]).length))}
      ${kpi("A Roma nei prossimi 30 giorni", num(rows.filter(WHEN["30"][1]).length))}
    </div>
    <div class="ugc-bar">
      <input type="search" data-ugc="q" value="${esc(f.q)}" placeholder="Cerca…" aria-label="Cerca" />
      ${select("sort", "Ordina", Object.entries(SORT).map(([k, [l]]) => [k, l] as [string, string]))}
    </div>
    <details class="ugc-filters" data-ugc-filters${filtersOpen ? " open" : ""}>
      <summary>Filtri <span id="ugc-active" class="count"></span></summary>
      <div class="filters">
        ${select("followers", "Follower almeno", [["", "Qualsiasi"], ...FOLLOWERS.map((b, i) => [String(i), b] as [string, string]).slice(1)])}
        ${select("niche", "Nicchia", [["", "Tutte"], ...NICHES.map((n) => [n, n] as [string, string])])}
        ${select("interest", "Vuole provare", [["", "Qualsiasi"], ["Experiences", "Esperienze"], ["Restaurants", "Ristoranti"]])}
        ${select("when", "Quando a Roma", [["", "Sempre"], ...Object.entries(WHEN).map(([k, [l]]) => [k, l] as [string, string])])}
        <label class="check"><input type="checkbox" data-ugc="tiktok"${f.tiktok ? " checked" : ""} /> Ha TikTok</label>
      </div>
    </details>
    <div id="ugc-list"></div>`;
}

export function mountUgc(view: HTMLElement) {
  view.querySelector("[data-ugc-filters]")!.addEventListener("toggle", (e) => { filtersOpen = (e.target as HTMLDetailsElement).open; });
  drawUgc();
}

// The filters redraw only the list, so typing in the search box keeps its focus.
// Listen with it on the page's view for "input".
export function ugcInput(event: Event) {
  const el = event.target as HTMLInputElement | HTMLSelectElement;
  const key = el.dataset.ugc;
  if (!key) return;
  (filter as Row)[key] = el instanceof HTMLInputElement && el.type === "checkbox" ? el.checked : el.value;
  drawUgc();
}
