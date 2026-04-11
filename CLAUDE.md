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
| `firebase-config.js` | Initializes Firebase app; exports `app`, `auth`, `db` |
| `auth.js` | Auth state management, Google sign-in, `onAuth()` callback system, `requireAuth()` / `requireAdmin()` guards |
| `db.js` | All Firestore CRUD — one function per operation, organized by collection |
| `scoring.js` | Pure scoring logic — point tables, `scoreTeam()`, `calculateSeasonStandings()`, `breakTie()` |
| `team.js` | Pure team validation — salary cap, roster size, duplicate checks, `validateTeam()` |
| `ui.js` | Shared UI — `renderHeader()`, `renderFooter()`, `toast()`, `showLoading()`, `formatSalary()`, `renderTable()` |

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
- `leaderboard/{userId}_{season}` — season standings entry

Collections: `surfers`, `events`, `results`, `teams`, `leaderboard`, `users`, `clubs`

### Key Business Rules (in `scoring.js` / `team.js`)
- Men's roster: 8 surfers + 1 alternate, $50M salary cap
- Women's roster: 5 surfers + 1 alternate, $30M salary cap
- Alternate must be from the "budget" bracket (< $1M)
- Alternate auto-substitutes for the first non-competing surfer
- Season standings use best-9-of-N events; tiebreaker is all-events total
- Current season constant: `SEASON = 2026` (defined in each HTML page)

### Admin Page
`admin.html` is a full admin panel gated by `requireAdmin()` (re-fetches `isAdmin` from Firestore on every load). It manages surfers, events, results entry, team locking, and leaderboard calculation.

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
