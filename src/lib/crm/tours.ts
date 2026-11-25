// The CRM's Tour section (/crm/tour/): bookings made on the site, with edit,
// cancel and refund, the settings of each experience, and the golf cart
// partner's back office. A hash-routed app over /api/crm/tours
// (server/tours.js), owner only. Money is the owner's: the deposits that
// reached Stripe; the balance goes to the operator on the day.

import { type Field, type Row, apiFor, say, form, esc, eur, day, today, head, kpi, table, stackTables, badge } from "./ui";
import { SOURCES } from "../../../server/tour-sources.js";
import { cancelPolicy, refundShare } from "../../../server/tour-policy.js";

const api = apiFor("/api/crm", "/crm/login/");
const view = document.getElementById("view")!;

const SCOPES = { requested: "Da accettare", upcoming: "Prossime", past: "Passate", cancelled: "Cancellate" } as Record<string, string>;
const DAYS: [string, string][] = [["1", "Lun"], ["2", "Mar"], ["3", "Mer"], ["4", "Gio"], ["5", "Ven"], ["6", "Sab"], ["0", "Dom"]];
const UNIT = { person: "a persona", group: "a gruppo / barca" } as Record<string, string>;

let scope = "upcoming";
let slug = "";
let query = "";
// Order of the list: by tour date (next first) or newest bookings first.
let sort = "date";
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
ICONS["coccio-ceramics-class"] = '<path d="M8 3h8"/><path d="M9 3v3c-3 1.5-5 4.5-5 8a8 8 0 0 0 16 0c0-3.5-2-6.5-5-8V3"/><path d="M5 13h14"/>';
ICONS["private-vatican-museums-tour"] = '<path d="M4 20h16"/><path d="M5 20v-8M9 20v-8M15 20v-8M19 20v-8"/><path d="M3 12h18"/><path d="M5 12a7 7 0 0 1 14 0"/><path d="M12 5V3"/>';
ICONS["private-colosseum-tour"] = '<ellipse cx="12" cy="8" rx="9" ry="3"/><path d="M3 8v9c0 1.7 4 3 9 3s9-1.3 9-3V8"/><path d="M7 11v7M12 11.5v8M17 11v7"/>';
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

const balance = (b: Row) => Math.max(0, b.total_cents - b.paid_cents - (b.gift_cents ?? 0));
// Stripe drops an authorisation it was never asked to capture after 7 days.
const authEnds = (b: Row) => new Date(new Date(`${String(b.created_at).replace(" ", "T")}Z`).getTime() + 7 * 864e5).toISOString().slice(0, 10);
// Extras as typed in the form: "Classic Italian Gourmet Basket = 50" per line.
const extrasText = (list: { name: string; price_cents: number }[]) => list.map((x) => `${x.name} = ${x.price_cents / 100}`).join("\n");
const extrasList = (raw: string | null) => (raw ? JSON.parse(raw) as { name: string; price_cents: number }[] : []);
const tiersText = (tiers: Record<string, number> | null) => tiers
  ? Object.entries(tiers).map(([n, c]) => `${n}=${c / 100}`).join(", ") : "";
const depositText = (t: Row) => t.deposit_tiers ? "deposito per gruppo" : t.deposit_pct >= 100 ? "tutto online" : `deposito ${t.deposit_pct}%`;
const refundable = (b: Row) => b.paid_cents - b.refunded_cents;
const when = (b: Row) => `${day(b.date)} · ${esc(b.time)}`;
// The browser runs on the owner's clock, which is Rome's.
// A private tour's time may still be the guest's words: count from the morning.
const hoursTo = (b: Row) => (new Date(`${b.date}T${/^\d{2}:\d{2}$/.test(b.time) ? b.time : "09:00"}:00`).getTime() - Date.now()) / 3600e3;

// ---- Prenotazioni ------------------------------------------------------------------

