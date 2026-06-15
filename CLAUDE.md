# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A static, no-build fantasy surf league web app hosted on GitHub Pages. All pages are plain HTML files with inline `<script type="module">` blocks. There is no bundler, no package manager, and no build step — changes deploy immediately on push to `main`.

## Development

Open directly in a browser via the filesystem, or serve locally:

```bash
# Any simple HTTP server works (required for ES module imports)
python3 -m http.server 8000
# then open http://localhost:8000
```

There is no linter, test suite, or CI configured.

## Architecture

### Stack
- **Frontend**: Vanilla JS (ES modules via `<script type="module">`), plain HTML/CSS
- **Backend**: Firebase v11 (modular CDN imports — no npm)
  - Firestore for all data storage
  - Google Auth (popup) for authentication
- **Hosting**: GitHub Pages (`gladtobebrad.github.io`)

### JS Module Layer (`js/`)

All JS is loaded as ES modules imported directly from HTML pages. The modules form a layered architecture:

| Module | Role |
|---|---|
| `firebase-config.js` | Initializes Firebase app; exports `app`, `auth`, `db`, `storage` |
| `auth.js` | Auth state management, Google + email sign-in, `onAuth()` callback system, `requireAuth()` / `requireAdmin()` guards |
| `db.js` | All Firestore CRUD — one function per operation, organized by collection |
| `scoring.js` | Pure scoring logic — point tables, `scoreTeam()` (final), `projectTeam()` (in-progress floor estimate), `isInProgress()`, `calculateSeasonStandings()` |
| `team.js` | Pure team validation + helpers — `validateTeam()`, `calculateRemaining()`, `getTeamRules()` |
| `ui.js` | Shared UI primitives — `renderHeader()`/`renderFooter()`, `toast()`, `confirmModal()`, `showLoading()`/`showAuthGate()`, `formatSalary()`/`formatSalaryFull()`/`formatDate()`, `statusBadge()`/`tradingBadge()`, countdown helpers (`resolveCountdownState`, `startCountdownTimer`), live-status helpers (`fetchLiveStatusCached`, `renderLiveStatusBanner`) |
| `wsl-scrape.js` | WSL website scraping — fetches schedule, picks active venue, scrapes heat-level results per gender, and `fetchLiveEventStatus()` for the live-status banner. Permissive CORS lets this run entirely from the browser |
| `wsl-resolve.js` | Pure helpers used by the WSL pipeline — surfer-name resolution and `computeFinishPositions()` (walks rounds to assign finish places only from fully-completed rounds) |

### Page Pattern

Every HTML page follows this pattern:
1. Empty `<header id="app-header">`, `<main id="app-main">`, `<footer id="app-footer">`
2. `initAuth()` + `renderHeader()` + `renderFooter()` called immediately
3. `onAuth(async (user, profile) => { ... })` drives all page rendering
4. Protected pages call `requireAuth()` or `requireAdmin()` which redirect to `index.html` if not authorized

### Firestore Data Model

Documents use composite IDs for cross-entity relationships:
- `teams/{userId}_{eventId}` — user's roster for a specific event
- `results/{eventId}_{surferId}` — surfer's finish result for an event
- `leaderboard/{userId}_{season}_{tour}` — season standings entry (one per tour per user)

Collections: `surfers`, `events`, `results`, `teams`, `leaderboard`, `users`, `clubs`

Plus a `config/site` doc and a `meta/leaderboard` version doc (drives client-side leaderboard cache invalidation via `touchLeaderboardVersion()`).

### Leaderboard Integrity

The leaderboard is derived data. The single canonical write path is `recalcLeaderboardForTour()` in `admin.html`, triggered from the post-save dialog (`promptUpdateLeaderboard()`) after WSL or manual results entry. Guarantees:

1. **Compute first, validate, then write.** New leaderboard entries are built entirely in memory; if any read fails, Firestore is untouched.
2. **Skip tours with no results.** A tour with zero events marked `resultsEntered` is skipped entirely — never overwrites a populated leaderboard with empties.
3. **Single atomic `writeBatch` per tour.** Combines sets-for-current-users + deletes-of-orphan-users in one commit; a failure mid-flight leaves that tour's leaderboard unchanged.
4. **Per-tour try/catch.** A women's recalc failure cannot corrupt the men's leaderboard.
5. **User team rosters (`teams/`) are read-only here.** Recalc never modifies a roster a user saved.
6. **In-progress events store a projected score.** Recalc uses `projectTeam()` instead of `scoreTeam()` for events where `isInProgress(ev)` is true, so live standings show each team's upside (a guaranteed floor that only rises) rather than the inverted locked-in total. Once the event completes, the next recalc overwrites it with the final `scoreTeam()` total. This is the only place projections are computed — the standings/clubhouse/event pages just read the leaderboard and style live columns as estimates.

There is intentionally no standalone `clearLeaderboard` or `saveLeaderboardBatch` export from `db.js` — those primitives are folded into the recalc helper so a partial-write pattern can't accidentally be reintroduced.

### Key Business Rules (in `scoring.js` / `team.js`)
- Men's roster: 8 surfers + 1 alternate, $50M salary cap
- Women's roster: 5 surfers + 1 alternate, $35M salary cap
- Alternate must cost under $4M (`ALT_CAP` in `team.js`, both tours) and is excluded from the salary cap
- Alternate auto-substitutes for the first non-competing surfer
- Season standings use best-9-of-N events; tiebreaker is all-events total
- Current season constant: `SEASON = 2026` (defined in each HTML page)

### Admin Page

`admin.html` is a full admin panel gated by `requireAdmin()` (re-fetches `isAdmin` from Firestore on every load). Tabs:

