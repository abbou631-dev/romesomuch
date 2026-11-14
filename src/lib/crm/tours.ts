// The CRM's Tour section (/crm/tour/): bookings made on the site, with edit,
// cancel and refund, the settings of each experience, and the golf cart
// partner's back office. A hash-routed app over /api/crm/tours
// (server/tours.js), owner only. Money is the owner's: the deposits that
// reached Stripe; the balance goes to the operator on the day.

import { type Field, type Row, apiFor, say, form, esc, eur, day, today, head, kpi, table, stackTables, badge } from "./ui";
import { SOURCES } from "../../../server/tour-sources.js";

const api = apiFor("/api/crm", "/crm/login/");
const view = document.getElementById("view")!;

const SCOPES = { upcoming: "Prossime", past: "Passate", cancelled: "Cancellate" } as Record<string, string>;
const DAYS: [string, string][] = [["1", "Lun"], ["2", "Mar"], ["3", "Mer"], ["4", "Gio"], ["5", "Ven"], ["6", "Sab"], ["0", "Dom"]];
const UNIT = { person: "a persona", group: "a gruppo / barca" } as Record<string, string>;

let scope = "upcoming";
let slug = "";
let query = "";
let tours: Row[] = [];
let bookings: Row[] = [];
let sum: Row = {};
// A tap on an experience opens its settings form straight away.
let editNext = "";

// One line icon per experience (24px grid, drawn with currentColor).
const ICONS: Record<string, string> = {
  "vespa-tour": '<circle cx="5.5" cy="17" r="2.5"/><circle cx="18.5" cy="17" r="2.5"/><path d="M8 17h8l2-6h-3.5l-1.5 6"/><path d="M18 11 16.5 5H19"/><path d="M3 14.5h6.5l1-3.5H4"/>',
  "vespa-sidecar-tour": '<circle cx="5" cy="18" r="2"/><circle cx="14" cy="18" r="2"/><path d="M7 18h5l1.5-5H11"/><path d="M13.5 13 12.5 8h2"/><path d="M16 14h5a1 1 0 0 1 1 1v.5A3.5 3.5 0 0 1 18.5 19H16"/><path d="M2 15h5"/>',
  "tiber-cruise": '<path d="M3 14h18l-2.5 4h-13z"/><path d="M6 14v-4h8.5l3 4"/><path d="M9 10V7h4v3"/><path d="M2 21c1.7 0 2.5-1 4-1s2.3 1 4 1 2.5-1 4-1 2.3 1 4 1 2.3-1 4-1"/>',
  "pasta-cooking-class": '<path d="M3 12h18a9 9 0 0 1-18 0z"/><path d="M7.5 12c0-3 2-3.5 2-6.5M12 12c0-3 2-3.5 2-6.5M16.5 12c0-2.5 1.5-3 1.5-5.5"/>',
  "roman-mosaic-class": '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="5" rx="1"/><rect x="13" y="10" width="8" height="11" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/>',
  "micromosaic-jewelry-class": '<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20"/><path d="M12 21 8 9l4-6 4 6z"/>',
};
const PIN = '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>';
// "How did you hear about us?": one colour per platform, the same in the
// rows and in the summary (.pf-* in crm.css).
const sourceTag = (key?: string | null) => {
  const k = key && (SOURCES as Record<string, string>)[key] ? key : "none";
  return `<span class="pf pf-${k}">${esc((SOURCES as Record<string, string>)[k] ?? "Non indicato")}</span>`;
};
function sourcesPanel(title: string, rows: Row[]) {
  const total = rows.reduce((a, r) => a + r.n, 0);
  if (!total) return `<div><h3>${title}</h3><p class="empty">Ancora nessuna prenotazione.</p></div>`;
  return `<div><h3>${title} <small class="mute">${total} prenotazioni</small></h3>${rows.map((r) => {
    const pct = Math.round((r.n / total) * 100);
    return `<div class="src-row">${sourceTag(r.key)}<span class="src-bar"><i class="pf-${r.key}" style="width:${pct}%"></i></span><span class="src-n">${r.n} · ${pct}%</span></div>`;
  }).join("")}</div>`;
}

const icon = (slug: string, size = 20) =>
  `<svg class="tour-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[slug] ?? PIN}</svg>`;

