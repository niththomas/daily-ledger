/* Daily Ledger — single-user, offline-first habit ledger.
 *
 * One localStorage source of truth per concern:
 *   ledger-history   { "YYYY-MM-DD": [itemId, ...] }
 *   ledger-items     [{ id, label, note, points, archived? }]
 *   ledger-settings  { target, theme }
 *
 * Nothing derived is ever stored. Points, streaks, rates and every view are
 * recomputed from history on each render.
 */

const VERSION = "2.0.0";

const KEY_HISTORY  = "ledger-history";
const KEY_ITEMS    = "ledger-items";
const KEY_SETTINGS = "ledger-settings";

const DEFAULT_ITEMS = [
  { id: "book",     label: "Read 10 pages of a book",       note: "deep reading",                          points: 2 },
  { id: "longform", label: "Long-form video or podcast",    note: "substantive, not scrolling",            points: 1 },
  { id: "paper",    label: "Read an academic paper",        note: "abstract, conclusion, skim the middle", points: 1 },
  { id: "writing",  label: "Write 200+ words",              note: "journal, essay, notes",                 points: 2 },
  { id: "explain",  label: "Explain something you learned", note: "to a person or a rubber duck",          points: 1 },
  { id: "phone",    label: "Phone-free first & last 30 min", note: "protect the edges of the day",         points: 1 },
  { id: "offline",  label: "One continuous hour offline",   note: "no notifications, no checks",           points: 1 },
  { id: "sleep",    label: "Sleep 8+ hours",                note: "memory consolidation",                  points: 2 },
  { id: "cardio",   label: "Cardio: 10k steps or 20 min",   note: "BDNF, processing speed",                points: 1 }
];

const DEFAULT_SETTINGS = { target: 10, theme: "auto" };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------------- storage */

function readRaw(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function readJSON(key, fallback) {
  const raw = readRaw(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw); }
  catch {
    // Never destroy data we cannot read: park it so it can be recovered.
    try { localStorage.setItem(key + "-unreadable", raw); } catch { /* ignore */ }
    return fallback;
  }
}

function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }  // private mode or quota: carry on in memory
}

/* --------------------------------------------------------------- model */

// A day is a de-duplicated list of item ids. Anything else is repaired
// rather than trusted: a bare string becomes a one-item list, and junk
// is dropped, so one bad write cannot poison every later computation.
function normalizeHistory(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!DATE_RE.test(key)) continue;
    let ids = Array.isArray(value) ? value : (typeof value === "string" ? [value] : []);
    ids = [...new Set(ids.filter((id) => typeof id === "string" && id))];
    if (ids.length) out[key] = ids;
  }
  return out;
}

function normalizeItems(raw) {
  if (!Array.isArray(raw)) return DEFAULT_ITEMS.map((it) => ({ ...it }));
  const seen = new Set();
  const items = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const id = typeof it.id === "string" && it.id ? it.id : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      label: typeof it.label === "string" ? it.label : id,
      note: typeof it.note === "string" ? it.note : "",
      points: Math.max(0, Math.min(99, Math.round(Number(it.points) || 0))),
      archived: !!it.archived
    });
  }
  return items.length ? items : DEFAULT_ITEMS.map((it) => ({ ...it }));
}

function normalizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS };
  if (raw && typeof raw === "object") {
    if (Number.isFinite(Number(raw.target))) s.target = Math.round(Number(raw.target));
    if (["auto", "light", "dark"].includes(raw.theme)) s.theme = raw.theme;
  }
  return s;
}

let history  = normalizeHistory(readJSON(KEY_HISTORY, {}));
let items    = normalizeItems(readJSON(KEY_ITEMS, null));
let settings = normalizeSettings(readJSON(KEY_SETTINGS, null));

const state = { view: "today", month: null, sheetDate: null, nudgeDismissed: null, pendingImport: null };

function activeItems() { return items.filter((it) => !it.archived); }
function maxPoints()   { return activeItems().reduce((s, it) => s + it.points, 0); }
function target()      { return Math.max(1, Math.min(settings.target, Math.max(1, maxPoints()))); }
function itemById(id)  { return items.find((it) => it.id === id) || null; }