- **Events** — list/create/edit/delete events; inline status select; trading-open toggle (multi-step confirm: lock + opt-in carry-forward + opt-in popularity snapshot); also hosts the **Site Banners** card (live-status + countdown previews + Shown/Hidden toggles, live takes priority).
- **Surfers** — list/create/edit/delete surfers, segmented Men's/Women's sub-tabs, inline status select, and **Update Values** (anchor-based repricing — see below).
- **Results** — *Fetch & Update Results from WSL* (auto-scrape current venue, parse heats, compute finish positions, preview, then save with themed overwrite-confirm) and manual results entry. Both save paths trigger `promptUpdateLeaderboard()`.
- **Players** — registered users + Refresh Player Directory + Reset All Teams (destructive).
- **Clubs** — list/delete clubs.
- **Seed Data** — one-click bulk import of 2026 schedule + men's surfer roster (legacy bootstrap; can be removed once season is fully seeded).

### Recent Features (not always reflected in older code paths)

- **Automated WSL bracket scrape + rank assignment** — see `wsl-scrape.js` / `wsl-resolve.js`. Only fully-completed rounds contribute; ties broken by heat total (exact ties flagged).
- **Countdown banner** — appears for the soonest tour with `tradingOpen` + `startDate`; gated by `siteConfig.showCountdown`.
- **Live status banner** — fetches WSL `.status-module__container` from the active event's main page; cached in `sessionStorage` (~60s); gated by `siteConfig.showLiveStatus`; takes priority over countdown when WSL reports an active event.
- **Round-completion tracking** — WSL save persists `roundsCompleted` + `totalRounds` + `resultsSource: "wsl"` on the event doc; manual save persists `resultsSource: "manual"` (round fields preserved).
- **Themed confirm modals** — `confirmModal()` in `ui.js` replaces `window.confirm()` for any non-trivial admin action (trading toggle, leaderboard recalc, scrape overwrite).

## Surfer Repricing (post-event)

> Standalone reference: [docs/pricing-model.md](docs/pricing-model.md).

Run after every completed CT event, before the next trading window opens, via the **Update Values** button on the Surfers tab (reprices whichever sub-tab — men's/women's — is active). Pure logic lives in `js/pricing.js`; the orchestration/preview is the handler in `admin.html`.

**Model — anchor + wiggle (NOT delta-from-previous-price).** Prices are a *target function* of live season rank, re-derived from scratch each cycle, so they can't drift or accumulate bias:

1. **Anchor to season rank.** `fetchSeasonRankings(tour)` (in `wsl-scrape.js`) scrapes the official WSL rankings page (`/athletes/tour/{mct|wct}`) for fresh ranks. Each surfer's anchor comes from a **two-point-pinned** nonlinear curve `value(rank) = RANKED_FLOOR + (peak − RANKED_FLOOR)·(decay^(rank−1) − decay^(maxRank−1))/(1 − decay^(maxRank−1))` — pinned at `peak` (rank 1) and `RANKED_FLOOR` (the field's last rank), `decay` sets the curvature; elite ranks worth far more than mid-pack.
2. **Pool-managed.** `decay` is *solved* (binary search in `buildCurve`) over the matched surfers' real ranks so their anchors sum to `targetPool = cap·N/starters·poolFactor` (`N` = surfers actually repriced — non-CT/unmatched surfers are excluded so they can't inflate it); at `poolFactor 1.0` an average full squad costs exactly the cap. The pool is a target the prices converge to (see the per-cycle cap), not emergent.
3. **Recency wiggle.** Each surfer is nudged ±up-to-$750K (`MAX_WIGGLE`) by `(pre-event rank) − finish` in the **most recent saved event** — comparing the latest finish to where they stood *before* the event (the freshly-scraped post-event rank already absorbed it, so using it would be circular and the residual ~0). The pre-event rank is the surfer's stored `rank` from the prior cycle; finishes come from Firestore results, not scraped.
4. **Name-matched.** Scraped athletes map to local surfers via `nameToKey` (`wsl-resolve.js`); unmatched surfers keep their value untouched and are flagged in the preview.
5. **Gliding (rate-limited).** Anchor + wiggle is the *target*; a price moves toward it by at most `MAX_CHANGE` ($2M) per cycle (`cappedValue`), so a large correction lands over a few events. In steady state the only recurring move is the wiggle — per-cycle changes above $1M are rare, above $2M impossible.

Tunables live in `PRICING` (per-tour `peak` — the rank-#1 anchor, ~$11M, tuned so the top 5 sit ~$10M ±1M — plus `poolFactor`, `starters`, `cap`) in `pricing.js`. `RANKED_FLOOR = $3M` is the lowest price for a ranked surfer (the curve's pinned bottom endpoint — the last-ranked surfer lands exactly here); `WILDCARD_VALUE = $1.5M` is the wildcard price — the only value below the floor, so no surfer sits between $1.5M and $3M; `MAX_VALUE = $12.5M` the absolute ceiling (reserved for a top rank on a heater); and `MAX_CHANGE = $2M` the per-cycle movement cap. All values are multiples of $250K (enforced in the curve and in manual surfer-modal entry, which also enforces the band and ceiling). The preview surfaces a tenability readout (top-N cost vs cap, affordable-stars, pool vs target) before Apply, which writes `value` + `rank` for matched surfers in one batch. There is no `priceBracket` field — it was removed as it had no gameplay effect.

Two gotchas: **reprice once per event** — re-running against the same most-recent event recomputes the wiggle off the now-updated rank (circular) and undoes the prior nudge. And `poolFactor` is **below 1.0 for women's** because there `cap/starters` ($7M) equals the curve's mid-average `(peak+floor)/2`, so `1.0` would make the target pool unreachable and flatten the taper — `buildCurve` flags that case as `degenerate` and the preview warns.
