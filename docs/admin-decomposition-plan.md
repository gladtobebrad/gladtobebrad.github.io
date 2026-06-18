# admin.html decomposition — working plan

**Status:** Deferred from Wave 2 (a CT event was starting; `admin.html` is live-critical and
there is no CI). This branch (`admin-decomposition`, off post-merge `main`) is where the work
resumes. Tracks audit item **F-20** (docs/code-audit.md §3, "Decompose `admin.html`").

The design below was produced and adversarially verified by a mapping workflow (119 items
mapped across the file; ordering, leaderboard-integrity, and the first step all checked
`goAhead: true`). Line numbers are against `admin.html` as of this branch (1966 lines) and will
drift as steps land — re-grep before each step.

---

## Goal

Break the 1,966-line inline `<script type="module">` in `admin.html` into per-tab + per-service
modules under `js/admin/`, behind a `js/admin.js` re-export **barrel** (mirroring the `js/ui.js`
split). `admin.html` stays the **shell** and keeps owning three things:

- **STATE** — the 6 `let`s (`surfers`, `events`, `users`, `clubs`, `activeTab`, `activeSurferTour`).
- **MARKUP** — `renderAdmin(container)` (the ~410-line template that builds all 5 tab panels +
  the Site Banners card + the modals; ends by calling `wireAdminEvents(container)`).
- **DISPATCH** — `wireAdminEvents(container)`, which shrinks to a ~15-line dispatcher that builds
  `ctx()` and calls the per-tab `wire*` controllers gated by `activeTab`.

Every *behavior* moves into a focused `js/admin/*.js` module. Optionally, `renderAdmin` can move
to `js/admin/render.js` as a final cosmetic step — not required, and the riskiest/last move.

---

## Shared-state strategy — CHOSEN: explicit per-controller context (no file-wide rename)

The shell keeps its 6 `let`s, `renderAdmin`, and `wireAdminEvents` **exactly as they are today**.
Each extracted controller is handed a fresh `ctx` object per render: current state **snapshots**
plus callbacks to write back. **No `state` object, no getters/setters, no event bus, and — the
deciding safety factor — no file-wide variable rename** (`events`/`surfers` collide with string
literals like `activeTab === "events"` and db names like `getEvents`; renaming them across 1966
lines on a no-CI site is the one change we explicitly avoided).

> The original workflow framed this as a live `state` object (`ctx.state.events`). We deliberately
> chose the **snapshot + `reload`/`rerender`** variant instead, so the shell's bare `let`s and
> `renderAdmin` are never touched — strictly lower blast radius. Wherever notes below say
> "ctx.state.X", read it as the chosen contract: `ctx.X` to read, `ctx.reload("X")` to write.

**The ctx factory** — add to the shell once, right after `const main = bootstrapPage();` (line 52):

```js
// Context handed to extracted js/admin/* controllers: current state snapshots + callbacks.
// The shell keeps owning the state vars + renderAdmin; controllers read ctx.<state> and write
// back via ctx.reload(...keys) / ctx.rerender().
const ctx = () => ({
  surfers, events, users, clubs, activeTab, activeSurferTour,   // current snapshots
  container: main,
  rerender: () => renderAdmin(main),
  reload: async (...keys) => {            // refetch named state into the shell (no render)
    if (keys.includes("surfers")) surfers = await getAllSurfers();
    if (keys.includes("events")) events = await getEvents(SEASON);
    if (keys.includes("users")) users = await getAllUsers();
    if (keys.includes("clubs")) { try { clubs = await getAllClubs(); } catch { clubs = []; } }
  },
});
```

- **Reads:** controllers use `ctx.surfers` etc. The snapshot is current as of the last render —
  and every state change triggers a rerender (which re-runs `wireAdminEvents` → re-wires with a
  fresh `ctx()`), so a click handler never observes stale state in practice.
- **Writes:** call `ctx.reload("surfers")` then `ctx.rerender()` — this mirrors today's
  `surfers = await getAllSurfers(); renderAdmin(container)` exactly (reload, then repaint).
- **`activeTab` / `activeSurferTour` writes** (tab + sub-tab switches): add `setActiveTab(t)` /
  `setActiveSurferTour(t)` callbacks to `ctx` when **surfers.js (step 6)** and the dispatcher
  (step 9) need them — each just sets the shell `let` and calls `renderAdmin(main)`.
