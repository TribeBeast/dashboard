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
    // a hard timeout so a slow/unreachable Worker can never hang the
    // page — the page always falls back to local data promptly instead
    // of waiting indefinitely on the network
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch(SYNC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteKey: SITE_KEY, key, value, action }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('sync request failed: ' + res.status);
      return res.json();
    } finally {
      clearTimeout(timeout);
    }
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

    // Reads the local copy of localKey synchronously — no network,
    // returns instantly. Use this during page load so the page can
    // render immediately from what's already on this device, instead
    // of every navigation waiting on a round-trip to the Worker first.
    loadLocal(localKey, isJSON) {
      try {
        const raw = localStorage.getItem(localKey);
        return raw ? (isJSON ? JSON.parse(raw) : raw) : null;
      } catch (e) {
        return null;
      }
    },

    // Checks the cloud for a fresher copy of localKey, entirely in the
    // background — never awaited, never blocks rendering. Calls
    // onNewer(value) only if the cloud actually has something newer
    // than what's already local, so the caller can update its in-memory
    // data and re-render at that point. Safe to call on every page load;
    // does nothing if sync isn't configured or the Worker's unreachable.
    checkCloud(localKey, isJSON, onNewer) {
      if (!enabled()) return;
      let local = this.loadLocal(localKey, isJSON);
      let localTsRaw = null;
      try { localTsRaw = localStorage.getItem(localKey + '__ts'); } catch (e) {}
      const hasLocalData = local !== null && local !== undefined &&
        !(isJSON && Array.isArray(local) && local.length === 0);

      // Real local data that predates this sync system (or this device's
      // first sync) has no recorded timestamp. Treating that as "oldest"
      // is what once caused real data to be silently overwritten by
      // whatever was sitting in the cloud — instead, the first time a
      // device with untimestamped-but-real data checks in, its local
      // copy is treated as authoritative and PUSHED to the cloud.
      if (hasLocalData && localTsRaw === null) {
        const ts = Date.now();
        try { localStorage.setItem(localKey + '__ts', String(ts)); } catch (e) {}
        call(localKey, 'set', local).catch(() => {});
        return;
      }

      const localTs = Number(localTsRaw || 0);
      call(localKey, 'get').then(res => {
        if (res && res.updatedAt && res.updatedAt > localTs && res.value !== null && res.value !== undefined) {
          try {
            localStorage.setItem(localKey, isJSON ? JSON.stringify(res.value) : res.value);
            localStorage.setItem(localKey + '__ts', String(res.updatedAt));
          } catch (e) {}
          if (onNewer) onNewer(res.value);
        }
      }).catch(() => {
        // offline — the local copy already rendered, nothing more to do
      });
    },

    // Reads the local copy of localKey, and — if sync is enabled — also
    // checks the cloud and returns whichever is newer. This AWAITS the
    // network, so only use it somewhere that's fine blocking briefly —
    // for page-load rendering, use loadLocal() + checkCloud() instead so
    // the page never waits on a round-trip before it can show anything.
    // Falls back to the local copy alone if offline or unconfigured.
    async loadFreshest(localKey, isJSON) {
      let local = null;
      try {
        const raw = localStorage.getItem(localKey);
        local = raw ? (isJSON ? JSON.parse(raw) : raw) : null;
      } catch (e) {}

      if (!enabled()) return local;

      let localTsRaw = null;
      try { localTsRaw = localStorage.getItem(localKey + '__ts'); } catch (e) {}
      const hasLocalData = local !== null && local !== undefined &&
        !(isJSON && Array.isArray(local) && local.length === 0);

      // Real local data that predates this sync system (or this device's
      // first sync) has no recorded timestamp. Treating that as "oldest"
      // is what caused real data to be silently overwritten by whatever
      // was sitting in the cloud — instead, the first time a device with
      // untimestamped-but-real data checks in, its local copy is treated
      // as authoritative and PUSHED to the cloud, not pulled over.
      if (hasLocalData && localTsRaw === null) {
        const ts = Date.now();
        try { localStorage.setItem(localKey + '__ts', String(ts)); } catch (e) {}
        call(localKey, 'set', local).catch(() => {});
        return local;
      }

      const localTs = Number(localTsRaw || 0);

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
