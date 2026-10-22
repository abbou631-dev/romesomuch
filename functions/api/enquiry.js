// Both enquiry forms post here. Cloudflare Pages serves this at /api/enquiry.
//
// The site is static, so this is the only piece that runs per request: it checks
// the submission, then hands it to Resend. The secrets live on the Pages project,
// never in the bundle.

const FORMS = {
  booking: {
    subject: "Booking request",
    required: ["experience", "name", "email"],
    fields: ["experience", "name", "email", "date", "guests", "message"],
    // The studio runs this at weekends. The date field enforces it in the browser,
    // which anyone can skip, so it is enforced here too.
    weekendOnly: "date",
  },
  contact: {
    subject: "Message from the site",
    required: ["name", "email", "topic", "message"],
    fields: ["topic", "experience", "name", "email", "message"],
  },
  creator: {
    subject: "Creator enquiry",
    required: ["name", "email", "message"],
    fields: ["name", "email", "city", "platforms", "reach", "links", "message"],
  },
  itinerary: {
    subject: "Bespoke itinerary",
    required: ["name", "email", "dates", "message"],
    fields: ["name", "email", "dates", "travellers", "pace", "budget", "message"],
  },
  ugc: {
    subject: "UGC application",
    required: ["name", "email", "instagram", "portfolio", "followers", "niche", "arrival", "departure", "interest", "rights", "agreement"],
    fields: [
      "name", "email", "country", "instagram", "tiktok", "portfolio", "followers", "views", "niche",
      "languages", "arrival", "departure", "group", "interest", "deliverables", "rights", "message", "agreement",
    ],
    // Arrival and departure must be real dates, in that order.
    stay: ["arrival", "departure"],
    // Each application is also kept in the CRM (/crm/#/ugc): form field → column.
    crm: {
      table: "ugc",
      columns: {
        name: "name", email: "email", country: "country", instagram: "instagram", tiktok: "tiktok",
        portfolio: "portfolio", followers: "followers", views: "views", niche: "niche", languages: "languages",
        arrival: "arrival", departure: "departure", group: "party", interest: "interest",
        deliverables: "deliverables", rights: "rights", message: "message", agreement: "agreement", page: "page",
      },
    },
  },
  partner: {
    subject: "Partnership enquiry",
    required: ["company", "name", "email", "message"],
    fields: ["company", "name", "role", "email", "website", "kindOfWork", "message"],
  },
};

// Context every form carries without the sender typing it: the page the message
// was sent from, and the last experience they had opened. Kept apart from the
// declared fields so no form has to list them.
const CONTEXT = ["page", "lastViewed"];

const LABELS = {
  experience: "Experience",
  date: "Preferred date",
  guests: "Guests",
  company: "Company",
  name: "Name",
  role: "Role",
  email: "Email",
  city: "City",
  website: "Website",
  topic: "About",
  platforms: "Platforms",
  reach: "Audience",
  links: "Links",
  kindOfWork: "What they propose",
  dates: "Dates in Rome",
  travellers: "Who is travelling",
  pace: "Pace",
  budget: "Daily budget",
  country: "From",
  instagram: "Instagram",
  tiktok: "TikTok",
  portfolio: "Best work",
  followers: "Followers",
  views: "Average views",
  niche: "Niche",
  languages: "Languages",
  arrival: "Arriving",
  departure: "Leaving",
  group: "Who is coming",
  interest: "Wants to try",
  deliverables: "Would deliver",
  rights: "Usage rights",
  agreement: "Accepted the commitment to post",
  message: "Message",
  topic: "Reason",
  page: "Sent from",
  lastViewed: "Last experience they opened",
};

// Long enough for anything a person writes, short enough that nobody can post a novel.
const LIMIT = 4000;

const clean = (value) => String(value ?? "").trim().slice(0, LIMIT);

const looksLikeEmail = (value) => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(value);

// Turns a submission into a row of the form's CRM table. Returns whether it landed.
const saveToCrm = async (map, values, db) => {
  const entries = Object.entries(map.columns).filter(([field]) => values[field]);
  try {
    await db
      .prepare(`INSERT INTO ${map.table} (${entries.map(([, column]) => column).join(", ")}) VALUES (${entries.map(() => "?").join(", ")})`)
      .bind(...entries.map(([field]) => values[field]))
      .run();
    return true;
  } catch (error) {
    console.log("the CRM rejected the enquiry", error);
    return false;
  }
};