function row(b: Row) {
  // WhatsApp opens a chat (digits only, a leading 00 dropped, as on the UGC page).
  const wa = b.whatsapp === 1 && b.phone ? ` · <a href="https://wa.me/${String(b.phone).replace(/\D/g, "").replace(/^00/, "")}" target="_blank" rel="noopener">WhatsApp</a>` : "";
  const contact = [b.email, b.phone].filter(Boolean).map((x) => esc(x)).join(" · ") + wa;
  const money = scope === "cancelled"
    ? `<td class="num">${eur(b.paid_cents)}</td><td class="num">${eur(b.refunded_cents)}</td>`
    : scope === "requested"
    ? `<td class="num"><strong>${eur(b.deposit_cents)}</strong><br /><small class="mute">autorizzati, non incassati · rispondi entro ${day(authEnds(b))}</small></td>`
    : `<td class="num"><strong>${eur(b.paid_cents - b.refunded_cents)}</strong><br /><small class="mute">su ${eur(b.total_cents)} · ${eur(balance(b))} sul posto</small></td>`;
  // Everything else (move, edit, cancel, refund, ticket) is on the booking's
  // page, opened by tapping the row; requests keep their quick answer here.
  const open = `<a class="row-open" href="#/prenotazione/${b.id}" aria-label="Apri la prenotazione di ${esc(b.name)}">Apri ›</a>`;
  const actions = scope === "requested"
    ? `<button class="link" data-accept="${b.id}">Accetta e incassa</button><button class="link danger" data-decline="${b.id}">Rifiuta</button>${open}`
    : open;
  return `<tr class="open-row" data-open="${b.id}">
    <td>${when(b)}</td>
    <td><span class="tour-name">${icon(b.slug)}${esc(b.title)}</span></td>
    <td><a class="who" href="#/prenotazione/${b.id}"><strong>${esc(b.name)}</strong></a><br /><small class="mute">${contact}</small><br />${sourceTag(b.source)}${b.promo_code ? ` <span class="promo-tag">${esc(b.promo_code)} −${eur(b.discount_cents)}</span>` : ""}${b.participants ? `<br /><small><strong>Partecipanti:</strong> ${esc(b.participants).replace(/\n/g, "<br />")}</small>` : ""}${b.notes ? `<br /><small>${esc(b.notes)}</small>` : ""}</td>
    <td class="num">${b.guests}</td>
    ${money}
    <td style="white-space:nowrap"><small class="mute">${esc(b.code)}<br />prenotata ${day(b.created_at)}</small></td>
    <td class="row-actions">${actions}</td>
  </tr>`;
}

async function bookingsView() {
  const params = new URLSearchParams({ scope, ...(slug ? { slug } : {}), ...(query ? { q: query } : {}), ...(sort === "recent" ? { sort } : {}) });
  const list = await api<Row[]>(`tours/bookings?${params}`);
  bookings = list;
  const heads = scope === "cancelled"
    ? ["Quando", "Esperienza", "Cliente", "Ospiti", "Deposito pagato", "Rimborsato", "Codice", ""]
    : scope === "requested" ? ["Quando", "Esperienza", "Cliente", "Ospiti", "Sulla carta", "Codice", ""]
    : ["Quando", "Esperienza", "Cliente", "Ospiti", "Deposito incassato", "Codice", ""];
  view.innerHTML = `${head("Prenotazioni", "", "Qui conta il deposito: è quello che entra su Stripe. Il saldo lo incassa chi fa il tour.")}
    <div class="kpis">
      ${kpi("Depositi incassati, ultimi 7 giorni", eur(sum.deposits_week), "entrati su Stripe, meno i rimborsi", "good")}
      ${kpi("Depositi incassati, mese", eur(sum.deposits_month), "dal 1° del mese", "good")}
      ${kpi("Depositi incassati, anno", eur(sum.deposits_year), "dal 1° gennaio")}
      ${sum.requested_n ? kpi("Richieste da accettare", String(sum.requested_n), "Vaticano, Colosseo: verifica e rispondi entro 7 giorni", "alert") : ""}
      ${kpi("Oggi", String(sum.today_n), `${sum.today_guests} ospiti`)}
      ${kpi("Prossimi 7 giorni", String(sum.week_n), `${sum.week_guests} ospiti`)}
    </div>
    <p class="sub sold">Tour venduti questo mese: <strong>${sum.sold_month}</strong> · valore dei tour ${eur(sum.sold_month_value)}</p>
    <section class="panel sources"><h2>Come ci hanno conosciuti</h2>
      <div class="grid2">${sourcesPanel("Questo mese", sum.sources)}${sourcesPanel("Da sempre", sum.sources_all)}</div>
    </section>
    <nav class="months" aria-label="Elenco">${Object.entries(SCOPES).map(([k, l]) =>
      `<button type="button" data-scope="${k}" class="${k === scope ? "on" : ""}">${l}${k === "requested" && sum.requested_n ? ` (${sum.requested_n})` : ""}</button>`).join("")}</nav>
    <div class="filters">
      <label>Esperienza<select data-slug><option value="">Tutte</option>${tours.map((t) =>
        `<option value="${esc(t.slug)}"${t.slug === slug ? " selected" : ""}>${esc(t.title)}</option>`).join("")}</select></label>
      <label>Ordina<select data-sort>
        <option value="date"${sort === "date" ? " selected" : ""}>${scope === "past" || scope === "cancelled" ? "Più recenti prima" : "Prossime da fare"}</option>
        <option value="recent"${sort === "recent" ? " selected" : ""}>Ultime prenotate</option></select></label>
      <label>Cerca<input type="search" data-q value="${esc(query)}" placeholder="Nome, email, telefono, codice" /></label>
    </div>
    <section class="panel">${table(heads, list.map(row), scope === "upcoming" ? "Nessuna prenotazione in arrivo." : "Niente qui.", "", true)}</section>`;
}

