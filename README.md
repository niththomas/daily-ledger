# Daily Ledger

An installable, offline-first PWA that tracks a daily "intellectual habit" score.
Nine items, twelve points available, ten is the target. Single user, single
device, no backend, no accounts, no network calls after first load.

Live once Pages is enabled: <https://niththomas.github.io/daily-ledger/>

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

`MAX = 12`, `TARGET = 10` — so one 2-point item, or two 1-point items, can be
missed and the day still counts. **Streak** is consecutive days at or above
target ending today; if today is still below target the count starts at
yesterday, so an unfinished morning never zeroes an existing streak.

## Stack

Vanilla HTML, CSS and JS. No framework, no bundler, no build step. Persistence
is a single `localStorage` key, `ledger-history`:

```json
{ "2026-08-20": ["book", "writing", "sleep"], "2026-08-19": ["book", "paper"] }
```

Each date maps to the checked item ids for that day. Nothing derived is stored —
points, streak and the 14-day strip are always recomputed from this object.
Date keys use **local** calendar components, so the day boundary is local
midnight; a tab left open overnight rolls over on `visibilitychange`.

## Files

```
daily-ledger/
  index.html          # markup, head meta, service-worker registration
  styles.css          # tokens in :root, then components
  app.js              # ITEMS, state, compute, render, delegated click handler
  manifest.json
  sw.js               # cache-first app shell
  icons/              # 192, 512, 512 maskable, apple-touch 180
```

## Run locally

Service workers need a secure context; `localhost` counts.

```bash
cd daily-ledger
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy

This is a standalone repo, served as a GitHub Pages *project* site:

1. Settings → Pages → Source: deploy from branch, `main`, `/ (root)`.
2. It goes live at `https://niththomas.github.io/daily-ledger/` — a project
   repo publishes under its own name, so this is the same URL the app had
   when it lived in the `niththomas.github.io` repo. Anything already added
   to a home screen keeps working.

On iPhone: open the URL in Safari → Share → Add to Home Screen.

Every asset path is **relative** (`./`, `icons/…`, `manifest.json`), never
root-absolute, so the app works under the Pages subpath. That is the single
most common thing that breaks a Pages PWA.

**Bump `CACHE` in `sw.js` on every deploy** (`ledger-v1` → `ledger-v2` → …) or
installed clients keep serving the old files.

## Regenerating icons

```bash
python3 -m pip install pillow
python3 tools/make-icons.py    # writes the four PNGs into icons/
```

The apple-touch icon must stay a real opaque PNG — iOS ignores the manifest
icons for the home-screen glyph.

## Testing by hand

Seed some history from the console on the running app:

```js
const h = {};
const d = new Date();
for (let i = 0; i < 6; i++) {
  const x = new Date(d); x.setDate(x.getDate() - i);
  const k = x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")+"-"+String(x.getDate()).padStart(2,"0");
  h[k] = ["book","writing","sleep","paper","cardio","explain"]; // 10 pts — at target
}
localStorage.setItem("ledger-history", JSON.stringify(h)); location.reload();
```

Checks worth running: install prompt in DevTools → Application → Manifest;
reload with Network → Offline; toggle three items and fully quit/reopen; set
the device date forward a day; 320px width; keyboard Tab focus rings; reduced
motion.

## Not in v1 (deliberate)

- **Notifications** for the phone-free and offline-hour items. Installed PWAs
  do support Web Push on iOS 16.4+, but it needs a push service and a
  permission flow. Deferred.
- **Apple Health auto-check for `cardio`.** A pure PWA cannot read HealthKit
  step counts. This is the one feature that would justify wrapping the app
  natively (Capacitor) or going native. Until then `cardio` is a manual tap.
- **Editing past days, a settings screen, JSON export/import.**

Later, if history grows or per-item timestamps arrive, persistence moves to
IndexedDB with the same data shape. Cross-device sync is where an account and a
backend would enter; per-device data is the deliberate v1 tradeoff.
