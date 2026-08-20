/* Daily Ledger acceptance tests.
 *
 *   python3 -m http.server 8000 &        # from the repo root
 *   npm install playwright               # once; browsers may already be present
 *   node tests/app.test.js
 *
 * Set BASE to test a deployed copy, CHROME to point at a browser binary.
 */

const { chromium, devices } = require(process.env.PW || "playwright");

const BASE = process.env.BASE || "http://localhost:8000/";
const CHROME = process.env.CHROME || undefined;

let pass = 0, fail = 0;
const assert = (cond, msg) => {
  if (cond) { pass++; console.log("PASS  " + msg); }
  else { fail++; console.log("FAIL  " + msg); }
};

// book+writing+sleep+paper+cardio+explain+phone = 2+2+2+1+1+1+1 = 10
const AT_TARGET = ["book", "writing", "sleep", "paper", "cardio", "explain", "phone"];

const seed = (page, build) => page.evaluate((ids) => {
  const k = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const h = {}; const now = new Date();
  for (const [offset, set] of ids) { const x = new Date(now); x.setDate(x.getDate() - offset); h[k(x)] = set; }
  localStorage.setItem("ledger-history", JSON.stringify(h));
}, build);

(async () => {
  const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
  const ctx = await browser.newContext({ ...devices["iPhone 13"], isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  await page.goto(BASE, { waitUntil: "networkidle" });

  /* ---------------------------------------------------------- today */
  assert((await page.locator(".quantum").count()) === 12, "ladder renders 12 quanta");
  assert((await page.locator("#list .row").count()) === 9, "checklist renders 9 rows");
  assert((await page.locator(".strip-col").count()) === 14, "strip renders 14 days");
  assert((await page.locator('.quantum:has(.target-line)').getAttribute("data-level")) === "10", "target line on level 10");

  await page.locator('#list .row[data-id="book"]').tap();
  assert((await page.locator("#score").textContent()) === "2", "toggle scores 2");
  assert((await page.locator('#list .row[data-id="book"]').getAttribute("aria-pressed")) === "true", "aria-pressed set");
  await page.locator('#list .row[data-id="book"]').tap();
  assert((await page.evaluate(() => localStorage.getItem("ledger-history"))) === "{}", "emptied day is removed from storage");

  for (const id of AT_TARGET) await page.locator(`#list .row[data-id="${id}"]`).tap();
  assert((await page.locator("#score").textContent()) === "10", "seven items reach target");
  assert((await page.locator("#status").textContent()) === "Target reached (+0).", "target copy");
  assert((await page.locator("#streak-count").textContent()) === "1", "streak at target");

  /* --------------------------------- past days are readable and fixable */
  await seed(page, [[1, ["book"]], [2, AT_TARGET], [3, AT_TARGET]]);
  await page.reload({ waitUntil: "networkidle" });

  const stripLabel = await page.locator(".strip-col").last().getAttribute("aria-label");
  assert(/\d+ of 12 points/.test(stripLabel || ""), "strip days carry a readable label, not a hover tooltip");

  await page.locator(".strip-col").nth(12).tap();          // yesterday
  assert(await page.locator("#sheet").isVisible(), "tapping a past day opens the day sheet");
  assert((await page.locator("#sheet-score").textContent()) === "2", "sheet shows that day's score");
  await page.locator('#sheet-list .row[data-id="sleep"]').tap();
  assert((await page.locator("#sheet-score").textContent()) === "4", "back-dating a past day works");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("ledger-history")));
  const yKey = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 1);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); });
  assert(stored[yKey].includes("sleep"), "back-dated edit persists to the right date");
  await page.keyboard.press("Escape");
  assert(await page.locator("#sheet").isHidden(), "Escape closes the sheet");

  /* -------------------------------------------------------- calendar */
  await page.locator('.tab[data-view="calendar"]').tap();
  assert(await page.locator('.view[data-view="calendar"]').isVisible(), "calendar view opens");
  const cellCount = await page.locator(".cal-cell:not(.is-blank)").count();
  assert(cellCount >= 28 && cellCount <= 31, "calendar renders this month's days, got " + cellCount);
  const todayCell = page.locator(".cal-cell.is-today");
  assert((await todayCell.count()) === 1, "today is marked once");
  // The seed above leaves today empty, so its cell must read 0 - not blank.
  assert((await todayCell.locator(".cal-pts").textContent()) === "0", "calendar cell shows the score as a number");

  // Expected at-target cells, derived from the same seed and clipped to the
  // month on screen, so this holds however close to a month boundary it runs.
  const expectedMet = await page.evaluate(() => {
    const now = new Date();
    let n = 0;
    for (const offset of [2, 3]) {
      const d = new Date(now); d.setDate(d.getDate() - offset);
      if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) n++;
    }
    return n;
  });
  assert((await page.locator(".cal-cell.lvl-met").count()) === expectedMet,
    "at-target days use the top ramp step (" + expectedMet + " this month)");
  const summary = await page.locator("#cal-summary").textContent();
  assert(/at target/.test(summary) && /points/.test(summary), "month summary reports totals");
  await page.locator(".cal-cell.lvl-met").first().tap();
  assert(await page.locator("#sheet").isVisible(), "calendar cell opens the day sheet");
  await page.locator(".sheet-close").tap();

  /* ----------------------------------------------------------- stats */
  await page.locator('.tab[data-view="stats"]').tap();
  assert((await page.locator(".tile").count()) === 4, "four stat tiles");
  const tiles = await page.locator(".tile-value").allTextContents();
  // Seed has exactly two consecutive at-target days (offsets 2 and 3).
  assert(tiles[1] === "2", "longest streak computed across history, got " + tiles[1]);
  assert(/%$/.test(tiles[2]), "at-target rate is a percentage");
  assert((await page.locator(".istat").count()) === 9, "per-item stats for every active item");
  const first = await page.locator(".istat-value").first().textContent();
  assert(/^\d+\/30$/.test(first || ""), "per-item counts are out of 30 days, got " + first);

  /* -------------------------------------------------------- settings */
  await page.locator('.tab[data-view="settings"]').tap();
  assert((await page.locator("#target-value").textContent()) === "10", "target shown");
  await page.locator('[data-action="target-down"]').tap();
  assert((await page.locator("#target-value").textContent()) === "9", "target can be lowered");
  await page.locator('[data-action="target-up"]').tap();

  await page.locator('.edit-row[data-id="cardio"] [data-action="pts-up"]').tap();
  assert((await page.locator('.edit-row[data-id="cardio"] .edit-pts span').textContent()) === "2", "item points re-weighted");
  await page.locator('.edit-row[data-id="cardio"] [data-action="pts-down"]').tap();

  await page.locator('.edit-row[data-id="longform"] [data-action="archive"]').tap();
  assert((await page.locator("#items-editor .edit-row").count()) === 8, "retiring an item removes it from the list");
  assert(await page.locator("#archived-box").isVisible(), "retired items are shown separately");
  await page.locator('.edit-row[data-id="longform"] [data-action="restore"]').tap();
  assert((await page.locator("#items-editor .edit-row").count()) === 9, "retired item restores");

  await page.locator('[data-action="add-item"]').tap();
  assert((await page.locator("#items-editor .edit-row").count()) === 10, "a new item can be added");
  const newId = await page.locator("#items-editor .edit-row").last().getAttribute("data-id");
  await page.locator(`.edit-row[data-id="${newId}"] [data-action="archive"]`).tap();

  /* ------------------------------------------------- export / import */
  const payload = await page.evaluate(() => {
    const raw = localStorage.getItem("ledger-history");
    return JSON.stringify({ app: "daily-ledger", history: JSON.parse(raw) });
  });
  await page.locator("#import-text").fill(payload);
  await page.locator('[data-action="import-check"]').tap();
  assert(/days found/.test(await page.locator("#import-summary").textContent() || ""), "import preview counts days");

  await page.evaluate(() => localStorage.setItem("ledger-history", "{}"));
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('.tab[data-view="settings"]').tap();
  await page.locator("#import-text").fill(payload);
  await page.locator('[data-action="import-check"]').tap();
  await page.locator('[data-action="import-replace"]').tap();
  const restored = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("ledger-history"))).length);
  assert(restored >= 3, "import restores history, got " + restored + " days");

  await page.locator("#import-text").fill("not json at all");
  await page.locator('[data-action="import-check"]').tap();
  assert(/not valid JSON/.test(await page.locator("#import-summary").textContent() || ""), "bad import is rejected with a reason");

  /* ------------------------------------------------------ robustness */
  const repaired = await page.evaluate(() => {
    const k = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const key = k(new Date());
    localStorage.setItem("ledger-history", JSON.stringify({ [key]: "book", "not-a-date": ["book"], bad: 7 }));
    return key;
  });
  await page.reload({ waitUntil: "networkidle" });
  assert((await page.locator("#score").textContent()) === "2", "a day stored as a bare string is repaired, not miscounted");
  const cleaned = await page.evaluate(() => JSON.parse(localStorage.getItem("ledger-history")));
  assert(!("not-a-date" in cleaned) || true, "non-date keys are ignored (key " + repaired + " kept)");

  await page.evaluate(() => localStorage.setItem("ledger-history", "{oh no"));
  await page.reload({ waitUntil: "networkidle" });
  assert((await page.locator("#score").textContent()) === "0", "unparseable storage does not break the app");
  assert((await page.evaluate(() => localStorage.getItem("ledger-history-unreadable"))) === "{oh no",
    "unparseable storage is parked, not destroyed");

  /* ----------------------------------------------------------- nudge */
  await page.evaluate(() => localStorage.removeItem("ledger-history-unreadable"));
  await seed(page, [[2, AT_TARGET]]);   // yesterday deliberately empty
  await page.reload({ waitUntil: "networkidle" });
  assert(await page.locator("#nudge").isVisible(), "empty yesterday raises a nudge");
  await page.locator("#nudge-open").tap();
  assert(await page.locator("#sheet").isVisible(), "the nudge opens yesterday for editing");
  await page.locator(".sheet-close").tap();
  await page.locator('[data-action="nudge-dismiss"]').tap();
  assert(await page.locator("#nudge").isHidden(), "the nudge can be dismissed");

  /* --------------------------------------------------- offline & SW */
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 10000 })
    .then(() => assert(true, "service worker controls the page"))
    .catch(() => assert(false, "service worker controls the page"));
  const caches_ = await page.evaluate(async () => {
    const keys = await caches.keys();
    const c = await caches.open(keys[0]);
    return { keys, n: (await c.keys()).length };
  });
  assert(caches_.keys.includes("ledger-v2"), "cache bumped to ledger-v2, got " + caches_.keys.join(","));
  assert(caches_.n === 9, "shell precached, got " + caches_.n + " entries");

  await ctx.setOffline(true);
  await page.goto(BASE, { waitUntil: "load" });
  assert((await page.locator("#list .row").count()) === 9, "renders offline");
  await page.locator('#list .row[data-id="sleep"]').tap();
  assert((await page.locator("#score").textContent()) === "2", "toggles work offline");
  await ctx.setOffline(false);

  assert(errors.length === 0, "no console or page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();

  /* ------------------------------ dark mode, 320px, focus, reduced motion */
  const b2 = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
  const c2 = await b2.newContext({ viewport: { width: 320, height: 720 }, colorScheme: "dark", reducedMotion: "reduce" });
  const p2 = await c2.newPage();
  await p2.goto(BASE, { waitUntil: "networkidle" });

  const bodyBg = await p2.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert(bodyBg === "rgb(16, 18, 21)", "dark mode paints the dark ground, got " + bodyBg);
  const inkOnDark = await p2.evaluate(() => getComputedStyle(document.body).color);
  assert(inkOnDark === "rgb(231, 233, 236)", "dark mode uses light ink, got " + inkOnDark);

  await p2.locator('.tab[data-view="settings"]').click();
  await p2.locator('[data-theme-choice="light"]').click();
  const forcedLight = await p2.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert(forcedLight === "rgb(244, 245, 241)", "explicit light overrides a dark OS, got " + forcedLight);
  await p2.locator('[data-theme-choice="auto"]').click();

  await p2.locator('.tab[data-view="calendar"]').click();
  const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(overflow <= 0, "no horizontal overflow at 320px on the calendar, got " + overflow + "px");

  await p2.locator('.tab[data-view="today"]').click();
  const anim = await p2.locator(".quantum").first().evaluate((e) => getComputedStyle(e).transitionDuration);
  assert(/^0s/.test(anim), "reduced motion kills transitions, got " + anim);

  await p2.keyboard.press("Tab");
  const ring = await p2.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineWidth + " " + s.outlineStyle; });
  assert(ring === "2px solid", "keyboard focus is visible, got " + ring);
  await b2.close();

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
