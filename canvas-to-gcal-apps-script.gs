/**
 * Canvas -> Google Calendar sync
 *
 * Runs entirely on Google's own servers under your Google account (via
 * Apps Script), so it can be scheduled to run automatically every 30
 * minutes, even when you never open the site that day. It reads your
 * Canvas calendar feed and writes each assignment as an event onto a
 * Google Calendar that YOU own — which is what lets it be made public
 * and plugged into the site's existing Google Calendar integration.
 * (A calendar you merely *subscribe to* can't be made public, which is
 * why this writes to your own calendar instead of just subscribing.)
 *
 * ---- Setup (about 5 minutes) ----
 * 1. In Google Calendar, create a new calendar (Settings -> "Add
 *    calendar" -> "Create new calendar"). Name it anything, e.g.
 *    "Canvas Assignments".
 * 2. Open that new calendar's settings -> under "Integrate calendar",
 *    copy its Calendar ID (looks like ...@group.calendar.google.com).
 * 3. On that same settings page, under "Access permissions for events",
 *    check "Make available to public".
 * 4. Go to https://script.google.com -> New project.
 * 5. Delete the placeholder code, paste this whole file in.
 * 6. Fill in the two constants right below this comment block with your
 *    Canvas calendar feed URL and the Calendar ID from step 2.
 * 7. Click Run (the play button) on the `setupTrigger` function (use the
 *    dropdown next to Run to pick it). The first time, Google will ask
 *    you to authorize the script — approve it (it's just accessing your
 *    own calendar and fetching a URL, both under your own account).
 * 8. That's it — it'll now run itself every 30 minutes in the
 *    background. You can also click Run on `syncCanvasToCalendar`
 *    directly any time to sync immediately.
 */

// ====== FILL IN THESE TWO THINGS ======
const CANVAS_ICS_URL = 'PASTE_YOUR_CANVAS_CALENDAR_FEED_URL_HERE';
const TARGET_CALENDAR_ID = 'PASTE_YOUR_NEW_CALENDAR_ID_HERE'; // looks like abc123@group.calendar.google.com
// =======================================

function syncCanvasToCalendar() {
  const calendar = CalendarApp.getCalendarById(TARGET_CALENDAR_ID);
  if (!calendar) {
    Logger.log('Could not find a calendar with that ID — double check TARGET_CALENDAR_ID.');
    return;
  }

  const response = UrlFetchApp.fetch(CANVAS_ICS_URL, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    Logger.log('Canvas feed returned ' + response.getResponseCode() + ' — sync skipped this run.');
    return;
  }
  const items = parseICS(response.getContentText());

  const now = new Date();
  const future = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 180); // look 6 months ahead
  const existing = calendar.getEvents(now, future);
  const existingByUid = {};
  existing.forEach(ev => {
    const uid = ev.getTag('canvasUid');
    if (uid) existingByUid[uid] = ev;
  });

  const seenUids = {};
  items.forEach(item => {
    if (!item.due) return;
    seenUids[item.uid] = true;
    const existingEvent = existingByUid[item.uid];
    if (existingEvent) {
      if (existingEvent.getTitle() !== item.name) existingEvent.setTitle(item.name);
    } else {
      const ev = calendar.createEvent(
        item.name,
        item.due,
        new Date(item.due.getTime() + 30 * 60000),
        { description: item.url || '' }
      );
      ev.setTag('canvasUid', item.uid);
    }
  });

  // clean up events for assignments that dropped out of the feed
  existing.forEach(ev => {
    const uid = ev.getTag('canvasUid');
    if (uid && !seenUids[uid]) ev.deleteEvent();
  });

  Logger.log('Synced ' + Object.keys(seenUids).length + ' assignment(s).');
}

function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncCanvasToCalendar') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncCanvasToCalendar')
    .timeBased()
    .everyMinutes(30)
    .create();
  Logger.log('Done — syncCanvasToCalendar will now run automatically every 30 minutes.');
  syncCanvasToCalendar(); // also run once immediately
}

// ---------- ICS parsing helpers ----------
function parseICS(text) {
  const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfolded.split(/\r\n|\n/);
  const items = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') {
      if (cur) {
        items.push({
          uid: cur.UID || ((cur.SUMMARY || '') + (cur.DTSTART || '')),
          name: unescapeICS(cur.SUMMARY) || '(untitled)',
          due: icsDateToDate(cur.DTSTART || cur.DUE),
          url: cur.URL || '',
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    let key = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const semi = key.indexOf(';');
    if (semi !== -1) key = key.slice(0, semi);
    cur[key] = value;
  }
  return items;
}

function icsDateToDate(val) {
  if (!val) return null;
  if (/^\d{8}$/.test(val)) {
    return new Date(Number(val.slice(0,4)), Number(val.slice(4,6)) - 1, Number(val.slice(6,8)));
  }
  const m = val.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (m) {
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])));
  }
  return null;
}

function unescapeICS(s) {
  return (s || '').replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}
