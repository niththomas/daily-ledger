/* Daily Ledger — single-user, offline-first habit ledger.
 * State lives in one localStorage key; everything on screen is recomputed
 * from it. No derived values are ever stored. */

/* ---------------------------------------------------------------- model */

const ITEMS = [
  { id: "book",     label: "Read 10 pages of a book",     note: "deep reading",                        points: 2 },
  { id: "longform", label: "Long-form video or podcast",  note: "substantive, not scrolling",          points: 1 },
  { id: "paper",    label: "Read an academic paper",      note: "abstract, conclusion, skim the middle", points: 1 },
  { id: "writing",  label: "Write 200+ words",            note: "journal, essay, notes",               points: 2 },
  { id: "explain",  label: "Explain something you learned", note: "to a person or a rubber duck",      points: 1 },
  { id: "phone",    label: "Phone-free first & last 30 min", note: "protect the edges of the day",      points: 1 },
  { id: "offline",  label: "One continuous hour offline", note: "no notifications, no checks",          points: 1 },
  { id: "sleep",    label: "Sleep 8+ hours",              note: "memory consolidation",                points: 2 },
  { id: "cardio",   label: "Cardio: 10k steps or 20 min", note: "BDNF, processing speed",              points: 1 }
];

const MAX = ITEMS.reduce((s, i) => s + i.points, 0); // 12
const TARGET = 10;
const KEY = "ledger-history";

/* ------------------------------------------------------------ storage */

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
  catch { return {}; }
}

function saveHistory(history) {
  try { localStorage.setItem(KEY, JSON.stringify(history)); }
  catch (e) { /* quota or private-mode failure: keep working in memory */ }
}

// Single in-memory copy of the source of truth. If localStorage throws
// (private mode, quota) the session still works, it just does not survive.
let history = loadHistory();

/* ------------------------------------------------------------ compute */

function keyOf(d) {
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function pointsFor(ids) {
  if (!ids) return 0;
  return ITEMS.reduce((s, it) => ids.includes(it.id) ? s + it.points : s, 0);
}

// Streak: consecutive days meeting TARGET, ending today.
// If today is still below target, count from yesterday so an unfinished
// morning does not zero an existing streak.
function computeStreak(history, today) {
  let n = 0;
  let cursor = new Date(today);
  if (pointsFor(history[keyOf(today)]) < TARGET) cursor = addDays(cursor, -1);
  for (let i = 0; i < 400; i++) {
    if (pointsFor(history[keyOf(cursor)]) >= TARGET) { n++; cursor = addDays(cursor, -1); }
    else break;
  }
  return n;
}

// 14-day strip: oldest to newest, newest is today.
function last14(history, today) {
  const out = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(today, -i);
    out.push({ key: keyOf(d), pts: pointsFor(history[keyOf(d)]), isToday: i === 0 });
  }
  return out;
}

function statusText(pts) {
  if (pts >= MAX) return { text: "Perfect day. All 12 quanta.", warm: true };
  if (pts >= TARGET) return { text: "Target reached (+" + (pts - TARGET) + ").", warm: true };
  return { text: (TARGET - pts) + " to target. Ceiling is " + MAX + ".", warm: false };
}

/* --------------------------------------------------------------- view */

const el = {
  date:   document.getElementById("date"),
  streak: document.getElementById("streak"),
  streakN: document.getElementById("streak-count"),
  ladder: document.getElementById("ladder"),
  score:  document.getElementById("score"),
  status: document.getElementById("status"),
  list:   document.getElementById("list"),
  strip:  document.getElementById("strip"),
  live:   document.getElementById("live")
};

const CHECK_SVG =
  '<svg class="box-check" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" ' +
  'stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// The scaffold is built once and thereafter only its state classes change.