const balance = (b: Row) => b.total_cents - b.paid_cents;
const refundable = (b: Row) => b.paid_cents - b.refunded_cents;
const when = (b: Row) => `${day(b.date)} · ${esc(b.time)}`;
// The browser runs on the owner's clock, which is Rome's.
const hoursTo = (b: Row) => (new Date(`${b.date}T${b.time}:00`).getTime() - Date.now()) / 3600e3;

// ---- Prenotazioni ------------------------------------------------------------------

function row(b: Row) {
  // WhatsApp opens a chat (digits only, a leading 00 dropped, as on the UGC page).
  const wa = b.whatsapp === 1 && b.phone ? ` · <a href="https://wa.me/${String(b.phone).replace(/\D/g, "").replace(/^00/, "")}" target="_blank" rel="noopener">WhatsApp</a>` : "";
  const contact = [b.email, b.phone].filter(Boolean).map((x) => esc(x)).join(" · ") + wa;
  const money = scope === "cancelled"
    ? `<td class="num">${eur(b.paid_cents)}</td><td class="num">${eur(b.refunded_cents)}</td>`
    : `<td class="num"><strong>${eur(b.paid_cents - b.refunded_cents)}</strong><br /><small class="mute">su ${eur(b.total_cents)} · ${eur(balance(b))} sul posto</small></td>`;
  const actions = scope === "cancelled"
    ? (refundable(b) > 0 ? `<button class="link" data-cancel="${b.id}">Rimborsa</button>` : "")
    : `<button class="link" data-edit="${b.id}">Modifica</button><button class="link" data-resend="${b.id}">Rimanda email</button><button class="link danger" data-cancel="${b.id}">Cancella</button>`;
  return `<tr>
    <td>${when(b)}</td>
    <td><span class="tour-name">${icon(b.slug)}${esc(b.title)}</span></td>
    <td><strong>${esc(b.name)}</strong><br /><small class="mute">${contact}</small><br />${sourceTag(b.source)}${b.notes ? `<br /><small>${esc(b.notes)}</small>` : ""}</td>
    <td class="num">${b.guests}</td>
    ${money}
    <td style="white-space:nowrap"><small class="mute">${esc(b.code)}</small></td>
    <td class="row-actions">${actions}</td>
  </tr>`;
}

async function bookingsView() {
  const params = new URLSearchParams({ scope, ...(slug ? { slug } : {}), ...(query ? { q: query } : {}) });
  const list = await api<Row[]>(`tours/bookings?${params}`);
  bookings = list;
  const heads = scope === "cancelled"
    ? ["Quando", "Esperienza", "Cliente", "Ospiti", "Deposito pagato", "Rimborsato", "Codice", ""]
    : ["Quando", "Esperienza", "Cliente", "Ospiti", "Deposito incassato", "Codice", ""];
  view.innerHTML = `${head("Prenotazioni", "", "Qui conta il deposito: è quello che entra su Stripe. Il saldo lo incassa chi fa il tour.")}
    <div class="kpis">
      ${kpi("Depositi incassati, ultimi 7 giorni", eur(sum.deposits_week), "entrati su Stripe, meno i rimborsi", "good")}
      ${kpi("Depositi incassati, mese", eur(sum.deposits_month), "dal 1° del mese", "good")}
      ${kpi("Depositi incassati, anno", eur(sum.deposits_year), "dal 1° gennaio")}
      ${kpi("Oggi", String(sum.today_n), `${sum.today_guests} ospiti`)}
      ${kpi("Prossimi 7 giorni", String(sum.week_n), `${sum.week_guests} ospiti`)}
    </div>
    <p class="sub sold">Tour venduti questo mese: <strong>${sum.sold_month}</strong> · valore dei tour ${eur(sum.sold_month_value)}</p>
    <section class="panel sources"><h2>Come ci hanno conosciuti</h2>
      <div class="grid2">${sourcesPanel("Questo mese", sum.sources)}${sourcesPanel("Da sempre", sum.sources_all)}</div>
    </section>
    <nav class="months" aria-label="Elenco">${Object.entries(SCOPES).map(([k, l]) =>
      `<button type="button" data-scope="${k}" class="${k === scope ? "on" : ""}">${l}</button>`).join("")}</nav>
    <div class="filters">
      <label>Esperienza<select data-slug><option value="">Tutte</option>${tours.map((t) =>
        `<option value="${esc(t.slug)}"${t.slug === slug ? " selected" : ""}>${esc(t.title)}</option>`).join("")}</select></label>
      <label>Cerca<input type="search" data-q value="${esc(query)}" placeholder="Nome, email, telefono, codice" /></label>
    </div>
    <section class="panel">${table(heads, list.map(row), scope === "upcoming" ? "Nessuna prenotazione in arrivo." : "Niente qui.", "", true)}</section>`;
}

