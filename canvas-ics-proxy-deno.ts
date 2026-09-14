/**
 * Canvas Calendar Feed Proxy — Deno Deploy version.
 *
 * This does the exact same thing as the Cloudflare Workers version, just
 * running on different infrastructure (Deno Deploy instead of Cloudflare).
 * If UCSD's Canvas was specifically blocking requests coming from
 * Cloudflare's IP ranges, this sidesteps that by running somewhere else
 * entirely.
 *
 * ---- How to deploy (about 2 minutes, free) ----
 * 1. Go to https://dash.deno.com and sign in (GitHub login is easiest).
 * 2. Click "New Project".
 * 3. Choose the "Playground" option (not "GitHub repository") — this
 *    gives you a browser code editor, no separate hosting needed.
 * 4. Delete the placeholder code in the editor, paste this whole file in.
 * 5. Click "Save & Deploy" (or it may auto-deploy on save).
 * 6. Copy the URL shown at the top — it looks like
 *    https://your-project-name.deno.dev — paste that into the To-do
 *    page's Canvas sync settings as the Proxy URL, exactly like before.
 */

const ALLOWED_ORIGIN = "*"; // tighten to your site's exact origin once it's hosted

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function unfoldICS(text) {
  return text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

function parseICS(text) {
  const lines = unfoldICS(text).split(/\r\n|\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    let key = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const semi = key.indexOf(";");
    if (semi !== -1) key = key.slice(0, semi);
    cur[key] = value;
  }
  return events;
}

function icsDateToISO(val) {
  if (!val) return null;
  if (/^\d{8}$/.test(val)) {
    return `${val.slice(0,4)}-${val.slice(4,6)}-${val.slice(6,8)}`;
  }
  const m = val.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
  return null;
}

function unescapeICSText(s) {
  return (s || "").replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST" }), {
      status: 405, headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }

  let body;
  try { body = await req.json(); }
  catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }

  const icsUrl = body.icsUrl;
  if (!icsUrl) {
    return new Response(JSON.stringify({ error: "icsUrl is required" }), {
      status: 400, headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }

  let feedRes;
  try {
    feedRes = await fetch(icsUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Could not reach the calendar feed: " + e.message }), {
      status: 502, headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }

  if (!feedRes.ok) {
    let bodyText = "";
    try { bodyText = (await feedRes.text()).slice(0, 300); } catch (e) {}
    return new Response(JSON.stringify({
      error: `Feed returned ${feedRes.status}`,
      canvasResponse: bodyText,
    }), {
      status: feedRes.status, headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }

  const text = await feedRes.text();
  const events = parseICS(text);

  const items = events.map((ev) => ({
    id: ev.UID || (ev.SUMMARY || "") + (ev.DTSTART || ""),
    name: unescapeICSText(ev.SUMMARY) || "(untitled)",
    due_at: icsDateToISO(ev.DTSTART || ev.DUE),
    html_url: ev.URL || null,
  })).filter((item) => item.due_at);

  return new Response(JSON.stringify(items), {
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
});
