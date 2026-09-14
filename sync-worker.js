/**
 * Site Sync API — deploy on Cloudflare Workers, backed by a KV namespace.
 *
 * This is what makes your site's data (nodes, notes, portfolio photos,
 * tasks) the same across every device instead of stuck in one browser's
 * localStorage. Every page fetches/saves through this Worker in
 * addition to its local copy.
 *
 * ---- How to deploy (about 5 minutes) ----
 * 1. Go to https://dash.cloudflare.com -> Workers & Pages -> Create ->
 *    Create Worker. Name it (e.g. "site-sync"). Deploy the placeholder.
 * 2. Click "Edit code", delete everything, paste this whole file in,
 *    Save and deploy.
 * 3. Go back to the Worker's main page (not the code editor) -> Settings
 *    -> Bindings -> Add -> KV Namespace.
 *    - If you don't have a KV namespace yet, there's a "Create a KV
 *      namespace" option right there — name it anything, e.g. "SITE_DATA".
 *    - For "Variable name" (this is the important part), type exactly:
 *      SITE_KV
 *    Save.
 * 4. Copy the Worker's URL (same place as always, top of the overview
 *    page) — this is your Sync URL.
 * 5. Pick a private passphrase only you know — this is your Site Key.
 *    It's what keeps random people from reading or overwriting your
 *    data if they ever guessed your Worker's URL. Put both the Sync URL
 *    and Site Key into sync.js (see that file for where).
 *
 * ---- How it works ----
 * Every page calls this with { siteKey, key, value } to save something,
 * or { siteKey, key } to read it back. Data is namespaced under your
 * siteKey so it's yours alone. Nothing is encrypted at rest — this is
 * "keep strangers out," not bank-grade security, which is appropriate
 * for a personal hub site.
 */

const ALLOWED_ORIGIN = '*'; // tighten to your site's exact origin once it's hosted

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

async function handleRequest(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Use POST' }, 405);
  }
  if (!env.SITE_KV) {
    return json({ error: 'KV namespace not bound — see setup step 3 in the file comment.' }, 500);
  }

  let body;
  try { body = await request.json(); }
  catch (e) { return json({ error: 'Invalid JSON body' }, 400); }

  const { siteKey, key, value, action } = body;
  if (!siteKey || !key) {
    return json({ error: 'siteKey and key are required' }, 400);
  }
  const kvKey = `${siteKey}::${key}`;

  if (action === 'set') {
    const record = { value, updatedAt: Date.now() };
    await env.SITE_KV.put(kvKey, JSON.stringify(record));
    return json({ ok: true, updatedAt: record.updatedAt });
  }

  if (action === 'get') {
    const raw = await env.SITE_KV.get(kvKey);
    if (!raw) return json({ value: null, updatedAt: 0 });
    try {
      const record = JSON.parse(raw);
      return json({ value: record.value, updatedAt: record.updatedAt });
    } catch (e) {
      return json({ value: null, updatedAt: 0 });
    }
  }

  return json({ error: 'action must be "get" or "set"' }, 400);
}

export default {
  fetch: handleRequest,
};