- **Import-path note:** modules live in `js/admin/`, one level below `js/`. Sibling admin modules
  import `./other.js`; root `js/` modules import `../scoring.js`, `../db.js`, `../ui.js`, etc.;
  the firebase-storage CDN URL is absolute and unchanged. **Any moved `await import("./X")` must
  become `await import("../X")`** — grep each new module for `import("./` → must be 0.

---

## Target module layout (10 files)

Import lists below are the symbols each module needs; prefix root-`js/` modules with `../`.

| File | ~ln | Contains | Key imports |
|---|---|---|---|
| `js/admin.js` | 12 | flat re-export **barrel** (explicit named, not `export *`) of every `wire*` + `promptUpdateLeaderboard` / `recalcLeaderboardForTour` | `./admin/*.js` |
| `js/admin/leaderboard.js` | 215 | `recalcLeaderboardForTour` (**VERBATIM**) + `promptUpdateLeaderboard(ctx)` (+ nested `renderTourBlock`, `roundSuffix`) | scoring (scoreTeam, projectTeam, isInProgress, calculateSeasonStandings); db (getResults, getTeamsForEvent, getEvents, getAllUsers, **commitInChunks**, touchLeaderboardVersion); firebase-config (db); firestore (collection, doc, getDocs, query, where) — **NOT writeBatch**; config (SEASON, TOURS, tourLabel, tourLabelFull); ui (toast, confirmModal) |
| `js/admin/repricing.js` | 235 | `wireRepricing(ctx)` (today's IIFE: latestResultsEvent, computeRepricing, renderRepricePreview, apply handler) | wsl-scrape (fetchSeasonRankings); wsl-resolve (nameToKey); pricing (buildCurve, anchorValueForRank, emaStep, tenabilityReport, ALPHA, MAX_CHANGE, VALUE_STEP); config (SEASON, tourLabel); ui (formatSalary, escapeHtml, confirmModal, toast); firebase-config (db); firestore (doc, writeBatch). **getAllSurfers via `ctx.reload`, not imported.** |
| `js/admin/wsl-import.js` | 290 | `wireWslImport(ctx)` (btn-fetch-results + nested btn-save-scraped; wslLog, matchLocalEvent, renderScrapeSummary; scrapedByTour) | wsl-scrape (fetchSchedule, pickTargetVenue, discoverGenders, scrapeEventForGender); wsl-resolve (buildSurferIndex, resolveSurfer, computeFinishPositions, nameToKey); scoring (getPoints); db (getResults, saveResultsBatch, saveEvent, touchEventsVersion, getEvents); config (SEASON, TOURS, tourLabel); ui (confirmModal, toast, escapeHtml); **./leaderboard.js (promptUpdateLeaderboard)** |
| `js/admin/events.js` | 300 | `wireEvents(ctx)`; openEventModal/closeEventModal; event-form submit (incl 'both' dual-save); edit/delete/status-select; trading-toggle multi-step stepper | db (saveEvent, deleteEvent, getEvents, touchEventsVersion, getTeamsForEvent, carryForwardTeams, lockTeamsForEvent); config (SEASON, tourLabel); ui (confirmModal, toast, escapeHtml, safeUrl) |
| `js/admin/surfers.js` | 165 | `wireSurfers(ctx)`; tour sub-tab buttons (write activeSurferTour); openSurferModal; surfer-form submit (value validation vs WILDCARD_VALUE/RANKED_FLOOR/PEAK + VALUE_STEP; clears lastPricedEvent on value change); edit/delete/status | db (saveSurfer, deleteSurfer, getAllSurfers); pricing (WILDCARD_VALUE, RANKED_FLOOR, PEAK, VALUE_STEP); ui (confirmModal, toast, escapeHtml, safeUrl) |
| `js/admin/results.js` | 170 | `wireResults(ctx)`; results-event-select change + entry-grid; auto-points listener; results-entry-form submit (resultsSource='manual'); btn-clear-results | scoring (getPoints, getMaxFinishPosition); db (getResults, saveResultsBatch, clearResults, saveEvent, getEvents, touchEventsVersion); config (SEASON); ui (toast, confirmModal, escapeHtml); **./leaderboard.js (promptUpdateLeaderboard)** |
| `js/admin/banners.js` | 135 | `wireBanners(ctx)` (wireCountdownBanner body + setBannerToggleState). **Zero state coupling** — fetches via Firestore, reads no `ctx` state | db (getSiteConfig, saveSiteConfig, getCurrentEventForTour); config (SEASON, TOURS, tourLabel); ui (resolveCountdownState, startCountdownTimer, fetchLiveStatusCached, renderLiveStatusBanner, toast) |
| `js/admin/players.js` | 45 | `wirePlayers(ctx)`; btn-refresh-directory (snapshot ctx.users); btn-reset-teams (typed "RESET" confirm) | db (savePlayerDirectory, clearAllTeams); ui (confirmModal, toast) |
| `js/admin/clubs.js` | 40 | `wireClubs(ctx)`; [data-delete-club] (parse memberIds, cascade delete, reload clubs) | db (deleteClub, getAllClubs); ui (confirmModal, toast) |

---

## Extraction order — each step is one reviewable commit; the site works after each

| # | Step | Risk | Depends on |
|---|---|---|---|
| 1 | **repricing.js** + create the `js/admin.js` barrel + the ctx scaffolding (establishes the pattern) | low | — |
| 2 | **leaderboard.js** (recalc VERBATIM + promptUpdateLeaderboard) | med | 1 |
| 3 | **clubs.js** | low | 1 |
| 4 | **players.js** | low | 1 |
| 5 | **banners.js** (zero state coupling) | low | 1 |
| 6 | **surfers.js** (owns activeSurferTour writes) | low | 1 |
| 7 | **results.js** (calls promptUpdateLeaderboard after manual save) | med | 1, 2 |
| 8 | **wsl-import.js** (calls promptUpdateLeaderboard after scrape save) | med | 1, 2 |
| 9 | **events.js** (modals + trading stepper); `wireAdminEvents` becomes the ~15-line dispatcher | med | 1 |

Steps 3–6 are independent low-risk wins after the pattern exists; do them in any order. Step 9 is
last because shrinking `wireAdminEvents` to its final dispatcher is cleanest once everything else
is already a `wire*(ctx())` call.

---

## Step 1 — ready-to-execute recipe (repricing.js)

This was fully worked out and is the safe pattern-establisher.

- **Source:** `admin.html` lines **1712–1934** — the `// ── UPDATE VALUES (post-event repricing) ──`
  IIFE `(function () { ... })();`. (The reset-teams / refresh-directory handlers right after it are
  **players-tab**, step 4 — leave them.)
- **New file `js/admin/repricing.js`:** `export function wireRepricing(ctx) { <IIFE body, lines
  1714–1933, VERBATIM> }` with exactly these 5 transforms (everything else byte-identical, so the
  diff is trivially reviewable):
  | from | to |
  |---|---|
  | `return events` | `return ctx.events` |
  | `= surfers.filter` | `= ctx.surfers.filter` |
  | `= activeSurferTour;` | `= ctx.activeSurferTour;` |
  | `surfers = await getAllSurfers();` | `await ctx.reload("surfers");` |
  | `renderAdmin(container);` | `ctx.rerender();` |
  - **Imports** (only what the IIFE uses — **NOT** PEAK/RANKED_FLOOR/WILDCARD_VALUE, which are the
    surfer-form's, step 6): `fetchSeasonRankings` (../wsl-scrape), `nameToKey` (../wsl-resolve),
    `buildCurve, anchorValueForRank, emaStep, tenabilityReport, ALPHA, MAX_CHANGE, VALUE_STEP`
    (../pricing), `SEASON, tourLabel` (../config), `formatSalary, escapeHtml, confirmModal, toast`
    (../ui), `db` (../firebase-config), `doc, writeBatch` (firestore CDN URL).
- **Barrel `js/admin.js`:** `export { wireRepricing } from "./admin/repricing.js";`
- **Shell edits:** add the ctx factory (after line 52); replace the IIFE (1712–1934) with
  `wireRepricing(ctx());`; add `import { wireRepricing } from "./js/admin.js";`; then **trim the
  now-shell-unused imports** — `fetchSeasonRankings`; the repricing-only pricing set
  (`buildCurve, anchorValueForRank, emaStep, tenabilityReport, ALPHA, MAX_CHANGE, VALUE_STEP`);
  and `writeBatch` — **but only after grepping the shell to confirm 0 remaining uses of each**
  (PEAK/RANKED_FLOOR/WILDCARD_VALUE stay — surfer-form; `doc`/`db` stay — used elsewhere).
- **Smoke test:** Surfers tab → Update Values → preview renders → Apply writes + repaints.

---

## Critical gotchas (from the adversarial pass — do not skip)

1. **Byte-for-byte leaderboard recalc.** `recalcLeaderboardForTour` (admin.html:639) is the
   canonical integrity write path (CLAUDE.md). Move it **verbatim**; prove with `git diff -w` that
   the body is unchanged. It delegates batching to **`commitInChunks` (from db.js)** and never calls
   `writeBatch` directly — do **not** import `writeBatch` into `leaderboard.js`.
2. **`promptUpdateLeaderboard` carries its cache-bust.** It does
   `sessionStorage.removeItem(\`events_${SEASON}\`)` before refetching events — that line **must move
   with it**, or recalc can read stale cached events and skip a just-completed event.
3. **Reassignment → reload is the #1 regression risk.** Today handlers REASSIGN the module binding
   (`events = await getEvents()`). In an extracted module that becomes
   `await ctx.reload("events")` — **never a bare local `let events = ...`** (that updates a copy and
   silently desyncs the shell). There are 14 reassignment sites (pre-decomposition lines: 66, 834,
   835, 852, 919, 945, 958, 1150, 1158, 1238, 1263, 1276, 1299, 1681, 1923). After each step, grep
   the new module: `grep -nE '(^|[^.])(surfers|events|users|clubs|activeTab|activeSurferTour)[[:space:]]*=[[:space:]]*[^=]' js/admin/<m>.js` — every hit must be `ctx.reload(...)` or a deliberate local.
4. **Dynamic imports gain `../`.** Moved `await import("./db.js")` → `"../db.js"`, etc. Grep new
   modules for `import("./` → must be 0. (repricing has none; leaderboard/wsl-import/results/events
   each have some.)
5. **`banners.js` has zero state coupling.** `wireCountdownBanner` reads neither `events` nor
   `surfers` — it fetches via `getCurrentEventForTour(...)` from Firestore. `wireBanners` takes `ctx`
   for signature uniformity but won't use it. Keep the `window._countdownPreviewInterval` cleanup
   inside `renderAdmin` (shell), and keep the `if (activeTab === "events") wireBanners(ctx())` gate.
6. **No DOM caching across a rerender.** Every render replaces `container.innerHTML` and re-runs the
   `wire*` functions, so listeners re-attach each render. Wire inside the `wire*` function; never
   stash a node reference for use after `ctx.rerender()` (it points at a detached element).
7. **One-way dependency, no cycle.** `results.js` and `wsl-import.js` import
   `promptUpdateLeaderboard` **from** `leaderboard.js`; `leaderboard.js` never imports back. Keep it
   one-directional (controllers → leaderboard service). The barrel re-exports all.
8. **Trim shell imports per step (hygiene).** After moving a controller, remove from the shell's
   import block only the symbols with **0 remaining shell uses** (grep first). Keep `renderAdmin`'s
   template primitives in the shell: `escapeHtml, formatSalary, formatDate, tourAbbr, SEASON, TOURS,
   tourLabel`, plus `bootstrapPage, showLoading, requireAdmin`.

---

## Per-step verification protocol (no CI — manual)

After every step, before committing:
1. `node --check` (or `/tmp/validate.mjs`) on the new module(s) + `admin.html`.
2. `grep` the new module for `import("./` (must be 0) and for bare state reassignments (gotcha #3).
3. Serve locally (`python3 -m http.server 8000`) and exercise the touched tab. For **steps 2, 7, 8**
   also run a **save → Update Leaderboard** round-trip (the integrity path).
4. Commit as its own commit on this branch. If anything's off, revert just that commit — nothing
   else is touched.