function editBooking(b: Row) {
  const fields: Field[] = [
    { name: "date", label: "Data", type: "date", required: true },
    { name: "time", label: "Orario", required: true, hint: "Come 09:30. Vaticano e Colosseo: c'è quello che ha scritto il cliente, sostituiscilo con l'orario concordato" },
    { name: "guests", label: "Ospiti", type: "number", min: 1, max: 100, required: true },
    { name: "total_cents", label: "Totale della prenotazione (€)", type: "money", hint: "Se cambi gli ospiti e lasci il totale com'è, viene ricalcolato col prezzo dell'esperienza" },
    { name: "name", label: "Nome", required: true },
    { name: "email", label: "Email", type: "email", required: true },
    { name: "phone", label: "Telefono", type: "tel", required: true },
    { name: "whatsapp", label: "Ha WhatsApp su questo numero?", type: "select", options: [["1", "Sì"], ["0", "No"]] },
    { name: "participants", label: "Partecipanti (nome, cognome, data di nascita)", type: "textarea" },
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
  // What the policy the guest accepted gives back now.
  const tour = tours.find((t) => t.slug === b.slug) ?? b;
  const share = refundShare(tour, hoursTo(b));
  const fields: Field[] = [
    {
      name: "refund", label: `Rimborso (€), da 0 a ${eur(max)}`, type: "money",
      hint: already ? "Torna sulla carta del cliente con Stripe"
        : share === 100 ? "Secondo le condizioni va rimborsato tutto quello che ha pagato"
        : share ? `Secondo le condizioni va rimborsato il ${share}% di quello che ha pagato`
        : "Secondo le condizioni non è dovuto nessun rimborso",
    },
    { name: "notify", label: "Email", type: "checks", options: [["1", already ? "Avvisa il cliente del rimborso" : "Manda al cliente l'email di cancellazione"]] },
  ];
  const suggested = already ? max : Math.min(max, Math.round((b.paid_cents * share) / 100));
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

// ---- una prenotazione: tutto in una pagina --------------------------------------------

const STATUS: Record<string, [string, string]> = {
  confirmed: ["attivo", "Confermata"], requested: ["pausa", "Da accettare"],
  cancelled: ["concluso", "Cancellata"], pending: ["concluso", "Pagamento non completato"],
};
// What the guest sees, previewed in the CRM: the ticket and each email.
const PREVIEWS: [string, string][] = [
  ["ticket", "Ticket"], ["confirmed", "Email di conferma"], ["reminder", "Promemoria (giorno prima)"],
  ["updated", "Email di modifica"], ["cancelled", "Email di cancellazione"],
];
const VERIFY_PREVIEWS: [string, string][] = [["requested", "Richiesta ricevuta"], ["declined", "Richiesta rifiutata"]];
let previewFrom = "";
let previewKind = "ticket";
let moving: Row | null = null;

const previewPanel = (from: string, verify: boolean, sub: string) => {
  previewFrom = from;
  const kinds = verify ? [...PREVIEWS, ...VERIFY_PREVIEWS] : PREVIEWS;
  if (!kinds.some(([k]) => k === previewKind)) previewKind = "ticket";
  return `<section class="panel">
    <div class="panel-head"><h2>Cosa riceve il cliente <small class="mute">${sub}</small></h2></div>
    <nav class="months" aria-label="Anteprima">${kinds.map(([k, l]) =>
      `<button type="button" data-preview="${k}" class="${k === previewKind ? "on" : ""}">${l}</button>`).join("")}</nav>
    <p class="sub preview-subject" data-preview-subject></p>
    <iframe class="preview-frame" title="Anteprima" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" data-preview-frame></iframe>
  </section>`;
};

async function loadPreview() {
  const frame = view.querySelector<HTMLIFrameElement>("[data-preview-frame]");
  if (!frame || !previewFrom) return;
  view.querySelectorAll<HTMLButtonElement>("[data-preview]").forEach((x) => x.classList.toggle("on", x.dataset.preview === previewKind));
  try {
    const { subject, html } = await api<Row>(`${previewFrom}/preview?kind=${previewKind}`);
    const label = view.querySelector("[data-preview-subject]")!;
    label.innerHTML = previewKind === "ticket" ? "La pagina che il cliente apre dal pulsante «View your ticket» nelle email." : `Oggetto: <strong>${esc(subject)}</strong>`;
    // Links open outside the CRM; the height follows the content.
    frame.onload = () => { frame.style.height = `${(frame.contentDocument?.documentElement.scrollHeight ?? 800) + 4}px`; };
    frame.srcdoc = html.replace("<head>", '<head><base target="_blank" />');
  } catch (error) {
    say((error as Error).message, true);
  }
}

const stamp = (iso?: string | null) => (iso ? new Date(`${String(iso).replace(" ", "T")}Z`).toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

async function bookingView(id: number) {
  const b = await api<Row>(`tours/bookings/${id}`);
  bookings = [b];
  const t = b.tour as Row;
  const [tone, label] = STATUS[b.status] ?? ["concluso", b.status];
  const live = ["confirmed", "requested"].includes(b.status);
  const past = b.date < today();
  const wa = b.phone ? `https://wa.me/${String(b.phone).replace(/\D/g, "").replace(/^00/, "")}` : "";
  const actions = [
    b.ticket_url && b.status !== "pending" ? `<a class="btn" href="${esc(b.ticket_url)}" target="_blank" rel="noopener">Apri / scarica ticket</a>` : "",
    b.status === "requested" ? `<button class="btn primary" data-accept="${b.id}">Accetta e incassa</button><button class="btn danger" data-decline="${b.id}">Rifiuta</button>` : "",
  ].join("");
  const history = [
    ["Prenotata sul sito", stamp(b.created_at)], ["Pagata / confermata", stamp(b.confirmed_at)],
    ["Promemoria mandato", stamp(b.reminded_at)], ["Cancellata", stamp(b.cancelled_at)],
  ].filter(([, v]) => v);
  const free = !t.times.length;
  view.innerHTML = `<p class="crumb"><a href="#/">← Prenotazioni</a></p>
    ${head(esc(b.name), actions, `<span class="tour-name">${icon(b.slug)}${esc(b.title)}</span> · ${esc(b.code)} · ${badge(tone, label)}${live && past ? " · già svolta" : ""}`)}
    <div class="grid2 booking-grid">
      <section class="panel">
        <div class="panel-head"><h2>Data e orario</h2></div>
        <p class="when-big">${day(b.date)} · <strong>${esc(b.time)}</strong> · ${b.guests} ${b.guests === 1 ? "ospite" : "ospiti"}</p>
        ${live ? `<div class="move">
          <label>Nuova data<input type="date" data-move-date value="${esc(b.date)}" /></label>
          <label>Nuovo orario${free
            ? `<input type="text" data-move-time value="${esc(b.time)}" placeholder="09:30" />`
            : `<select data-move-time></select>`}</label>
          ${free ? "" : `<label class="move-extra" hidden>Orario straordinario<input type="time" data-move-extra step="300" /></label>`}
          <p class="sub" data-move-info></p>
          <label class="check"><input type="checkbox" data-move-notify ${b.status === "confirmed" ? "checked" : "disabled"} /> ${b.status === "confirmed" ? "Manda al cliente l'email con data, orario e ticket aggiornati" : "Il cliente riceve i nuovi dettagli quando accetti"}</label>
          <button class="btn primary" type="button" data-move>Sposta la prenotazione</button>
        </div>` : `<p class="mute">${b.status === "cancelled" ? "Prenotazione cancellata: non si può spostare." : "Non si può spostare."}</p>`}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Cliente</h2>${b.status !== "cancelled" ? `<button class="btn small" data-edit="${b.id}">Modifica dati</button>` : ""}</div>
        <dl class="info">
          <dt>Nome</dt><dd>${esc(b.name)}</dd>
          <dt>Email</dt><dd><a href="mailto:${esc(b.email)}">${esc(b.email)}</a></dd>
          <dt>Telefono</dt><dd>${b.phone ? `<a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>${b.whatsapp === 1 ? ` · <a href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : b.whatsapp === 0 ? " · niente WhatsApp" : ""}` : "—"}</dd>
          <dt>Data</dt><dd>${day(b.date)}</dd>
          <dt>Orario</dt><dd>${esc(b.time)}</dd>
          <dt>Ospiti</dt><dd>${b.guests}</dd>
          ${b.extras ? `<dt>Extra</dt><dd>${extrasList(b.extras).map((x) => `${esc(x.name)} (${eur(x.price_cents)})`).join(", ")}</dd>` : ""}
          ${b.participants ? `<dt>Partecipanti</dt><dd>${esc(b.participants).replace(/\n/g, "<br />")}</dd>` : ""}
          <dt>Ci ha conosciuti</dt><dd>${sourceTag(b.source)}</dd>
          ${b.notes ? `<dt>Note</dt><dd>${esc(b.notes)}</dd>` : ""}
        </dl>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Pagamento</h2></div>
        <dl class="info">
          <dt>Totale</dt><dd><strong>${eur(b.total_cents)}</strong>${b.promo_code ? ` <span class="promo-tag">${esc(b.promo_code)} −${eur(b.discount_cents)}</span>` : ""}</dd>
          ${b.gift_cents ? `<dt>Gift card</dt><dd>${esc(b.gift_code)} · ${eur(b.gift_cents)} (già incassati con la gift card; se cancelli tornano sulla card)</dd>` : ""}
          ${b.status === "requested"
            ? `<dt>Sulla carta</dt><dd>${eur(b.deposit_cents)} autorizzati, non incassati · rispondi entro ${day(authEnds(b))}</dd>`
            : `<dt>Pagato online</dt><dd>${eur(b.paid_cents)}</dd>
               <dt>Rimborsato</dt><dd>${eur(b.refunded_cents)}</dd>
               ${b.status === "confirmed" ? `<dt>Da pagare sul posto</dt><dd>${eur(balance(b))}</dd>` : ""}`}
          <dt>Cancellazione</dt><dd><small>${esc(cancelPolicy(t))}</small></dd>
          ${b.payment_intent ? `<dt>Stripe</dt><dd><a href="https://dashboard.stripe.com/payments/${esc(b.payment_intent)}" target="_blank" rel="noopener">Apri il pagamento</a></dd>` : ""}
        </dl>
        <div class="row-actions booking-money">
          ${b.status === "confirmed" ? `<button class="btn danger" data-cancel="${b.id}">Cancella${refundable(b) > 0 ? " e rimborsa" : ""}</button>` : ""}
          ${b.status === "cancelled" && refundable(b) > 0 ? `<button class="btn" data-cancel="${b.id}">Rimborsa</button>` : ""}
          ${b.status === "confirmed" ? `<button class="btn" data-resend="${b.id}">Rimanda email di conferma</button>` : ""}
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Storico</h2></div>
        <dl class="info">${history.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
      </section>
    </div>
    ${previewPanel(`tours/bookings/${b.id}`, Boolean(t.verify), "con i dati di questa prenotazione")}`;
  moving = b;
  if (live) await loadSlots();
  loadPreview();
}

// The times of the chosen day, with the seats each has left.
async function loadSlots() {
  const b = moving;
  const dateInput = view.querySelector<HTMLInputElement>("[data-move-date]");
  if (!b || !dateInput?.value) return;
  const info = view.querySelector<HTMLElement>("[data-move-info]")!;
  try {
    const s = await api<Row>(`tours/bookings/${b.id}/slots?date=${dateInput.value}`);
    const unit = s.unit === "group" ? ["gruppo libero", "gruppi liberi"] : ["posto libero", "posti liberi"];
    const seats = (n: number) => `${Math.max(0, n)} ${n === 1 ? unit[0] : unit[1]}`;
    const warn = [s.closed ? "giorno chiuso" : "", s.runs ? "" : "l'esperienza di solito non si fa in questo giorno"].filter(Boolean);
    const select = view.querySelector<HTMLSelectElement>("select[data-move-time]");
    if (select) {
      const keep = select.value || b.time;
      // Last choice: any other start time, outside the experience's schedule.
      select.innerHTML = s.times.map((x: Row) => {
        const full = x.left < s.need;
        return `<option value="${esc(x.time)}"${full ? " disabled" : ""}${x.time === keep ? " selected" : ""}>${esc(x.time)} · ${full ? "pieno" : seats(x.left)}${x.listed ? "" : " (straordinario)"}</option>`;
      }).join("") + `<option value="${EXTRA}"${keep === EXTRA ? " selected" : ""}>Altro orario (straordinario)…</option>`;
      if (select.selectedOptions[0]?.disabled) select.value = s.times.find((x: Row) => x.left >= s.need)?.time ?? EXTRA;
      showExtra();
    }
    info.innerHTML = [
      s.free_time ? `In quel giorno: ${seats(s.left)}${s.left < s.need ? " (pieno)" : ""}` : "",
      warn.length ? `<span class="warn">Attenzione: ${warn.join(", ")}.</span>` : "",
    ].filter(Boolean).join(" ");
  } catch (error) {
    info.textContent = (error as Error).message;
  }
}

const EXTRA = "extra";
// The free time field shows only when "Altro orario" is chosen.
function showExtra() {
  const select = view.querySelector<HTMLSelectElement>("select[data-move-time]");
  const box = view.querySelector<HTMLElement>(".move-extra");
  if (!select || !box) return;
  box.hidden = select.value !== EXTRA;
  const note = view.querySelector<HTMLElement>("[data-move-extra-note]");
  if (select.value === EXTRA && !note) view.querySelector("[data-move-info]")?.insertAdjacentHTML("beforeend",
    ' <span data-move-extra-note>Orario fuori dal calendario: vale solo per questa prenotazione e non apre posti sul sito.</span>');
  else if (select.value !== EXTRA) note?.remove();
}

async function moveBooking() {
  const b = moving;
  if (!b) return;
  const date = view.querySelector<HTMLInputElement>("[data-move-date]")!.value;
  let time = view.querySelector<HTMLInputElement | HTMLSelectElement>("[data-move-time]")!.value.trim();
  if (time === EXTRA) time = view.querySelector<HTMLInputElement>("[data-move-extra]")!.value;
  const notify = view.querySelector<HTMLInputElement>("[data-move-notify]")!.checked;
  if (!date || !time) { say("Scegli data e orario.", true); return; }
  if (date === b.date && time === b.time) { say("Data e orario sono già questi.", true); return; }
  if (!confirm(`Spostare ${b.name} a ${day(date)} alle ${time}?${notify ? " Il cliente riceve un'email con i nuovi dettagli." : ""}`)) return;
  act(async () => {
    const { emailed } = await api<Row>(`tours/bookings/${b.id}`, { method: "PATCH", data: { date, time, notify } });
    if (notify && !emailed) say("Spostata, ma l'email non è partita", true);
  }, "Prenotazione spostata");
}

// ---- Esperienze ----------------------------------------------------------------------

const weekdaysText = (w: string) => DAYS.filter(([k]) => w.includes(k)).map(([, l]) => l).join(" ");

function tile(t: Row) {
  const m = sum.by_tour?.[t.slug] ?? { n: 0, deposits: 0 };
  return `<a class="tour-tile${t.active ? "" : " off"}" href="#/esperienze/${esc(t.slug)}">
    <span class="ico">${icon(t.slug, 28)}</span>
    <strong>${esc(t.title)}</strong>
    <small>${t.price_tiers ? `da ${eur(t.price_cents)} a gruppo` : `${eur(t.price_cents)} ${UNIT[t.unit] ?? ""}`} · ${depositText(t)}${t.verify ? " · da accettare" : ""}</small>
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
      <dt>Prezzo</dt><dd>${t.price_tiers ? Object.entries(t.price_tiers as Record<string, number>).map(([n, c]) => `${n} pers. ${eur(c)}`).join(" · ") : `${eur(t.price_cents)} ${UNIT[t.unit] ?? ""}`}</dd>
      <dt>Extra</dt><dd>${t.extras.length ? t.extras.map((x: Row) => `${esc(x.name)} ${eur(x.price_cents)}`).join(" · ") : "—"}</dd>
      <dt>Pagamento online</dt><dd>${t.deposit_tiers ? `${Object.entries(t.deposit_tiers as Record<string, number>).map(([n, c]) => `${n} pers. ${eur(c)}`).join(" · ")} · il resto (ed eventuali extra) sul posto` : t.deposit_pct >= 100 ? "tutto online" : `${t.deposit_pct}% · il resto sul posto`}</dd>
      <dt>Conferma</dt><dd>${t.verify ? "la accetti tu: la carta è solo autorizzata finché non accetti (entro 7 giorni); chiede i partecipanti" : "immediata"}</dd>
      <dt>Capienza</dt><dd>${t.capacity} ${t.unit === "group" ? (t.capacity === 1 ? "gruppo" : "gruppi") : "posti"} ${t.times.length ? "per orario" : "al giorno"} · massimo ${t.max_guests} ospiti a prenotazione</dd>
      <dt>Orari</dt><dd>${t.times.length ? t.times.map(esc).join(" · ") : "liberi: il cliente scrive l'orario che preferisce"}</dd>
      <dt>Giorni</dt><dd>${weekdaysText(t.weekdays)}</dd>
      <dt>Chiusura vendite</dt><dd>${t.cutoff_hours} ore prima</dd>
      <dt>Cancellazione</dt><dd>${esc(cancelPolicy(t))}</dd>
      <dt>Punto d'incontro</dt><dd>${esc(t.meeting_point ?? "—")}</dd>
      <dt>Operatore</dt><dd>${t.operator_email ? `${esc(t.operator_email)} · riceve le nuove prenotazioni` : "—"}</dd>
    </dl>
    </section>
    <section class="panel">
    <h2>Giorni chiusi</h2>
    <div class="closures">${t.closures.map((d: string) =>
      `<span class="chip">${day(d)} <button class="link" data-open-day="${esc(t.slug)}|${d}" aria-label="Riapri ${day(d)}">✕</button></span>`).join("") || '<span class="mute">Nessuno</span>'}</div>
    <div class="filters" style="margin:10px 0 0"><label>Chiudi un giorno<input type="date" min="${today()}" data-close-day="${esc(t.slug)}" /></label></div>
    </section>
    ${previewPanel(`tours/catalog/${t.slug}`, Boolean(t.verify), "esempio: 2 ospiti fra 7 giorni")}`;
  loadPreview();
}

// ---- Codici sconto ------------------------------------------------------------------

let promos: Row[] = [];
const promoValue = (p: Row) => (p.percent ? `${p.percent}%` : eur(p.amount_cents));

// Gift cards sold on the site (/gift-cards/): what each is worth, what is left.
async function giftsView() {
  const gifts = await api<Row[]>("tours/gifts");
  const live = gifts.filter((g) => g.status === "paid" && g.expires_on >= today());
  const sold = gifts.filter((g) => g.status === "paid").reduce((a, g) => a + g.amount_cents, 0);
  const open = live.reduce((a, g) => a + g.balance_cents, 0);
  const row = (g: Row) => `<tr>
    <td><a class="promo-code" href="${esc(g.url)}" target="_blank" rel="noopener"><strong>${esc(g.code)}</strong></a><br /><small class="mute">${day(g.paid_at.slice(0, 10))}</small></td>
    <td class="num">${eur(g.amount_cents)}</td>
    <td class="num"><strong>${eur(g.balance_cents)}</strong>${g.uses ? `<br /><small class="mute">${g.uses} ${g.uses === 1 ? "prenotazione" : "prenotazioni"}</small>` : ""}</td>
    <td><strong>${esc(g.buyer_name)}</strong><br /><small class="mute"><a href="mailto:${esc(g.buyer_email)}">${esc(g.buyer_email)}</a></small></td>
    <td>${esc(g.recipient_name ?? "—")}</td>
    <td>${g.expires_on < today() ? badge("concluso", `Scaduta ${day(g.expires_on)}`) : day(g.expires_on)}</td>
  </tr>`;
  view.innerHTML = `${head("Gift card", '<a class="btn" href="/gift-cards/" target="_blank" rel="noopener">Pagina sul sito</a>',
    "Vendute sul sito, pagate per intero. Il cliente scrive il codice nel box di prenotazione: la card paga prima la parte online, poi il saldo del giorno (che allora incassi tu, non sul posto). Quello che resta rimane sulla card.")}
    <div class="kpis">${kpi("Vendute", eur(sold), `${gifts.filter((g) => g.status === "paid").length} card`)}${kpi("Credito ancora da usare", eur(open), `${live.filter((g) => g.balance_cents > 0).length} card valide`)}</div>
    <section class="panel">${table(["Codice", "Valore", "Residuo", "Acquirente", "Per", "Valida fino al"], gifts.map(row), "Nessuna gift card venduta ancora.", "", true)}</section>`;
}

function promoRow(p: Row) {
  const tour = tours.find((t) => t.slug === p.slug);
  const expired = p.expires_on && p.expires_on < today();
  const full = p.max_uses != null && p.used >= p.max_uses;
  const state = !p.active ? badge("concluso", "Spento") : expired ? badge("concluso", "Scaduto") : full ? badge("concluso", "Esaurito") : badge("attivo", "Attivo");
  return `<tr>
    <td><strong class="promo-code">${esc(p.code)}</strong>${p.note ? `<br /><small class="mute">${esc(p.note)}</small>` : ""}</td>
    <td class="num">−${promoValue(p)}</td>
    <td>${tour ? `<span class="tour-name">${icon(tour.slug)}${esc(tour.title)}</span>` : "Tutte le esperienze"}</td>
    <td class="num">${p.used}${p.max_uses != null ? ` / ${p.max_uses}` : ""}${p.discounted ? `<br /><small class="mute">−${eur(p.discounted)} di sconti</small>` : ""}</td>
    <td>${p.expires_on ? day(p.expires_on) : "Mai"}</td>
    <td>${state}</td>
    <td class="row-actions"><button class="link" data-promo-toggle="${esc(p.code)}">${p.active ? "Spegni" : "Riaccendi"}</button>${p.used ? "" : `<button class="link danger" data-promo-delete="${esc(p.code)}">Elimina</button>`}</td>
  </tr>`;
}

async function promosView() {
  promos = await api<Row[]>("tours/promos");
  view.innerHTML = `${head("Codici sconto", '<button class="btn primary" data-promo-new>Nuovo codice</button>',
    "Il cliente lo scrive nel box di prenotazione: lo sconto vale sul totale, e il deposito si calcola sul totale scontato.")}
    <section class="panel">${table(["Codice", "Sconto", "Vale per", "Usato", "Scade", "Stato", ""], promos.map(promoRow), "Nessun codice ancora. Crea il primo con «Nuovo codice».", "", true)}</section>`;
}

function newPromo() {
  const fields: Field[] = [
    { name: "code", label: "Codice", required: true, hint: "Lettere, numeri e trattini, come ROME10. Il cliente può scriverlo minuscolo." },
    { name: "kind", label: "Tipo di sconto", type: "select", options: [["percent", "Percentuale sul totale"], ["amount", "Importo fisso in euro"]] },
    { name: "percent", label: "Percentuale (%)", type: "number", min: 1, max: 100, hint: "Se hai scelto la percentuale" },
    { name: "amount", label: "Importo (€)", type: "money", hint: "Se hai scelto l'importo fisso" },
    { name: "slug", label: "Vale per", type: "select", options: [["", "Tutte le esperienze"], ...tours.map((t): [string, string] => [t.slug, t.title])] },
    { name: "max_uses", label: "Quante prenotazioni al massimo", type: "number", min: 1, hint: "Vuoto: senza limite" },
    { name: "expires_on", label: "Valido fino al", type: "date", hint: "Vuoto: non scade" },
    { name: "note", label: "Nota (solo per te)", hint: "Per esempio: campagna Instagram di dicembre" },
  ];
  form("Nuovo codice sconto", fields, { kind: "percent" }, (data) => {
    const value = data.kind === "percent" ? Number(data.percent) : data.amount;
    if (!value) throw new Error(data.kind === "percent" ? "Scrivi la percentuale." : "Scrivi l'importo.");
    return api("tours/promos", { method: "POST", data: { ...data, value } });
  }, render);
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
    { name: "price_tiers", label: "Prezzi per numero di persone (€)", hint: "Solo per i gruppi privati: 1=485, 2=485, 3=540… fino al massimo. Vuoto: si usa il prezzo sopra. Il prezzo sopra resta il «da» mostrato sul sito." },
    { name: "extras", label: "Extra a pagamento", type: "textarea", hint: "Uno per riga, prezzo fisso a prenotazione in €: Classic Italian Gourmet Basket = 50. Il cliente li sceglie mentre prenota. Vuoto: nessun extra" },
    { name: "verify", label: "Conferma", type: "select", options: [["0", "Immediata"], ["1", "La accetto io (carta autorizzata, chiede i partecipanti)"]] },
    { name: "deposit_tiers", label: "Deposito per numero di persone (€)", hint: "Es. il tuo margine: 2=135, 3=145… fino al massimo. Si paga online, il resto e gli extra sul posto. Vuoto: si usa la percentuale qui sotto" },
    { name: "deposit_pct", label: "Deposito online (%)", type: "number", min: 1, max: 100, required: true },
    { name: "capacity", label: "Capienza per orario", type: "number", min: 1, max: 500, required: true, hint: "Posti; per i prezzi a gruppo, quanti gruppi (barche) per orario" },
    { name: "max_guests", label: "Massimo ospiti in una prenotazione", type: "number", min: 1, max: 500, required: true },
    { name: "times", label: "Orari di partenza", hint: "Separati da virgola: 09:30, 14:00. Vuoto: il cliente scrive l'orario che preferisce e la capienza vale per giorno" },
    { name: "weekdays", label: "Giorni", type: "checks", options: DAYS, required: true },
    { name: "cutoff_hours", label: "Chiudi le vendite ore prima", type: "number", min: 0, max: 720, required: true },
    { name: "cancel_hours", label: "Cancellazione gratuita fino a ore prima", type: "number", min: 0, max: 2160, required: true, hint: "720 = 30 giorni" },
    { name: "partial_refund_pct", label: "Dopo, rimborso parziale (%)", type: "number", min: 0, max: 99, required: true, hint: "0 = nessun rimborso dopo la cancellazione gratuita" },
    { name: "partial_refund_hours", label: "Rimborso parziale fino a ore prima", type: "number", min: 0, max: 2160, required: true, hint: "Dopo questo, nessun rimborso" },
    { name: "meeting_point", label: "Punto d'incontro (nelle email)" },
    { name: "operator_email", label: "Email dell'operatore", type: "email", hint: "Chi svolge l'esperienza: riceve una copia di ogni nuova prenotazione. Vuoto: solo tu" },
  ];
  form(t.title, fields, { ...t, times: t.times.join(", "), weekdays: t.weekdays.split(""), active: String(t.active), verify: String(t.verify), price_tiers: tiersText(t.price_tiers), deposit_tiers: tiersText(t.deposit_tiers), extras: extrasText(t.extras) }, (data) =>
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
    if (route === "sconti") { await promosView(); stackTables(view); return; }
    if (route === "gift") { await giftsView(); stackTables(view); return; }
    previewFrom = "";
    if (route === "prenotazione" && arg) { await bookingView(Number(arg)); return; }
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
  const target = event.target as HTMLElement;
  // A tap anywhere on a booking row, except its links and buttons, opens it.
  const openRow = target.closest<HTMLElement>("tr[data-open]");
  if (openRow && !target.closest("a, button")) { location.hash = `#/prenotazione/${openRow.dataset.open}`; return; }
  const tileLink = (event.target as HTMLElement).closest<HTMLAnchorElement>("a.tour-tile");
  if (tileLink) editNext = tileLink.getAttribute("href")!.split("/").pop()!;
  const el = (event.target as HTMLElement).closest<HTMLElement>("button");
  if (!el) return;
  const d = el.dataset;
  const booking = (id?: string) => bookings.find((b) => b.id === Number(id));
  if (d.scope) { scope = d.scope; render(); }
  else if (d.preview) { previewKind = d.preview; loadPreview(); }
  else if ("move" in d) moveBooking();
  else if (d.edit) { const b = booking(d.edit); if (b) editBooking(b); }
  else if (d.cancel) { const b = booking(d.cancel); if (b) cancelBooking(b); }
  else if (d.accept) {
    const b = booking(d.accept);
    if (b && confirm(`Accettare la richiesta di ${b.name} (${b.title}, ${day(b.date)} ${b.time})? Incassi ${eur(b.deposit_cents)} sulla sua carta e gli mandi la conferma.`)) {
      act(async () => { if (!(await api<Row>(`tours/bookings/${b.id}/accept`, { method: "POST", data: {} })).emailed) say("Incassato, ma l'email non è partita", true); }, "Accettata e incassata");
    }
  } else if (d.decline) {
    const b = booking(d.decline);
    if (b && confirm(`Rifiutare la richiesta di ${b.name} (${b.title}, ${day(b.date)} ${b.time})? L'autorizzazione sulla carta viene liberata e il cliente riceve un'email.`)) {
      act(() => api(`tours/bookings/${b.id}/decline`, { method: "POST", data: { notify: true } }), "Richiesta rifiutata, niente addebitato");
    }
  }
  else if (d.resend) {
    const b = booking(d.resend);
    if (b && confirm(`Rimandare l'email di conferma a ${b.email}?`)) {
      act(async () => { if (!(await api<Row>(`tours/bookings/${b.id}/resend`, { method: "POST", data: {} })).emailed) throw new Error("L'email non è partita"); }, "Email rimandata");
    }
  } else if ("promoNew" in d) newPromo();
  else if (d.promoToggle) {
    const p = promos.find((x) => x.code === d.promoToggle);
    if (p) act(() => api(`tours/promos/${encodeURIComponent(p.code)}`, { method: "PATCH", data: { active: !p.active } }), p.active ? "Codice spento" : "Codice riacceso");
  } else if (d.promoDelete) {
    if (confirm(`Eliminare il codice ${d.promoDelete}?`)) act(() => api(`tours/promos/${encodeURIComponent(d.promoDelete!)}`, { method: "DELETE" }), "Codice eliminato");
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
  if ("moveDate" in el.dataset) { loadSlots(); return; }
  if ("moveTime" in el.dataset) { showExtra(); return; }
  if ("sort" in el.dataset) { sort = el.value; render(); return; }
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
