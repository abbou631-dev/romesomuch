// The CRM's Tour section (/crm/tour/): bookings made on the site, with edit,
// cancel and refund, and the settings of each experience. A hash-routed app
// over /api/crm/tours (server/tours.js), owner only.

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
    : `<td class="num">${eur(b.total_cents)}</td><td class="num">${eur(b.paid_cents - b.refunded_cents)}</td><td class="num"><strong>${eur(balance(b))}</strong></td>`;
  const actions = scope === "cancelled"
    ? (refundable(b) > 0 ? `<button class="link" data-cancel="${b.id}">Rimborsa</button>` : "")
    : `<button class="link" data-edit="${b.id}">Modifica</button><button class="link" data-resend="${b.id}">Rimanda email</button><button class="link danger" data-cancel="${b.id}">Cancella</button>`;
  return `<tr>
    <td>${when(b)}</td>
    <td>${esc(b.title)}</td>
    <td><strong>${esc(b.name)}</strong><br /><small class="mute">${contact}</small>${b.source ? `<br /><small>Ci ha conosciuti: ${esc((SOURCES as Record<string, string>)[b.source] ?? b.source)}</small>` : ""}${b.notes ? `<br /><small>${esc(b.notes)}</small>` : ""}</td>
    <td class="num">${b.guests}</td>
    ${money}
    <td style="white-space:nowrap"><small class="mute">${esc(b.code)}</small></td>
    <td class="row-actions">${actions}</td>
  </tr>`;
}

async function bookingsView() {
  const params = new URLSearchParams({ scope, ...(slug ? { slug } : {}), ...(query ? { q: query } : {}) });
  const [sum, list] = await Promise.all([api<Row>("tours/summary"), api<Row[]>(`tours/bookings?${params}`)]);
  bookings = list;
  const heads = scope === "cancelled"
    ? ["Quando", "Esperienza", "Cliente", "Ospiti", "Pagato", "Rimborsato", "Codice", ""]
    : ["Quando", "Esperienza", "Cliente", "Ospiti", "Totale", "Deposito", "Saldo sul posto", "Codice", ""];
  view.innerHTML = `${head("Prenotazioni", "", "Il cliente paga il deposito online; il saldo lo paga sul posto")}
    <div class="kpis">
      ${kpi("Oggi", String(sum.today_n), `${sum.today_guests} ospiti`)}
      ${kpi("Prossimi 7 giorni", String(sum.week_n), `${sum.week_guests} ospiti`)}
      ${kpi("Depositi del mese", eur(sum.deposits_month), "incassati meno rimborsi")}
      ${kpi("Saldi da incassare", eur(sum.balance_due), "sul posto, prenotazioni future")}
    </div>
    ${sum.sources.length ? `<p class="sub" style="margin:-4px 0 16px">Come ci hanno conosciuti, questo mese: ${sum.sources.map((x: Row) => `<strong>${esc(x.label)}</strong> ${x.n}`).join(" · ")}</p>` : ""}
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

function tourCard(t: Row) {
  return `<section class="panel tour-set">
    <div class="panel-head"><h2>${esc(t.title)} ${t.active ? badge("attivo", "In vendita") : badge("concluso", "Ferma")}</h2>
      <button class="btn small" data-tour="${esc(t.slug)}">Modifica</button></div>
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
    <h3 style="margin-top:16px">Giorni chiusi</h3>
    <div class="closures">${t.closures.map((d: string) =>
      `<span class="chip">${day(d)} <button class="link" data-open-day="${esc(t.slug)}|${d}" aria-label="Riapri ${day(d)}">✕</button></span>`).join("") || '<span class="mute">Nessuno</span>'}</div>
    <div class="filters" style="margin:10px 0 0"><label>Chiudi un giorno<input type="date" min="${today()}" data-close-day="${esc(t.slug)}" /></label></div>
  </section>`;
}

function toursView() {
  view.innerHTML = `${head("Esperienze", "", "Prezzi, deposito, orari e capienza delle prenotazioni sul sito. Il prezzo sulle card del sito si cambia anche dal CMS.")}
    ${tours.map(tourCard).join("")}`;
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
  const route = location.hash.replace(/^#\/?/, "").split("?")[0].split("/")[0];
  document.querySelectorAll<HTMLAnchorElement>("[data-nav]").forEach((a) =>
    a.classList.toggle("on", a.getAttribute("href")!.replace(/^#\/?/, "") === route));
  try {
    tours = await api<Row[]>("tours/catalog");
    if (route === "esperienze") toursView();
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
