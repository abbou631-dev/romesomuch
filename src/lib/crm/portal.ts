// The client area: one venue's videos, documents and an estimate of the
// customers they brought, over /api/portal (functions/api/portal). Metrics
// older than 15 minutes are read again from the platforms when a month opens.

import {
  type Row, apiFor, esc, eur, num, short, day, month, shortMonth, ago, thisMonth, head, kpi, table, bars, platform,
} from "./ui";

const api = apiFor("/api/portal", "/area-clienti/login/");
const view = document.getElementById("view")!;

// The agency's rule of thumb: about one new customer every 5,000 views.
const VIEWS_PER_CUSTOMER = 5000;
const customers = (views: number) => Math.round(views / VIEWS_PER_CUSTOMER);

let data: Row;
let selected = thisMonth();

const delta = (now: number, before: number) => {
  if (!before) return "";
  const change = Math.round(((now - before) / before) * 100);
  if (!change) return `<span class="delta">= mese prima</span>`;
  return `<span class="delta ${change > 0 ? "up" : "down"}">${change > 0 ? "+" : ""}${change}% sul mese prima</span>`;
};
const interactionsOf = (m: Row) => (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0);

// "Ciao Marco" (the person signed in, else the venue's contact), then the
// venue and its package.
function greeting() {
  const c = data.client;
  const done = data.totals.videos;
  const parts = [
    `<strong>${esc(c.name)}</strong>`,
    c.videos_total ? `Visibilità costante: ${done} di ${c.videos_total} video pubblicati` : `Visibilità costante: ${done} video pubblicati`,
    c.end_date ? `contratto fino al ${day(c.end_date)}` : "",
  ].filter(Boolean);
  const first = String(c.user_name || c.contact || c.name).split(" ")[0];
  return head(`Ciao ${esc(first)}`, "", parts.join(" · "));
}

const tabs = (on: string) => `<nav class="tabs" aria-label="Sezioni">${[
  ["#/", "Andamento"], ["#/documenti", "I tuoi documenti"], ["#/previsioni", "Previsioni"],
].map(([href, label]) => `<a href="${href}"${href === on ? ' class="on" aria-current="page"' : ""}>${label}</a>`).join("")}</nav>`;

// ---- Andamento ---------------------------------------------------------------

function card(v: Row) {
  return `<article class="video">
    <a class="thumb${v.thumbnail ? "" : " empty"}" href="${esc(v.url)}" target="_blank" rel="noopener" ${v.thumbnail ? `style="background-image:url('${esc(v.thumbnail)}')"` : ""}>
      ${platform(v.platform)}${v.thumbnail ? "" : '<span class="none">Anteprima non disponibile</span>'}
    </a>
    <div class="body">
      <small class="mute">${day(v.published_on)}</small>
      <span class="title">${esc(v.title || "Video")}</span>
      <span><span class="big">${short(v.views)}</span> <small class="mute">visualizzazioni</small></span>
      <div class="stats">
        <span>Raggiunti <b>${num(v.reach)}</b></span><span>Mi piace <b>${num(v.likes)}</b></span>
        <span>Commenti <b>${num(v.comments)}</b></span><span>Condivisioni <b>${num(v.shares)}</b></span>
        ${v.saves != null ? `<span>Salvataggi <b>${num(v.saves)}</b></span>` : ""}
      </div>
      <a class="link" href="${esc(v.url)}" target="_blank" rel="noopener">Guarda il video →</a>
    </div>
  </article>`;
}

async function overview() {
  const months: Row[] = data.months;
  const index = months.findIndex((m) => m.month === selected);
  const current = months[index] ?? { videos: 0, views: 0, reach: 0 };
  const before = months[index - 1] ?? { videos: 0, views: 0, reach: 0 };

  view.innerHTML = `${greeting()}${tabs("#/")}
    <nav class="months" aria-label="Mese">${[...months].reverse().map((m) =>
      `<button type="button" data-month="${m.month}" class="${m.month === selected ? "on" : ""}">${esc(month(m.month))}</button>`).join("")}</nav>
    <section class="kpis">
      ${kpi("Video pubblicati", String(current.videos), esc(month(selected)))}
      ${kpi("Visualizzazioni", short(current.views), delta(current.views, before.views))}
      ${kpi("Account raggiunti", short(current.reach), delta(current.reach, before.reach))}
      ${kpi("Interazioni", short(interactionsOf(current)), delta(interactionsOf(current), interactionsOf(before)) || "mi piace, commenti, condivisioni, salvataggi")}
    </section>
    <section class="panel"><h2>Andamento mese per mese</h2>
      ${bars(months.map((m) => ({ key: m.month, label: shortMonth(m.month), value: m.views, title: `${month(m.month)}: ${num(m.views)} visualizzazioni, ${m.videos} video` })), selected, "data-month")}
      ${table(["Mese", "Video", "Visualizzazioni", "Raggiunti", "Interazioni"], [...months].reverse().map((m) =>
        `<tr${m.month === selected ? ' class="on"' : ""}><td>${esc(month(m.month))}</td><td class="num">${m.videos}</td><td class="num">${num(m.views)}</td><td class="num">${num(m.reach)}</td><td class="num">${num(interactionsOf(m))}</td></tr>`), "")}
    </section>
    <section class="panel"><div class="panel-head"><h2>I video di ${esc(month(selected))}</h2><span class="live" id="live">aggiornamento…</span></div>
      <div id="videos"><p class="empty">Caricamento…</p></div>
    </section>`;

  const list = await api<Row[]>(`videos?month=${selected}`);
  const box = document.getElementById("videos");
  if (!box) return;
  box.innerHTML = list.length ? `<div class="videos">${list.map(card).join("")}</div>` : '<p class="empty">Nessun video pubblicato in questo mese.</p>';
  const latest = list.map((v) => v.metrics_at).filter(Boolean).sort().at(-1);
  document.getElementById("live")!.textContent = latest ? `Metriche aggiornate ${ago(latest)}` : "Metriche inserite dal team";
}