// Rebuilding the nodes on every render would restart CSS transitions and
// drop keyboard focus mid-interaction; the scaffold is pure function of
// ITEMS/MAX, so nothing about it is state-dependent anyway.
function buildScaffold() {
  if (el.ladder.childElementCount !== MAX) {
    let html = "";
    for (let level = MAX; level >= 1; level--) {
      html += '<div class="quantum" data-level="' + level + '">' +
              (level === TARGET ? '<span class="target-line"></span>' : "") +
              '</div>';
    }
    el.ladder.innerHTML = html;
  }

  if (el.list.childElementCount !== ITEMS.length) {
    el.list.innerHTML = ITEMS.map((it) =>
      '<button class="row" type="button" data-id="' + it.id + '" aria-pressed="false">' +
        '<span class="box">' + CHECK_SVG + '</span>' +
        '<span class="row-text">' +
          '<span class="row-label"></span>' +
          '<span class="row-note"></span>' +
        '</span>' +
        '<span class="row-pts">+' + it.points + '</span>' +
      '</button>'
    ).join("");
    // Labels go in as text, not markup, so item copy can never inject HTML.
    ITEMS.forEach((it, i) => {
      const row = el.list.children[i];
      row.querySelector(".row-label").textContent = it.label;
      row.querySelector(".row-note").textContent = it.note;
    });
  }

  if (el.strip.childElementCount !== 14) {
    let html = '<span class="strip-guide" aria-hidden="true"></span>';
    for (let i = 0; i < 14; i++) {
      html += '<span class="strip-col"><span class="strip-bar"></span></span>';
    }
    el.strip.innerHTML = html;
  }
}

function render() {
  buildScaffold();

  const today = new Date();
  const todayKey = keyOf(today);
  const checked = history[todayKey] || [];
  const pts = pointsFor(checked);
  const streak = computeStreak(history, today);

  /* header */
  el.date.textContent = today.toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric"
  });
  el.streak.hidden = streak === 0;
  el.streakN.textContent = streak;
  el.streak.setAttribute("aria-label", streak + " day streak at target");

  /* hero */
  el.score.textContent = pts;
  const st = statusText(pts);
  el.status.textContent = st.text;
  el.status.classList.toggle("is-warm", st.warm);
  el.ladder.setAttribute("aria-label", pts + " of " + MAX + " points, target " + TARGET);
  el.ladder.classList.toggle("is-complete", pts >= TARGET);

  for (const cell of el.ladder.children) {
    const level = Number(cell.dataset.level);
    cell.classList.toggle("is-on", level <= pts);
    cell.classList.toggle("is-over", level > TARGET);
  }

  /* checklist */
  for (const row of el.list.children) {
    const on = checked.includes(row.dataset.id);
    row.classList.toggle("is-on", on);
    row.setAttribute("aria-pressed", on ? "true" : "false");
  }

  /* 14-day strip */
  const days = last14(history, today);
  const cols = el.strip.querySelectorAll(".strip-col");
  days.forEach((d, i) => {
    const col = cols[i];
    const bar = col.firstElementChild;
    bar.style.height = d.pts === 0 ? "" : Math.round((d.pts / MAX) * 100) + "%";
    col.classList.toggle("is-today", d.isToday);
    bar.classList.toggle("is-empty", d.pts === 0);
    bar.classList.toggle("is-met", d.pts >= TARGET);
    col.title = d.key + " — " + d.pts + "/" + MAX;
  });

  el.live.textContent = pts + " of " + MAX + " points. " + st.text;
}

/* ---------------------------------------------------------- interaction */

function toggle(id) {
  if (!ITEMS.some((it) => it.id === id)) return;
  const k = keyOf(new Date());
  const cur = Array.isArray(history[k]) ? history[k].slice() : [];
  const at = cur.indexOf(id);
  if (at >= 0) cur.splice(at, 1); else cur.push(id); // one toggle per item per day
  if (cur.length) history[k] = cur; else delete history[k];
  saveHistory(history);
  render();
}

// Delegated on the stable list container.
el.list.addEventListener("click", (e) => {
  const row = e.target.closest(".row");
  if (row && el.list.contains(row)) toggle(row.dataset.id);
});

// A tab left open overnight rolls to the new day when it comes back.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { history = loadHistory(); render(); }
});

// Another tab or window wrote to the same key.
window.addEventListener("storage", (e) => {
  if (e.key === KEY) { history = loadHistory(); render(); }
});

render();
