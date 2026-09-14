/**
 * sync.js — shared by every page on the site.
 *
 * Fill in SYNC_URL and SITE_KEY below once you've deployed sync-worker.js
 * (see that file's comment for deploy steps). Until you do, every page
 * just falls back to localStorage-only behavior, exactly like before —
 * nothing breaks if you haven't set this up yet.
 *
 * SITE_KEY is a private passphrase only you know — pick anything, it's
 * just what keeps your data namespaced to you if someone ever finds your
 * Worker's URL. Use the exact same SITE_KEY on every device.
 */

const SiteSync = (() => {
  const SYNC_URL = 'https://site-sync.carlosaq0501.workers.dev/';   // e.g. https://site-sync.your-name.workers.dev
  const SITE_KEY = 'Probbplayer#1';

  function enabled() {
    return SYNC_URL && !SYNC_URL.startsWith('PASTE') && SITE_KEY && !SITE_KEY.startsWith('PASTE');
  }

  async function call(key, action, value) {
    const res = await fetch(SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteKey: SITE_KEY, key, value, action }),
    });
    if (!res.ok) throw new Error('sync request failed: ' + res.status);
    return res.json();
  }

  return {
    enabled,

    // Save a value under localKey: writes to localStorage immediately
    // (so the page never waits on the network), then pushes to the cloud
    // in the background. Use this instead of localStorage.setItem.
    // `value` can be a string or any JSON-serializable value.
    save(localKey, value) {
      const isJSON = typeof value !== 'string';
      const str = isJSON ? JSON.stringify(value) : value;
      try { localStorage.setItem(localKey, str); } catch (e) {}
      const ts = Date.now();
      try { localStorage.setItem(localKey + '__ts', String(ts)); } catch (e) {}
      if (enabled()) {
        call(localKey, 'set', value).catch(() => {
          // offline or the Worker's unreachable — fine, localStorage
          // still has it, and the next successful save will catch up
        });
      }
    },

    // Reads the local copy of localKey, and — if sync is enabled — also
    // checks the cloud and returns whichever is newer. Meant to be
    // awaited during page load, before the page first renders, so
    // there's no separate "data arrived late, re-render" step needed.
    // Falls back to the local copy alone if offline or unconfigured.
    async loadFreshest(localKey, isJSON) {
      let local = null;
      try {
        const raw = localStorage.getItem(localKey);
        local = raw ? (isJSON ? JSON.parse(raw) : raw) : null;
      } catch (e) {}

      if (!enabled()) return local;

      let localTs = 0;
      try { localTs = Number(localStorage.getItem(localKey + '__ts') || 0); } catch (e) {}

      try {
        const res = await call(localKey, 'get');
        if (res && res.updatedAt && res.updatedAt > localTs && res.value !== null && res.value !== undefined) {
          try {
            localStorage.setItem(localKey, isJSON ? JSON.stringify(res.value) : res.value);
            localStorage.setItem(localKey + '__ts', String(res.updatedAt));
          } catch (e) {}
          return res.value;
        }
      } catch (e) {
        // offline — the local copy is the best we've got
      }
      return local;
    },
  };
})();