function saveHistory()  { writeJSON(KEY_HISTORY, history); }
function saveItems()    { writeJSON(KEY_ITEMS, items); }
function saveSettings() { writeJSON(KEY_SETTINGS, settings); }

/* ------------------------------------------------------------- compute */

function keyOf(d) {
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

function dateOf(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

// Archived items still score, so retiring a habit never rewrites the past.
function pointsFor(ids) {
  if (!Array.isArray(ids)) return 0;
  let total = 0;
  for (const id of ids) {
    const it = itemById(id);
    if (it) total += it.points;
  }
  return total;
}

function pointsOn(key) { return pointsFor(history[key]); }

// Consecutive days at target ending today. An unfinished today counts from
// yesterday, so a morning in progress never zeroes a live streak.
function computeStreak(today) {
  const t = target();
  let n = 0;
  let cursor = new Date(today);
  if (pointsOn(keyOf(today)) < t) cursor = addDays(cursor, -1);
  for (let i = 0; i < 4000; i++) {
    if (pointsOn(keyOf(cursor)) >= t) { n++; cursor = addDays(cursor, -1); }
    else break;
  }
  return n;
}

function longestStreak() {
  const t = target();
  const met = new Set(Object.keys(history).filter((k) => pointsOn(k) >= t));
  let best = 0;
  for (const key of met) {
    // Only start counting from the first day of a run.
    if (met.has(keyOf(addDays(dateOf(key), -1)))) continue;
    let n = 0;
    let cursor = dateOf(key);
    while (met.has(keyOf(cursor))) { n++; cursor = addDays(cursor, 1); }
    if (n > best) best = n;
  }
  return best;
}

function lastNDays(n, today) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    const key = keyOf(d);
    out.push({ key, date: d, pts: pointsOn(key), isToday: i === 0 });
  }
  return out;
}

function rateOver(n, today) {
  const t = target();
  const days = lastNDays(n, today);
  const met = days.filter((d) => d.pts >= t).length;
  return { met, of: n, pct: Math.round((met / n) * 100) };
}

function itemStats(n, today) {
  const window = lastNDays(n, today).map((d) => history[d.key] || []);
  const allKeys = Object.keys(history);
  return activeItems().map((it) => {
    const recent = window.filter((ids) => ids.includes(it.id)).length;
    const allTime = allKeys.filter((k) => (history[k] || []).includes(it.id)).length;
    return { item: it, recent, of: n, allTime, pct: Math.round((recent / n) * 100) };
  }).sort((a, b) => b.recent - a.recent);
}

function totals() {
  const keys = Object.keys(history).sort();
  const pts = keys.reduce((s, k) => s + pointsOn(k), 0);
  return { days: keys.length, points: pts, first: keys[0] || null };
}

// Sequential teal ramp: one hue, light to dark, with a distinct step at
// target. Magnitude is fill; "perfect" rides along as a marker, not a
// second fill hue.
function levelClass(pts) {
  const t = target();
  if (pts <= 0) return "lvl-0";
  if (pts >= t) return "lvl-met";
  const frac = pts / t;
  if (frac < 0.25) return "lvl-1";
  if (frac < 0.45) return "lvl-2";
  if (frac < 0.65) return "lvl-3";
  if (frac < 0.85) return "lvl-4";
  return "lvl-5";
}

function statusFor(pts) {
  const t = target(), m = maxPoints();
  if (m > 0 && pts >= m) return { text: "Perfect day. All " + m + " quanta.", warm: true };
  if (pts >= t) return { text: "Target reached (+" + (pts - t) + ").", warm: true };
  return { text: (t - pts) + " to target. Ceiling is " + m + ".", warm: false };
}

/* ------------------------------------------------------------- helpers */

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function el(id) { return document.getElementById(id); }

