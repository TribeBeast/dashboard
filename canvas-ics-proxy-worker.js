/**
 * Canvas Calendar Feed Proxy — deploy this on Cloudflare Workers (free tier).
 *
 * Unlike the personal-access-token approach, this reads your Canvas
 * *calendar feed* — a different, older Canvas feature that most schools
 * don't lock down the way they lock down API tokens. It only gives due
 * dates (not submission/graded status), so "done" is approximated as
 * "due date has passed" rather than true completion.
 *
 * Nothing is stored here — your calendar feed URL is sent with each
 * request from your page and simply passed through.
 *
 * ---- Where to find your Canvas calendar feed URL ----
 * In Canvas: open Calendar (left sidebar) -> click "Calendar Feed" near
 * the bottom of the right-hand panel (sometimes under a gear/settings
 * icon instead). Copy the URL it gives you — it usually ends in .ics
 * and contains a long private token in the path itself. Keep it private;
 * anyone with that URL can see your due dates.
 *
 * ---- How to deploy (about 3 minutes) ----
 * 1. Go to https://dash.cloudflare.com and sign up / log in (free).
 * 2. Workers & Pages -> Create -> Create Worker. Name it, click Deploy.
 * 3. Click "Edit code", delete everything, paste this whole file in,
 *    click "Save and deploy".
 * 4. Copy the worker's URL shown at the top — paste that into the
 *    To-do page's Canvas sync settings as the Proxy URL.
 */

const ALLOWED_ORIGIN = '*'; // tighten to your site's exact origin once it's hosted

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// RFC5545 line folding: continuation lines start with a space or tab and
// need to be joined back onto the previous line before parsing
function unfoldICS(text) {
  return text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}

function parseICS(text) {
  const lines = unfoldICS(text).split(/\r\n|\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    let key = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const semi = key.indexOf(';');
    if (semi !== -1) key = key.slice(0, semi); // drop parameters like ;VALUE=DATE
    cur[key] = value;
  }
  return events;
}

// ICS dates come as YYYYMMDD or YYYYMMDDTHHMMSSZ
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
  return (s || '').replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

async function handleRequest(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Use POST' }), {
      status: 405, headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }

  let body;
  try { body = await request.json(); }
  catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }

  const icsUrl = body.icsUrl;
  if (!icsUrl) {
    return new Response(JSON.stringify({ error: 'icsUrl is required' }), {
      status: 400, headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }

  let feedRes;
  try {
    // Canvas (or a security layer in front of it) can block requests that
    // don't look like they came from a real browser — Workers don't send
    // a normal User-Agent by default, which is enough to trigger that
    feedRes = await fetch(icsUrl, {
      headers: {
        // Apache's mod_negotiation 406 can trigger on any of several
        // Accept-* dimensions (encoding, language, charset) — a real
        // browser sends all of these together, so match that fully
        // instead of guessing at one at a time
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Charset': 'utf-8, iso-8859-1;q=0.5, *;q=0.25',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Could not reach the calendar feed: ' + e.message }), {
      status: 502, headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }
  if (!feedRes.ok) {
    // pull in whatever Canvas actually said, instead of just the status
    // code — this is the only way to see what it's actually objecting to
    let bodyText = '';
    try { bodyText = (await feedRes.text()).slice(0, 300); } catch (e) {}
    return new Response(JSON.stringify({
      error: `Feed returned ${feedRes.status}`,
      canvasResponse: bodyText,
    }), {
      status: feedRes.status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }

  const text = await feedRes.text();
  const events = parseICS(text);

  const items = events.map(ev => ({
    id: ev.UID || (ev.SUMMARY || '') + (ev.DTSTART || ''),
    name: unescapeICSText(ev.SUMMARY) || '(untitled)',
    due_at: icsDateToISO(ev.DTSTART || ev.DUE),
    html_url: ev.URL || null,
  })).filter(item => item.due_at); // skip anything without a usable date

  return new Response(JSON.stringify(items), {
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

export default {
  fetch: handleRequest,
};
