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
| `scoring.js` | Pure scoring logic — point tables, `scoreTeam()`, `calculateSeasonStandings()` |
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

There is intentionally no standalone `clearLeaderboard` or `saveLeaderboardBatch` export from `db.js` — those primitives are folded into the recalc helper so a partial-write pattern can't accidentally be reintroduced.

### Key Business Rules (in `scoring.js` / `team.js`)
- Men's roster: 8 surfers + 1 alternate, $50M salary cap
- Women's roster: 5 surfers + 1 alternate, $30M salary cap
- Alternate must be from the "budget" bracket (< $1M)
- Alternate auto-substitutes for the first non-competing surfer
- Season standings use best-9-of-N events; tiebreaker is all-events total
- Current season constant: `SEASON = 2026` (defined in each HTML page)

### Admin Page

`admin.html` is a full admin panel gated by `requireAdmin()` (re-fetches `isAdmin` from Firestore on every load). Tabs:

- **Events** — list/create/edit/delete events; inline status select; trading-open toggle (multi-step confirm: lock + opt-in carry-forward + opt-in popularity snapshot); also hosts the **Site Banners** card (live-status + countdown previews + Shown/Hidden toggles, live takes priority).
- **Surfers** — list/create/edit/delete surfers, segmented Men's/Women's sub-tabs, inline bracket + status selects.
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

Run after every completed CT event, before the next trading window opens. Update values in the Surfers tab of admin.html.

**Algorithm:** `delta = value_rank − finish_rank`
- `value_rank` = surfer's rank by current price (1 = most expensive)
- `finish_rank` = actual finish position in the event (1 = winner)
- Positive delta → outperformed → price UP. Negative → underperformed → price DOWN.

**Adjustment scale:**
| \|delta\| | Change |
|-----------|--------|
| 0–2 | $0 |
| 3–6 | ±$250K |
| 7–12 | ±$500K |
| 13–20 | ±$750K |
| 21+ | ±$1.0M |

- All values must be multiples of $250K
- Algorithm is ~zero-sum (total pool changes < 1%)
- If a surfer crosses the $1M bracket boundary, update their `priceBracket` field too