function longDate(d) {
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function shortDate(d) {
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

const CHECK_SVG =
  '<svg class="box-check" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" ' +
  'stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function rowHTML(it, on, dateKey) {
  return '<button class="row' + (on ? " is-on" : "") + '" type="button" ' +
    'data-action="toggle" data-id="' + esc(it.id) + '" data-date="' + esc(dateKey) + '" ' +
    'aria-pressed="' + (on ? "true" : "false") + '">' +
      '<span class="box">' + CHECK_SVG + '</span>' +
      '<span class="row-text">' +
        '<span class="row-label">' + esc(it.label) + '</span>' +
        (it.note ? '<span class="row-note">' + esc(it.note) + '</span>' : "") +
      '</span>' +
      '<span class="row-pts">+' + it.points + '</span>' +
    '</button>';
}

/* ------------------------------------------------------------ rendering */

function applyTheme() {
  const root = document.documentElement;
  if (settings.theme === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", settings.theme);
}

function renderMasthead(today) {
  el("date").textContent = longDate(today);
  const streak = computeStreak(today);
  const box = el("streak");
  box.hidden = streak === 0;
  el("streak-count").textContent = streak;
  box.setAttribute("aria-label", streak + " day streak at target");
}

function renderTabs() {
  for (const tab of document.querySelectorAll(".tab")) {
    const on = tab.dataset.view === state.view;
    tab.classList.toggle("is-on", on);
    tab.setAttribute("aria-selected", on ? "true" : "false");
    tab.tabIndex = on ? 0 : -1;
  }
  for (const view of document.querySelectorAll(".view")) {
    view.hidden = view.dataset.view !== state.view;
  }
}

// A nudge with no push infrastructure: if yesterday was never logged, say so
// on the next open, when it can still be fixed.
function renderNudge(today) {
  const yKey = keyOf(addDays(today, -1));
  const box = el("nudge");
  const show = pointsOn(yKey) === 0 && state.nudgeDismissed !== yKey;
  box.hidden = !show;
  if (show) {
    el("nudge-text").textContent = "Nothing logged for " + shortDate(addDays(today, -1)) + ".";
    el("nudge-open").dataset.date = yKey;
  }
}

function renderToday(today) {
  const key = keyOf(today);
  const checked = history[key] || [];
  const pts = pointsFor(checked);
  const t = target(), m = maxPoints();

  const ladder = el("ladder");
  if (ladder.childElementCount !== m) {
    let html = "";
    for (let level = m; level >= 1; level--) {
      html += '<div class="quantum" data-level="' + level + '">' +
              (level === t ? '<span class="target-line"></span>' : "") + "</div>";
    }
    ladder.innerHTML = html;
  }
  for (const cell of ladder.children) {
    const level = Number(cell.dataset.level);
    cell.classList.toggle("is-on", level <= pts);
    cell.classList.toggle("is-over", level > t);
  }
  ladder.classList.toggle("is-complete", pts >= t);
  ladder.setAttribute("aria-label", pts + " of " + m + " points, target " + t);

  el("score").textContent = pts;
  el("of-target").textContent = "/ " + t;
  const st = statusFor(pts);
  el("status").textContent = st.text;
  el("status").classList.toggle("is-warm", st.warm);

  el("list").innerHTML = activeItems().map((it) => rowHTML(it, checked.includes(it.id), key)).join("");

  // 14-day strip: tappable, because a hover tooltip is invisible on a phone.
  const days = lastNDays(14, today);
  el("strip-meta").textContent = "target " + t + " / " + m;
  el("strip").innerHTML =
    '<span class="strip-guide" style="bottom: calc(18px + 62px * ' + (t / Math.max(m, 1)) + ')" aria-hidden="true"></span>' +
    days.map((d) =>
      '<button class="strip-col' + (d.isToday ? " is-today" : "") + '" type="button" ' +
        'data-action="open-day" data-date="' + d.key + '" ' +
        'aria-label="' + esc(shortDate(d.date)) + ", " + d.pts + " of " + m + ' points">' +
        '<span class="strip-bar' + (d.pts === 0 ? " is-empty" : (d.pts >= t ? " is-met" : "")) + '"' +
          (d.pts > 0 ? ' style="height:' + Math.round((d.pts / Math.max(m, 1)) * 100) + '%"' : "") + '></span>' +
      "</button>").join("");

  el("live").textContent = pts + " of " + m + " points. " + st.text;
}

function renderCalendar(today) {
  const cur = state.month || { y: today.getFullYear(), m: today.getMonth() };
  state.month = cur;
  const t = target(), m = maxPoints();
  const first = new Date(cur.y, cur.m, 1);
  const daysInMonth = new Date(cur.y, cur.m + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7;   // Monday-first
  const todayKey = keyOf(today);

  el("cal-title").textContent = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  let cells = "";
  for (let i = 0; i < offset; i++) cells += '<span class="cal-cell is-blank" aria-hidden="true"></span>';
  let met = 0, monthPts = 0, best = 0, logged = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(cur.y, cur.m, day);
    const key = keyOf(d);
    const pts = pointsOn(key);
    const future = d > today && key !== todayKey;
    if (!future) { monthPts += pts; if (pts >= t) met++; if (pts > best) best = pts; if (pts > 0) logged++; }

    const cls = ["cal-cell", future ? "is-future" : levelClass(pts)];
    if (key === todayKey) cls.push("is-today");
    if (!future && m > 0 && pts >= m) cls.push("is-perfect");

    cells += future
      ? '<span class="' + cls.join(" ") + '"><span class="cal-day">' + day + "</span></span>"
      : '<button class="' + cls.join(" ") + '" type="button" data-action="open-day" data-date="' + key + '" ' +
          'aria-label="' + esc(shortDate(d)) + ", " + pts + " of " + m + ' points">' +
          '<span class="cal-day">' + day + "</span>" +
          '<span class="cal-pts">' + pts + "</span>" +
        "</button>";
  }
  el("cal-grid").innerHTML = cells;
  el("cal-summary").innerHTML =
    '<span><b>' + met + "</b> at target</span>" +
    '<span><b>' + logged + "</b> days logged</span>" +
    '<span><b>' + monthPts + "</b> points</span>" +
    '<span>best <b>' + best + "</b></span>";
}

function renderStats(today) {
  const t = target(), m = maxPoints();
  const r30 = rateOver(30, today);
  const tot = totals();
  const avg = tot.days ? (tot.points / tot.days) : 0;

  el("stat-tiles").innerHTML = [
    ["Current streak", computeStreak(today), "days"],
    ["Longest streak", longestStreak(), "days"],
    ["At target", r30.pct + "%", "last 30 days"],
    ["Days logged", tot.days, "all time"]
  ].map(([label, value, note]) =>
    '<div class="tile"><span class="tile-label">' + esc(label) + "</span>" +
    '<span class="tile-value">' + esc(String(value)) + "</span>" +
    '<span class="tile-note">' + esc(note) + "</span></div>").join("");

  el("stat-summary").innerHTML =
    '<span>' + r30.met + " of last 30 days at target " + t + "</span>" +
    '<span>average <b>' + avg.toFixed(1) + "</b> / " + m + " per logged day</span>" +
    (tot.first ? '<span>since ' + esc(shortDate(dateOf(tot.first))) + "</span>" : "");

  const stats = itemStats(30, today);
  const worst = stats.length ? stats[stats.length - 1] : null;
  el("item-stats").innerHTML = stats.map((s) =>
    '<div class="istat">' +
      '<span class="istat-label">' + esc(s.item.label) + "</span>" +
      '<span class="istat-track"><span class="istat-bar" style="width:' + Math.max(s.pct, s.recent ? 2 : 0) + '%"></span></span>' +
      '<span class="istat-value">' + s.recent + "/" + s.of + "</span>" +
    "</div>").join("");

  el("item-hint").textContent = worst && worst.recent < 30
    ? "Least kept: " + worst.item.label + " (" + worst.recent + " of 30). Re-weight it or drop it."
    : "";
}

function renderSettings() {
  el("target-value").textContent = target();
  el("target-max").textContent = "of " + maxPoints() + " available";

  for (const b of document.querySelectorAll("[data-theme-choice]")) {
    b.classList.toggle("is-on", b.dataset.themeChoice === settings.theme);
    b.setAttribute("aria-pressed", b.dataset.themeChoice === settings.theme ? "true" : "false");
  }

  el("items-editor").innerHTML = items.filter((it) => !it.archived).map((it) =>
    '<div class="edit-row" data-id="' + esc(it.id) + '">' +
      '<div class="edit-fields">' +
        '<input class="edit-label" type="text" value="' + esc(it.label) + '" data-field="label" aria-label="Item name">' +
        '<input class="edit-note" type="text" value="' + esc(it.note) + '" data-field="note" aria-label="Sub-note" placeholder="sub-note">' +
      "</div>" +
      '<div class="edit-pts">' +
        '<button type="button" data-action="pts-down" aria-label="Fewer points for ' + esc(it.label) + '">&minus;</button>' +
        "<span>" + it.points + "</span>" +
        '<button type="button" data-action="pts-up" aria-label="More points for ' + esc(it.label) + '">+</button>' +
      "</div>" +
      '<button class="edit-archive" type="button" data-action="archive" aria-label="Retire ' + esc(it.label) + '">Retire</button>' +
    "</div>").join("");

  const archived = items.filter((it) => it.archived);
  el("archived-box").hidden = archived.length === 0;
  el("archived-list").innerHTML = archived.map((it) =>
    '<div class="edit-row is-archived" data-id="' + esc(it.id) + '">' +
      '<span class="edit-archived-label">' + esc(it.label) + " <em>+" + it.points + "</em></span>" +
      '<button type="button" data-action="restore">Restore</button>' +
    "</div>").join("");

  const tot = totals();
  el("data-summary").textContent =
    tot.days + " days logged, " + tot.points + " points total" +
    (tot.first ? ", since " + shortDate(dateOf(tot.first)) : "") + ".";
  el("version").textContent = "v" + VERSION;
}

/* ------------------------------------------------------------- day sheet */

let sheetOpener = null;

function openSheet(dateKey, opener) {
  if (!DATE_RE.test(dateKey)) return;
  state.sheetDate = dateKey;
  sheetOpener = opener || null;
  renderSheet();
  el("sheet").hidden = false;
  document.body.classList.add("is-locked");
  const focusable = el("sheet").querySelector(".row, .sheet-close");
  if (focusable) focusable.focus();
}

function closeSheet() {
  state.sheetDate = null;
  el("sheet").hidden = true;
  document.body.classList.remove("is-locked");
  if (sheetOpener && document.contains(sheetOpener)) sheetOpener.focus();
  sheetOpener = null;
}

function renderSheet() {
  const key = state.sheetDate;
  if (!key) return;
  const d = dateOf(key);
  const checked = history[key] || [];
  const pts = pointsFor(checked);
  const t = target(), m = maxPoints();
  const isToday = key === keyOf(new Date());

  el("sheet-date").textContent = longDate(d) + (isToday ? " · today" : "");
  el("sheet-score").textContent = pts;
  el("sheet-of").textContent = "/ " + m;
  el("sheet-status").textContent = pts >= t ? "At target" : (t - pts) + " short of target";
  el("sheet-status").classList.toggle("is-warm", pts >= t);
  el("sheet-list").innerHTML = activeItems().map((it) => rowHTML(it, checked.includes(it.id), key)).join("");

  // Items retired since this day was logged still count, so show them.
  const ghosts = checked.map(itemById).filter((it) => it && it.archived);
  el("sheet-ghosts").innerHTML = ghosts.length
    ? "<p>Retired items counted on this day: " +
      ghosts.map((it) => esc(it.label) + " (+" + it.points + ")").join(", ") + "</p>"
    : "";
  el("sheet-clear").hidden = checked.length === 0;
}

/* -------------------------------------------------------------- actions */

function toggleItem(id, dateKey) {
  if (!DATE_RE.test(dateKey) || !itemById(id)) return;
  const cur = Array.isArray(history[dateKey]) ? history[dateKey].slice() : [];
  const at = cur.indexOf(id);
  if (at >= 0) cur.splice(at, 1); else cur.push(id);
  if (cur.length) history[dateKey] = cur; else delete history[dateKey];
  saveHistory();
  render();
}

function clearDay(dateKey) {
  delete history[dateKey];
  saveHistory();
  render();
}

function exportPayload() {
  return {
    app: "daily-ledger",
    version: VERSION,
    exportedAt: new Date().toISOString(),
    target: target(),
    items,
    history
  };
}

function downloadExport() {
  const blob = new Blob([JSON.stringify(exportPayload(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "daily-ledger-" + keyOf(new Date()) + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  flash("Downloaded.");
}

async function copyExport() {
  const text = JSON.stringify(exportPayload(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    flash("Copied to clipboard.");
  } catch {
    // Clipboard API needs a secure context and a permission; fall back to
    // showing the text so it can always be copied by hand.
    el("import-text").value = text;
    flash("Clipboard unavailable — text placed in the box below.");
  }
}

function parseImport(text) {
  let data;
  try { data = JSON.parse(text); }
  catch { return { error: "That is not valid JSON." }; }
  const rawHistory = data && typeof data === "object" && data.history ? data.history : data;
  const parsed = normalizeHistory(rawHistory);
  const days = Object.keys(parsed).length;
  if (!days) return { error: "No dated entries found in that file." };
  const parsedItems = data && Array.isArray(data.items) ? normalizeItems(data.items) : null;
  return { history: parsed, items: parsedItems, days };
}

function applyImport(mode) {
  const p = state.pendingImport;
  if (!p) return;
  if (mode === "replace") {
    history = p.history;
    if (p.items) items = p.items;
  } else {
    for (const [key, ids] of Object.entries(p.history)) {
      history[key] = [...new Set([...(history[key] || []), ...ids])];
    }
    // A merge must not lose the definitions the imported ids refer to.
    if (p.items) {
      for (const it of p.items) if (!itemById(it.id)) items.push({ ...it, archived: true });
    }
  }
  saveHistory(); saveItems();
  state.pendingImport = null;
  el("import-text").value = "";
  el("import-preview").hidden = true;
  flash(mode === "replace" ? "History replaced." : "History merged.");
  render();
}

function flash(msg) {
  const box = el("flash");
  box.textContent = msg;
  box.hidden = false;
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => { box.hidden = true; }, 4000);
}

function addItem() {
  const id = "item-" + Math.random().toString(36).slice(2, 8);
  items.push({ id, label: "New habit", note: "", points: 1 });
  saveItems();
  render();
  const row = document.querySelector('.edit-row[data-id="' + id + '"] .edit-label');
  if (row) { row.focus(); row.select(); }
}

/* --------------------------------------------------------------- events */

document.addEventListener("click", (e) => {
  const hit = e.target.closest("[data-action], [data-view], [data-theme-choice]");
  if (!hit) return;

  if (hit.dataset.view) { state.view = hit.dataset.view; render(); return; }

  if (hit.dataset.themeChoice) {
    settings.theme = hit.dataset.themeChoice;
    saveSettings(); applyTheme(); render();
    return;
  }

  const row = hit.closest(".edit-row");
  const id = row ? row.dataset.id : null;

  switch (hit.dataset.action) {
    case "toggle":     toggleItem(hit.dataset.id, hit.dataset.date); break;
    case "open-day":   openSheet(hit.dataset.date, hit); break;
    case "close-sheet": closeSheet(); break;
    case "clear-day":  clearDay(state.sheetDate); renderSheet(); break;
    case "nudge-open": openSheet(hit.dataset.date, hit); break;
    case "nudge-dismiss":
      state.nudgeDismissed = keyOf(addDays(new Date(), -1));
      render();
      break;
    case "cal-prev":
      state.month = { y: state.month.m === 0 ? state.month.y - 1 : state.month.y, m: (state.month.m + 11) % 12 };
      render();
      break;
    case "cal-next":
      state.month = { y: state.month.m === 11 ? state.month.y + 1 : state.month.y, m: (state.month.m + 1) % 12 };
      render();
      break;
    case "cal-today": state.month = null; render(); break;
    case "target-down": settings.target = Math.max(1, target() - 1); saveSettings(); render(); break;
    case "target-up":   settings.target = Math.min(maxPoints(), target() + 1); saveSettings(); render(); break;
    case "pts-down": { const it = itemById(id); if (it) { it.points = Math.max(0, it.points - 1); saveItems(); render(); } break; }
    case "pts-up":   { const it = itemById(id); if (it) { it.points = Math.min(99, it.points + 1); saveItems(); render(); } break; }
    case "archive":  { const it = itemById(id); if (it) { it.archived = true; saveItems(); render(); } break; }
    case "restore":  { const it = itemById(id); if (it) { it.archived = false; saveItems(); render(); } break; }
    case "add-item": addItem(); break;
    case "export-download": downloadExport(); break;
    case "export-copy": copyExport(); break;
    case "import-check": {
      const result = parseImport(el("import-text").value);
      const preview = el("import-preview");
      if (result.error) { preview.hidden = false; el("import-summary").textContent = result.error; el("import-apply").hidden = true; }
      else {
        state.pendingImport = result;
        preview.hidden = false;
        el("import-summary").textContent = result.days + " days found" + (result.items ? ", with item definitions" : "") + ".";
        el("import-apply").hidden = false;
      }
      break;
    }
    case "import-merge":   applyImport("merge"); break;
    case "import-replace": applyImport("replace"); break;
    case "erase-all":
      if (confirm("Erase all history and items on this device? Export first — this cannot be undone.")) {
        history = {}; items = DEFAULT_ITEMS.map((it) => ({ ...it })); settings = { ...DEFAULT_SETTINGS };
        saveHistory(); saveItems(); saveSettings(); applyTheme(); render();
        flash("Erased.");
      }
      break;
  }
});

// Item label and sub-note edits.
document.addEventListener("input", (e) => {
  const field = e.target.dataset && e.target.dataset.field;
  if (!field) return;
  const row = e.target.closest(".edit-row");
  const it = row && itemById(row.dataset.id);
  if (!it) return;
  it[field] = e.target.value;
  saveItems();
});

document.addEventListener("change", (e) => {
  if (e.target.id !== "import-file") return;
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  file.text().then((text) => {
    el("import-text").value = text;
    document.querySelector('[data-action="import-check"]').click();
  });
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !el("sheet").hidden) closeSheet();
});

el("sheet").addEventListener("click", (e) => {
  if (e.target === el("sheet")) closeSheet();   // backdrop
});

// A tab left open overnight rolls over: on return, and on the stroke itself.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { reload(); render(); }
});

window.addEventListener("storage", (e) => {
  if ([KEY_HISTORY, KEY_ITEMS, KEY_SETTINGS].includes(e.key)) { reload(); render(); }
});

function reload() {
  history  = normalizeHistory(readJSON(KEY_HISTORY, {}));
  items    = normalizeItems(readJSON(KEY_ITEMS, null));
  settings = normalizeSettings(readJSON(KEY_SETTINGS, null));
  applyTheme();
}

function scheduleMidnight() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  setTimeout(() => { render(); scheduleMidnight(); }, midnight - now);
}

/* ----------------------------------------------------------------- boot */

function render() {
  const today = new Date();
  applyTheme();
  renderTabs();
  renderMasthead(today);
  renderNudge(today);
  if (state.view === "today")    renderToday(today);
  if (state.view === "calendar") renderCalendar(today);
  if (state.view === "stats")    renderStats(today);
  if (state.view === "settings") renderSettings();
  if (state.sheetDate) renderSheet();
}

applyTheme();
render();
scheduleMidnight();
