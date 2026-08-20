# Daily Ledger

An installable, offline-first PWA that tracks a daily "intellectual habit"
score. Nine items, twelve points available, ten is the target. Single user,
single device, no backend, no accounts, no network calls after first load.

Live: <https://niththomas.github.io/daily-ledger/>

## What it does

**Today** — tap items on or off; the quantum ladder fills from the bottom, teal
to target and warm gold for the two overflow levels. The 14-day strip below is
tappable: any bar opens that day.

**Calendar** — a month grid with the score printed in every cell, shaded on a
single-hue ramp so intensity reads at a glance. A gold pip marks a perfect day.
Tap any cell to open it. Month totals sit underneath.

**Any past day is editable.** Forgetting to log before bed used to freeze a day
wrong forever and silently truncate the streak; now you open it and fix it. If
yesterday was never logged at all, the app says so on your next visit — a nudge
that needs no push infrastructure.

**Stats** — current streak, longest streak, at-target rate over the last 30
days, days logged all time, average points per logged day, and a ranked
per-item breakdown. The bottom of that list is the useful part: the habit you
keep missing is either mis-weighted or the wrong habit.

**Settings** — move the target, edit item names, notes and point values, add
items, retire ones you've outgrown, switch theme, and export or import your
history.

## Scoring

| Item | Points |
|------|--------|
| Read 10 pages of a book | 2 |
| Long-form video or podcast | 1 |
| Read an academic paper | 1 |
| Write 200+ words | 2 |
| Explain something you learned | 1 |
| Phone-free first & last 30 min | 1 |
| One continuous hour offline | 1 |
| Sleep 8+ hours | 2 |
| Cardio: 10k steps or 20 min | 1 |

Twelve available, ten the target, so one 2-point item or two 1-point items can
be missed and the day still counts. Both the target and the items are editable.

**Streak** is consecutive days at or above target ending today; if today is
still below target the count starts at yesterday, so an unfinished morning
never zeroes a live streak.

## Data

Three `localStorage` keys, all local to the browser that wrote them:

```
ledger-history    { "2026-08-20": ["book", "writing", "sleep"] }
ledger-items      [{ id, label, note, points, archived? }]
ledger-settings   { target, theme }
```

Nothing derived is stored. Points, streaks, rates, the calendar and the strip
are recomputed from history on every render. Date keys use **local** calendar
components, so the day boundary is local midnight; the app rolls over both on
`visibilitychange` and on a timer at midnight itself.

Two deliberate properties:

- **Retiring an item does not rewrite the past.** Archived items still score on
  the days they were logged, and the day sheet lists them.
- **Unreadable storage is never destroyed.** A value that won't parse is moved
  to `<key>-unreadable` rather than dropped, and a day stored in the wrong
  shape is repaired instead of silently miscounted.

### Back it up

Settings → Data → **Download backup** (or Copy as JSON). Import accepts a
backup file or pasted JSON and offers merge or replace.

Do this occasionally. Everything lives in one origin's `localStorage`: clearing
website data, or an OS storage eviction, wipes it with no recovery. Installing
to the home screen also makes the data more durable — Safari's 7-day cap on
script-writable storage does not apply to installed web apps.

## Run locally

Service workers need a secure context; `localhost` counts.

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Tests

57 assertions in headless Chromium — scoring, back-dating, the calendar, stats,
import/export, storage repair, the nudge, offline behaviour, dark mode, 320px
layout and keyboard focus.

```bash
python3 -m http.server 8000 &
npm install playwright
node tests/app.test.js
```

`BASE` points it at a deployed copy; `CHROME` at a browser binary if Playwright
can't find one.

## Deploy

A GitHub Pages *project* site: Settings → Pages → deploy from branch `main`,
`/ (root)`. A project repo publishes under its own name, so it serves at
`https://niththomas.github.io/daily-ledger/`.

On iPhone: open the URL in Safari → Share → Add to Home Screen.

Every asset path is **relative** (`./`, `icons/…`), never root-absolute, so the
app works under the Pages subpath. That is the single most common thing that
breaks a Pages PWA.

**Bump `CACHE` in `sw.js` on every deploy** (`ledger-v2` → `ledger-v3` → …) or
installed clients keep serving the old files.

## Regenerating icons

```bash
python3 -m pip install pillow
python3 tools/make-icons.py
```

The apple-touch icon must stay a real opaque PNG — iOS ignores the manifest
icons for the home-screen glyph.

## Design notes

Colour does one job at a time: a single teal hue carries magnitude (light to
dark on the calendar, height on the strip), and warm gold is reserved for
target and overflow — never a second data hue. The teal/gold pair was checked
for colour-vision separation (ΔE 14.8 protan, 21.5 normal) so the ladder still
reads when the hues don't. Dark mode is its own set of steps from the same hue,
chosen against the dark surface rather than flipped.

## Not built

- **Web Push reminders.** Installed PWAs support them on iOS 16.4+, but it
  needs a push service and a permission flow. The empty-yesterday nudge covers
  the common case without any of that.
- **Apple Health for `cardio`.** A pure PWA cannot read HealthKit step counts.
  This is the one feature that would justify wrapping the app natively.
- **Cross-device sync.** That is where an account and a backend enter; data
  staying on one device is the deliberate tradeoff.
