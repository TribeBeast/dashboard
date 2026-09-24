/**
 * gate.js — a password gate for the whole site, shared by every page.
 *
 * The actual password lives only in sync-worker.js, which runs
 * entirely on Cloudflare's servers — it's never sent to a browser, so
 * there's nothing to find by viewing page source or opening DevTools
 * on the site itself, no matter how hard someone looks at THIS file.
 * This file only ever sends what was typed to the Worker and asks
 * "was that right?" — it never holds, computes, or compares the real
 * password itself.
 *
 * Unlocking lasts for the browser tab's session — close the tab (or
 * the browser) and it locks again next time, same as "remember me for
 * this session" on other sites.
 *
 * ---- Setup ----
 * 1. In sync-worker.js, set SITE_PASSWORD to whatever you want
 *    visitors to enter, and redeploy the Worker.
 * 2. Below, set GATE_URL to your Worker's URL — the same one you're
 *    already using in sync.js.
 * 3. Put <script src="gate.js"></script> as the very FIRST thing
 *    inside <head> on every page — before any other <script> or
 *    <link>, so nothing can flash on screen before the gate shows.
 */

(function(){
  const GATE_URL = 'https://site-sync.carlosaq0501.workers.dev/'; // same URL as in sync.js
  const SESSION_KEY = 'site-unlocked';

  if (sessionStorage.getItem(SESSION_KEY) === 'yes') return; // already unlocked this session

  // hide everything else on the page immediately, before it can render
  // — this has to happen synchronously, right now, which is exactly
  // what document.write does when called from a head script
  document.write('<style id="site-gate-hide">body > *:not(#site-gate-overlay){ visibility: hidden !important; }</style>');

  function buildOverlay(){
    const style = document.createElement('style');
    style.textContent = `
      #site-gate-overlay{
        position: fixed; inset: 0; z-index: 999999;
        background: #05060F;
        display: flex; align-items: center; justify-content: center;
        visibility: visible;
        font-family: 'Inter', -apple-system, sans-serif;
      }
      #site-gate-box{ text-align: center; padding: 24px; }
      #site-gate-title{ color: #EDEBF7; font-size: 16px; margin-bottom: 18px; opacity: 0.85; }
      #site-gate-input{
        background: rgba(255,255,255,0.06); border: 1px solid rgba(237,235,247,0.35);
        border-radius: 8px; color: #EDEBF7; padding: 11px 14px; font-size: 14px;
        width: 220px; text-align: center; outline: none;
      }
      #site-gate-input:focus{ border-color: rgba(237,235,247,0.7); }
      #site-gate-submit{
        display: block; margin: 14px auto 0; background: #EDEBF7; color: #0C0F26;
        border: none; border-radius: 8px; padding: 9px 26px; font-weight: 600;
        font-size: 13.5px; cursor: pointer;
      }
      #site-gate-submit:disabled{ opacity: 0.6; cursor: default; }
      #site-gate-error{ color: #E8707A; font-size: 12px; margin-top: 12px; min-height: 15px; }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'site-gate-overlay';
    overlay.innerHTML =
      '<div id="site-gate-box">' +
        '<div id="site-gate-title">This site is locked</div>' +
        '<input id="site-gate-input" type="password" autocomplete="off" placeholder="Enter password" />' +
        '<button id="site-gate-submit">Enter</button>' +
        '<div id="site-gate-error"></div>' +
      '</div>';
    document.body.appendChild(overlay);

    const input = document.getElementById('site-gate-input');
    const submitBtn = document.getElementById('site-gate-submit');
    const errEl = document.getElementById('site-gate-error');
    input.focus();

    function unlock(){
      sessionStorage.setItem(SESSION_KEY, 'yes');
      const hideStyle = document.getElementById('site-gate-hide');
      if (hideStyle) hideStyle.remove();
      overlay.remove();
    }

    function submit(){
      const pw = input.value;
      if (!pw) return;
      submitBtn.disabled = true;
      errEl.textContent = '';
      fetch(GATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'checkPassword', password: pw }),
      })
        .then(res => res.json())
        .then(data => {
          submitBtn.disabled = false;
          if (data && data.ok) {
            unlock();
          } else {
            errEl.textContent = 'Incorrect password.';
            input.value = '';
            input.focus();
          }
        })
        .catch(() => {
          submitBtn.disabled = false;
          errEl.textContent = 'Could not reach the server — check your connection and try again.';
        });
    }

    submitBtn.addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildOverlay);
  } else {
    buildOverlay();
  }
})();