function editBooking(b: Row) {
  const fields: Field[] = [
    { name: "date", label: "Data", type: "date", required: true },
    { name: "time", label: "Orario", required: true, hint: "Come 09:30" },
    { name: "guests", label: "Ospiti", type: "number", min: 1, max: 100, required: true },
    { name: "total_cents", label: "Totale della prenotazione (€)", type: "money", hint: "Se cambi gli ospiti e lasci il totale com'è, viene ricalcolato col prezzo dell'esperienza" },
    { name: "name", label: "Nome", required: true },
    { name: "email", label: "Email", type: "email", required: true },
    { name: "phone", label: "Telefono", type: "tel", required: true },
    { name: "whatsapp", label: "Ha WhatsApp su questo numero?", type: "select", options: [["1", "Sì"], ["0", "No"]] },
    { name: "notes", label: "Note", type: "textarea" },
    { name: "notify", label: "Email", type: "checks", options: [["1", "Manda al cliente l'email con i nuovi dettagli"]] },
  ];
  form(`Modifica ${b.code}`, fields, { ...b, whatsapp: b.whatsapp == null ? "" : String(b.whatsapp), notify: ["1"] }, async (data) => {
    const { emailed } = await api<Row>(`tours/bookings/${b.id}`, {
      method: "PATCH", data: { ...data, guests: Number(data.guests), notify: data.notify.length > 0 },
    });
    if (data.notify.length && !emailed) say("Salvato, ma l'email non è partita", true);
  }, render);
}

function cancelBooking(b: Row) {
  const max = refundable(b);
  const already = b.status === "cancelled";
  // The site promises a free cancellation up to cancel_hours before the start.
  const free = hoursTo(b) >= (b.cancel_hours ?? 48);
  const fields: Field[] = [
    {
      name: "refund", label: `Rimborso (€), da 0 a ${eur(max)}`, type: "money",
      hint: already ? "Torna sulla carta del cliente con Stripe"
        : free ? `Mancano più di ${b.cancel_hours} ore: secondo le condizioni il deposito va rimborsato tutto`
        : `Mancano meno di ${b.cancel_hours} ore: secondo le condizioni non è dovuto nessun rimborso`,
    },
    { name: "notify", label: "Email", type: "checks", options: [["1", already ? "Avvisa il cliente del rimborso" : "Manda al cliente l'email di cancellazione"]] },
  ];
  const suggested = already ? max : free ? max : 0;
  form(already ? `Rimborso ${b.code}` : `Cancella ${b.code}`, fields, { refund: suggested, notify: ["1"] }, async (data) => {
    const refund = data.refund ?? 0;
    if (refund > max) throw new Error(`Il rimborso massimo è ${eur(max)}.`);
    const what = already
      ? `Rimborsare ${eur(refund)} a ${b.name}?`
      : `Cancellare la prenotazione di ${b.name} (${b.title}, ${day(b.date)} ${b.time})${refund ? ` e rimborsare ${eur(refund)} sulla sua carta` : " senza rimborso"}? Non si può annullare.`;
    if (!confirm(what)) throw new Error("Operazione annullata.");
    const { emailed } = await api<Row>(`tours/bookings/${b.id}/cancel`, { method: "POST", data: { refund_cents: refund, notify: data.notify.length > 0 } });
    if (data.notify.length && !emailed) say("Fatto, ma l'email non è partita", true);
  }, render);
}

// ---- Esperienze ----------------------------------------------------------------------

const weekdaysText = (w: string) => DAYS.filter(([k]) => w.includes(k)).map(([, l]) => l).join(" ");

