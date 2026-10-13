// The client area: one venue's videos, month by month, over /api/portal
// (functions/api/portal). Metrics older than 15 minutes are read again from
// the platforms each time a month opens.

import { type Row, apiFor, esc, num, short, day, month, shortMonth, ago, thisMonth, head, kpi, table, bars, platform, interactions } from "./ui";

const api = apiFor("/api/portal", "/area-clienti/login/");
const view = document.getElementById("view")!;

let data: Row;
let selected = thisMonth();

const delta = (now: number, before: number) => {
  if (!before) return "";
  const change = Math.round(((now - before) / before) * 100);
  if (!change) return `<span class="delta">= mese prima</span>`;
  return `<span class="delta ${change > 0 ? "up" : "down"}">${change > 0 ? "+" : ""}${change}% sul mese prima</span>`;
};
const sumInteractions = (m: Row) => (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0);

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

async function render() {
  const months: Row[] = data.months;
  const index = months.findIndex((m) => m.month === selected);
  const current = months[index] ?? { videos: 0, views: 0, reach: 0 };
  const before = months[index - 1] ?? { videos: 0, views: 0, reach: 0 };
  const quota = data.client.videos_per_month;

  view.innerHTML = `
    ${head(`Ciao, ${esc(data.client.name)}`, "", `Pacchetto Visibilità costante${quota ? ` · ${quota} video al mese` : ""} · dall'inizio ${num(data.totals.videos)} video e ${short(data.totals.views)} visualizzazioni`)}
    <nav class="months" aria-label="Mese">${[...months].reverse().map((m) =>
      `<button type="button" data-month="${m.month}" class="${m.month === selected ? "on" : ""}">${esc(month(m.month))}</button>`).join("")}</nav>
    <section class="kpis">
      ${kpi("Video pubblicati", quota ? `${current.videos} / ${quota}` : String(current.videos), esc(month(selected)), quota && current.videos >= quota ? "good" : "")}
      ${kpi("Visualizzazioni", short(current.views), delta(current.views, before.views))}
      ${kpi("Account raggiunti", short(current.reach), delta(current.reach, before.reach))}
      ${kpi("Interazioni", short(sumInteractions(current)), delta(sumInteractions(current), sumInteractions(before)) || "mi piace, commenti, condivisioni, salvataggi")}
    </section>
    <section class="panel"><h2>Andamento mese per mese</h2>
      ${bars(months.map((m) => ({ key: m.month, label: shortMonth(m.month), value: m.views, title: `${month(m.month)}: ${num(m.views)} visualizzazioni, ${m.videos} video` })), selected, "data-month")}
      ${table(["Mese", "Video", "Visualizzazioni", "Raggiunti", "Interazioni"], [...months].reverse().map((m) =>
        `<tr${m.month === selected ? ' class="on"' : ""}><td>${esc(month(m.month))}</td><td class="num">${m.videos}</td><td class="num">${num(m.views)}</td><td class="num">${num(m.reach)}</td><td class="num">${num(sumInteractions(m))}</td></tr>`), "")}
    </section>
    <section class="panel"><div class="panel-head"><h2>I video di ${esc(month(selected))}</h2><span class="live" id="live">aggiornamento…</span></div>
      <div id="videos"><p class="empty">Caricamento…</p></div>
    </section>`;

  const list = await api<Row[]>(`videos?month=${selected}`);
  const box = document.getElementById("videos")!;
  box.innerHTML = list.length ? `<div class="videos">${list.map(card).join("")}</div>` : '<p class="empty">Nessun video pubblicato in questo mese.</p>';
  const latest = list.map((v) => v.metrics_at).filter(Boolean).sort().at(-1);
  document.getElementById("live")!.textContent = latest ? `Metriche aggiornate ${ago(latest)}` : "Metriche inserite dal team";
}

view.addEventListener("click", (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>("[data-month]");
  if (!el || el.dataset.month === selected) return;
  selected = el.dataset.month!;
  render().catch(fail);
});

const fail = (error: Error) => (view.innerHTML = `<p class="empty">Impossibile caricare: ${esc(error.message)}</p>`);

export async function start() {
  try {
    data = await api("overview");
    document.getElementById("who")!.textContent = data.client.name;
    await render();
  } catch (error) {
    fail(error as Error);
  }
}