// ---- I tuoi documenti ----------------------------------------------------------

async function documents() {
  view.innerHTML = `${greeting()}${tabs("#/documenti")}<p class="empty">Caricamento…</p>`;
  const docs = await api<Row[]>("documents");
  const group = (kind: string, title: string, empty: string, withAmount = false) => {
    const rows = docs.filter((d) => d.kind === kind);
    return `<section class="panel"><h2>${title}</h2>${rows.length ? `<ul class="docs">${rows.map((d) => `<li>
      <a href="/api/portal/files/${d.id}" target="_blank" rel="noopener"><span class="doc-icon" aria-hidden="true">${esc((d.file_name?.split(".").pop() || "doc").slice(0, 4))}</span>
      <span><strong>${esc(d.name)}</strong><small>${day(d.doc_date || d.uploaded_at)}${withAmount && d.amount ? ` · ${eur(d.amount)}` : ""}</small></span></a>
      <a class="link" href="/api/portal/files/${d.id}" target="_blank" rel="noopener">Apri</a></li>`).join("")}</ul>` : `<p class="empty">${empty}</p>`}</section>`;
  };
  view.innerHTML = `${greeting()}${tabs("#/documenti")}
    ${group("contratto", "Contratti", "Il contratto sarà caricato qui dal team.")}
    ${group("fattura", "Fatture emesse", "Ancora nessuna fattura.", true)}
    ${docs.some((d) => d.kind === "altro") ? group("altro", "Altri documenti", "") : ""}`;
}

// ---- Previsioni ------------------------------------------------------------------

function forecast() {
  const c = data.client;
  const months: Row[] = data.months;
  const views = data.totals.views;
  const done = data.totals.videos;
  const average = done ? views / done : 0;
  const left = Math.max(0, (c.videos_total || 0) - done);
  const thisOne = months.find((m) => m.month === thisMonth()) ?? { views: 0 };
  let running = 0;
  const rows: Row[] = months.map((m) => ({ ...m, customers: customers(m.views), total: customers((running += m.views)) }));

  view.innerHTML = `${greeting()}${tabs("#/previsioni")}
    <section class="kpis">
      ${kpi("Possibili nuovi clienti finora", `~${num(customers(views))}`, `da ${short(views)} visualizzazioni`, "good")}
      ${kpi("Questo mese", `~${num(customers(thisOne.views))}`, `${short(thisOne.views)} visualizzazioni`)}
      ${left ? kpi("Entro fine contratto", `~${num(customers(views + left * average))}`, `se i ${left} video mancanti vanno come la media (${short(average)} visualizzazioni)`) : ""}
    </section>
    <section class="panel"><h2>Possibili clienti mese per mese</h2>
      ${bars(rows.map((m) => ({ key: m.month, label: shortMonth(m.month), value: m.customers, title: `${month(m.month)}: ~${m.customers} clienti da ${num(m.views)} visualizzazioni` })), thisMonth())}
      ${table(["Mese", "Visualizzazioni", "Possibili clienti", "Totale dall'inizio"], [...rows].reverse().map((m) =>
        `<tr><td>${esc(month(m.month))}</td><td class="num">${num(m.views)}</td><td class="num">~${num(m.customers)}</td><td class="num"><strong>~${num(m.total)}</strong></td></tr>`), "")}
    </section>
    <p class="explain">È una stima, non un dato misurato: dalla nostra esperienza, in media ogni ${num(VIEWS_PER_CUSTOMER)} visualizzazioni portano circa un nuovo cliente nel locale. Il numero reale dipende dal locale, dal periodo e dal tipo di video.</p>`;
}

// ---- routing -------------------------------------------------------------------

const fail = (error: Error) => (view.innerHTML = `<p class="empty">Impossibile caricare: ${esc(error.message)}</p>`);

function render() {
  const route = location.hash.replace(/^#\/?/, "");
  const work = route === "documenti" ? documents() : route === "previsioni" ? Promise.resolve(forecast()) : overview();
  work.catch(fail);
}

view.addEventListener("click", (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>("[data-month]");
  if (!el || el.dataset.month === selected) return;
  selected = el.dataset.month!;
  overview().catch(fail);
});

export async function start() {
  try {
    data = await api("overview");
    document.getElementById("who")!.textContent = data.client.name;
    if (data.client.preview) {
      // The agency looking through the client's eyes.
      const bar = document.createElement("div");
      bar.className = "preview-bar";
      bar.innerHTML = `<span>Anteprima: stai vedendo l'area clienti di <strong>${esc(data.client.name)}</strong> come la vede il cliente.</span>
        <form method="post" action="/api/portal/logout"><button type="submit" class="link">Torna al CRM</button></form>`;
      document.body.prepend(bar);
    }
    addEventListener("hashchange", render);
    render();
  } catch (error) {
    fail(error as Error);
  }
}
