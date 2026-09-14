// Both enquiry forms post here. Cloudflare Pages serves this at /api/enquiry.
//
// The site is static, so this is the only piece that runs per request: it checks
// the submission, then hands it to Resend. The secrets live on the Pages project,
// never in the bundle.

const FORMS = {
  creator: {
    subject: "Creator enquiry",
    required: ["name", "email", "message"],
    fields: ["name", "email", "city", "platforms", "reach", "links", "message"],
  },
  partner: {
    subject: "Partnership enquiry",
    required: ["company", "name", "email", "message"],
    fields: ["company", "name", "role", "email", "website", "kindOfWork", "message"],
  },
};

const LABELS = {
  company: "Company",
  name: "Name",
  role: "Role",
  email: "Email",
  city: "City",
  website: "Website",
  platforms: "Platforms",
  reach: "Audience",
  links: "Links",
  kindOfWork: "What they propose",
  message: "Message",
};

// Long enough for anything a person writes, short enough that nobody can post a novel.
const LIMIT = 4000;

const clean = (value) => String(value ?? "").trim().slice(0, LIMIT);

const looksLikeEmail = (value) => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(value);

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
  if (missing.length) {
    return reply(request, 400, `Please fill in: ${missing.map((f) => LABELS[f]).join(", ")}.`);
  }
  if (!looksLikeEmail(values.email)) {
    return reply(request, 400, "That email address does not look right.");
  }

  if (!env.RESEND_API_KEY) {
    // Nothing was delivered, so never tell the sender it was.
    return reply(request, 500, "The form is not configured yet. Please email us instead.");
  }

  const lines = form.fields
    .filter((field) => values[field])
    .map((field) => `${LABELS[field]}: ${values[field]}`);

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
      subject: `${form.subject} — ${values.company || values.name}`,
      text: `${lines.join("\n\n")}\n\nSent from the ${form.subject.toLowerCase()} form on romesomuch.com.`,
    }),
  });

  if (!sent.ok) {
    console.log("resend rejected the enquiry", sent.status, await sent.text());
    return reply(request, 502, "We could not send that just now. Please email us instead.");
  }

  return reply(request, 200, "Thanks — we read everything and answer within 48 hours.");
};