function tile(t: Row) {
  const m = sum.by_tour?.[t.slug] ?? { n: 0, deposits: 0 };
  return `<a class="tour-tile${t.active ? "" : " off"}" href="#/esperienze/${esc(t.slug)}">
    <span class="ico">${icon(t.slug, 28)}</span>
    <strong>${esc(t.title)}</strong>
    <small>${eur(t.price_cents)} ${UNIT[t.unit] ?? ""} · deposito ${t.deposit_pct}%</small>
    <small class="mute">${t.active ? `Questo mese: ${m.n} venduti · ${eur(m.deposits)} di depositi` : "Ferma: non si vende sul sito"}</small>
  </a>`;
}

function toursView() {
  view.innerHTML = `${head("Esperienze", "", "Tocca un'esperienza per vederne e cambiarne le impostazioni. Le modifiche valgono subito anche sul sito.")}
    <div class="tour-tiles">${tours.map(tile).join("")}</div>`;
}

function tourView(t: Row) {
  view.innerHTML = `<p class="crumb"><a href="#/esperienze">← Esperienze</a></p>
    ${head(`${t.title}`, `<button class="btn" data-sample="${esc(t.slug)}">Email di prova</button><button class="btn primary" data-tour="${esc(t.slug)}">Modifica impostazioni</button>`, t.active ? "In vendita sul sito" : "Ferma: non si vende sul sito")}
    <section class="panel tour-set">
    <div class="panel-head"><h2><span class="tour-name">${icon(t.slug, 24)}Impostazioni</span></h2></div>
    <dl class="info">
      <dt>Prezzo</dt><dd>${eur(t.price_cents)} ${UNIT[t.unit] ?? ""}</dd>
      <dt>Deposito online</dt><dd>${t.deposit_pct}% · il resto sul posto</dd>
      <dt>Capienza</dt><dd>${t.capacity} ${t.unit === "group" ? (t.capacity === 1 ? "gruppo" : "gruppi") : "posti"} per orario · massimo ${t.max_guests} ospiti a prenotazione</dd>
      <dt>Orari</dt><dd>${t.times.map(esc).join(" · ")}</dd>
      <dt>Giorni</dt><dd>${weekdaysText(t.weekdays)}</dd>
      <dt>Chiusura vendite</dt><dd>${t.cutoff_hours} ore prima</dd>
      <dt>Cancellazione gratuita</dt><dd>fino a ${t.cancel_hours} ore prima</dd>
      <dt>Punto d'incontro</dt><dd>${esc(t.meeting_point ?? "—")}</dd>
    </dl>
    </section>
    <section class="panel">
    <h2>Giorni chiusi</h2>
    <div class="closures">${t.closures.map((d: string) =>
      `<span class="chip">${day(d)} <button class="link" data-open-day="${esc(t.slug)}|${d}" aria-label="Riapri ${day(d)}">✕</button></span>`).join("") || '<span class="mute">Nessuno</span>'}</div>
    <div class="filters" style="margin:10px 0 0"><label>Chiudi un giorno<input type="date" min="${today()}" data-close-day="${esc(t.slug)}" /></label></div>
    </section>`;
}

// The golf cart partner's back office (commissions, bookings, monthly report).
// It keeps its own password.
const GOLFCART = "https://romebycart.com/partners/romesomuch/admin.html";
function golfcartView() {
  view.innerHTML = `${head("Golf cart")}
    <section class="panel golftour">
      <div class="panel-head"><h2>Back office golf cart <small class="mute">commissioni, prenotazioni e resoconto</small></h2>
        <a class="btn small" href="${GOLFCART}" target="_blank" rel="noopener">Apri in una nuova scheda</a></div>
      <iframe src="${GOLFCART}" title="Back office golf cart"></iframe>
    </section>`;
}