const reply = (request, status, message) => {
  // With JavaScript the page reads the JSON; without it, the browser lands here
  // and still gets a readable answer instead of a blank screen.
  if ((request.headers.get("accept") ?? "").includes("application/json")) {
    return Response.json({ ok: status === 200, message }, { status });
  }
  const back = new URL(request.url).origin;
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>RomeSoMuch</title>
     <body style="font:16px/1.6 system-ui;margin:12vh auto;max-width:44ch;padding:0 24px">
     <p>${message}</p><p><a href="${back}">Back to romesomuch.com</a></p>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
};

export const onRequestPost = async ({ request, env }) => {
  let body;
  try {
    body = Object.fromEntries(await request.formData());
  } catch {
    return reply(request, 400, "We could not read that submission.");
  }

  const form = FORMS[clean(body.kind)];
  if (!form) return reply(request, 400, "Unknown form.");

  // A field no human can see: anything that fills it in is a bot. Answer 200 so
  // it learns nothing from the difference.
  if (clean(body.website_url)) return reply(request, 200, "Thanks — we will be in touch.");

  const values = {};
  for (const field of form.fields) values[field] = clean(body[field]);

  const missing = form.required.filter((field) => !values[field]);
  // A box to tick, not a field to fill in.
  if (missing.length === 1 && missing[0] === "agreement") {
    return reply(request, 400, "Please tick the box to confirm you will post about the business if you take part.");
  }
  if (missing.length) {
    return reply(request, 400, `Please fill in: ${missing.map((f) => LABELS[f]).join(", ")}.`);
  }
  if (!looksLikeEmail(values.email)) {
    return reply(request, 400, "That email address does not look right.");
  }

  const dated = form.weekendOnly && values[form.weekendOnly];
  if (dated) {
    const day = new Date(`${dated}T00:00:00Z`).getUTCDay();
    if (Number.isNaN(day)) return reply(request, 400, "That date does not look right.");
    if (day !== 0 && day !== 6) {
      return reply(request, 400, "We run this on Saturdays and Sundays only — please pick a weekend date.");
    }
  }

  if (form.stay) {
    const [from, to] = form.stay.map((field) => Date.parse(`${values[field]}T00:00:00Z`));
    if (Number.isNaN(from) || Number.isNaN(to)) return reply(request, 400, "Those dates do not look right.");
    if (to < from) return reply(request, 400, "The day you leave Rome comes before the day you arrive.");
  }

  const crm = form.crm && env.CRM_DB;
  if (!env.RESEND_API_KEY && !crm) {
    // Nothing was delivered, so never tell the sender it was.
    return reply(request, 500, "The form is not configured yet. Please email us instead.");
  }

  for (const field of CONTEXT) values[field] = clean(body[field]);

  // The answer comes first, then who wrote it, then where they were. Reading the
  // subject line alone should already say what this is about.
  const lines = [...form.fields, ...CONTEXT]
    .filter((field) => values[field])
    .map((field) => `${LABELS[field]}: ${values[field]}`);

  // What this message is about, in order of how specific it is.
  const about =
    values.experience ||
    values.topic ||
    values.company ||
    values.kindOfWork ||
    (values.instagram && `${values.name} (${values.instagram})`) ||
    values.name;

  // Either destination is enough: the row and the email each carry the whole
  // application, so one failing alone loses nothing.
  const saved = crm ? await saveToCrm(form.crm, values, env.CRM_DB) : false;

  let mailed = false;
  if (env.RESEND_API_KEY) {
    const sent = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.ENQUIRY_FROM ?? "RomeSoMuch site <forms@romesomuch.com>",
        to: [env.ENQUIRY_TO ?? "romesomuch@gmail.com"],
        reply_to: values.email,
        subject: `${form.subject}: ${about}`,
        text: `${lines.join("\n\n")}\n\nReply to this email and it goes straight back to ${values.name || "the sender"}.`,
      }),
    });
    if (!sent.ok) console.log("resend rejected the enquiry", sent.status, await sent.text());
    mailed = sent.ok;
  }

  if (!saved && !mailed) {
    return reply(request, 502, "We could not send that just now. Please email us instead.");
  }

  return reply(request, 200, "Thanks — we read everything and answer within 48 hours.");
};