function editTour(t: Row) {
  const fields: Field[] = [
    { name: "title", label: "Nome (nelle email e qui)", required: true },
    { name: "active", label: "In vendita sul sito", type: "select", options: [["1", "Sì"], ["0", "No, ferma"]] },
    { name: "price_cents", label: "Prezzo (€)", type: "money", required: true },
    { name: "unit", label: "Il prezzo è", type: "select", options: Object.entries(UNIT) },
    { name: "deposit_pct", label: "Deposito online (%)", type: "number", min: 1, max: 100, required: true },
    { name: "capacity", label: "Capienza per orario", type: "number", min: 1, max: 500, required: true, hint: "Posti; per i prezzi a gruppo, quanti gruppi (barche) per orario" },
    { name: "max_guests", label: "Massimo ospiti in una prenotazione", type: "number", min: 1, max: 500, required: true },
    { name: "times", label: "Orari di partenza", required: true, hint: "Separati da virgola: 09:30, 14:00" },
    { name: "weekdays", label: "Giorni", type: "checks", options: DAYS, required: true },
    { name: "cutoff_hours", label: "Chiudi le vendite ore prima", type: "number", min: 0, max: 720, required: true },
    { name: "cancel_hours", label: "Cancellazione gratuita fino a ore prima", type: "number", min: 0, max: 720, required: true },
    { name: "meeting_point", label: "Punto d'incontro (nelle email)" },
  ];
  form(t.title, fields, { ...t, times: t.times.join(", "), weekdays: t.weekdays.split(""), active: String(t.active) }, (data) =>
    api(`tours/catalog/${t.slug}`, { method: "PATCH", data: { ...data, weekdays: data.weekdays.join("") } }), render);
}

// ---- routing and events -------------------------------------------------------------

async function render() {
  const [route, arg] = location.hash.replace(/^#\/?/, "").split("?")[0].split("/");
  document.querySelectorAll<HTMLAnchorElement>("[data-nav]").forEach((a) =>
    a.classList.toggle("on", a.getAttribute("href")!.replace(/^#\/?/, "") === route));
  try {
    if (route === "golfcart") { golfcartView(); return; }
    [tours, sum] = await Promise.all([api<Row[]>("tours/catalog"), api<Row>("tours/summary")]);
    const tour = tours.find((t) => t.slug === arg);
    if (route === "esperienze" && tour) {
      tourView(tour);
      if (editNext === tour.slug) editTour(tour);
      editNext = "";
    }
    else if (route === "esperienze") toursView();
    else await bookingsView();
    stackTables(view);
  } catch (error) {
    view.innerHTML = `<p class="empty">Impossibile caricare: ${esc((error as Error).message)}</p>`;
  }
}

async function act(work: () => Promise<unknown>, done: string) {
  try {
    await work();
    say(done);
    render();
  } catch (error) {
    say((error as Error).message, true);
  }
}

view.addEventListener("click", (event) => {
  const tileLink = (event.target as HTMLElement).closest<HTMLAnchorElement>("a.tour-tile");
  if (tileLink) editNext = tileLink.getAttribute("href")!.split("/").pop()!;
  const el = (event.target as HTMLElement).closest<HTMLElement>("button");
  if (!el) return;
  const d = el.dataset;
  const booking = (id?: string) => bookings.find((b) => b.id === Number(id));
  if (d.scope) { scope = d.scope; render(); }
  else if (d.edit) { const b = booking(d.edit); if (b) editBooking(b); }
  else if (d.cancel) { const b = booking(d.cancel); if (b) cancelBooking(b); }
  else if (d.resend) {
    const b = booking(d.resend);
    if (b && confirm(`Rimandare l'email di conferma a ${b.email}?`)) {
      act(async () => { if (!(await api<Row>(`tours/bookings/${b.id}/resend`, { method: "POST", data: {} })).emailed) throw new Error("L'email non è partita"); }, "Email rimandata");
    }
  } else if (d.sample) {
    act(async () => {
      const r = await api<Row>(`tours/catalog/${d.sample}/sample-email`, { method: "POST", data: {} });
      if (!r.emailed) throw new Error("L'email non è partita");
    }, "Email di conferma di prova mandata alla casella delle notifiche");
  } else if (d.tour) { const t = tours.find((x) => x.slug === d.tour); if (t) editTour(t); }
  else if (d.openDay) {
    const [s, date] = d.openDay.split("|");
    act(() => api(`tours/catalog/${s}/closures/${date}`, { method: "DELETE" }), "Giorno riaperto");
  }
});

view.addEventListener("change", (event) => {
  const el = event.target as HTMLInputElement | HTMLSelectElement;
  if ("slug" in el.dataset) { slug = el.value; render(); }
  else if ("q" in el.dataset) { query = el.value.trim(); render(); }
  else if (el.dataset.closeDay && el.value) {
    act(() => api(`tours/catalog/${el.dataset.closeDay}/closures`, { method: "POST", data: { date: el.value } }), "Giorno chiuso: nessuno può più prenotarlo");
  }
});

export function start() {
  addEventListener("hashchange", render);
  render();
}
