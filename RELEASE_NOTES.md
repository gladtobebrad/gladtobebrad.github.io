# Release Notes — Major UX Design Overhaul

Branch: `major-ux-design-overhaul`
Status: Pending merge to `main`

A site-wide UX and mobile-friendliness pass, plus a small but important change to how rosters are stored in Firestore (sparse + position-aware). All changes are consumer-side; the leaderboard / scoring / admin write paths are untouched.

---

## Headline changes

- **Dashboard rebuilt.** Tabs gone. Single page with: title, Men's team row, Women's team row, League Standings chart, 2026 schedule.
- **My Team rebuilt.** Drag-and-drop roster with sparse slots, in-place add/remove, position memory, side-by-side Roster + Available panes (stack on mobile).
- **Standings** moved to its own page (`standings.html`).
- **Data Vault** simplified: one "Results" table (renamed from Results-by-Location), one "Popularity" table, plain numeric ranks, no color heatmap, location dropdown filter, "Surfer Rank History" title.
- **Navigation:** Dashboard nav link removed (logo at top-left routes to home). Profile / Sign Out moved into a user-avatar dropdown.
- **Mobile pass:** every page now reflows cleanly at 375px. Consolidated breakpoints; removed redundant banners.

---

## Per-page changes

### `index.html` (Dashboard)
- Removed Events / Standings / Rosters tabs.
- Removed Men's / Women's schedule sub-tabs (they showed identical data).
- New top-to-bottom layout: page title → Men's team row → Women's team row → League Standings by Event chart → 2026 Schedule.
- Each team box has an "Edit Team →" link to `team.html`.
- Team tiles use the shared `.team-row__surfer` styling; position-aware rendering via `padToSparseRoster()` so missing-mid-roster slots stay correctly placed.
- Live-status banner / countdown banner still render as before (unchanged code path).

### `team.html` (My Team)
- Dropped the always-on red "Trading is locked…" banner. Lock state is signaled by the existing `statusBadge()` + `tradingBadge()` and surfaced via `toast()` when the user tries to interact with a locked roster.
- Side-by-side **Your Roster** + **Available Surfers** panes on desktop; stacks on mobile.
- **Drag-and-drop** between roster slots (swap semantics) and from the Available pool. Drop a roster tile onto the Available pane to remove it. Click the × on any tile to remove. `+ ALT` button explicitly adds an alternate.
- Surfer tiles show: photo (2-line full name overlay) · stance · price · post-event delta (separate rows). Filled tiles use a slightly darker tile color (`#F0EBE4`); empty slots match Available's warm-white.
- Unaffordable surfers in the pool are dimmed via opacity, not a brown overlay.
- Save / Revert buttons live at the bottom-right of the editor next to the cap helper text.
- A "2026 Rosters" section below the editor lists the user's rosters for prior completed events (read-only, position-aware).
- **Trading-lock safety**: before save, the event doc is re-fetched (`getEventFresh`) and `tradingOpen` is re-checked. If trading closed mid-edit, the save is rejected and a toast surfaces.

### `standings.html` (new file, renamed from old `players.html`)
- Tour switcher (Men's CT / Women's CT).
- Best-9 / All-Events toggle.
- Single full-list table: rank · team · points.
- Mobile: rows stack with rank chip + team name + points.

### `surfers.html` (Data Vault)
- **Removed** the "Results by Surfer" tab entirely. (Per-surfer history available on the WSL site.)
- Renamed "Results by Location" → **"Results"**.
- Years now **descending** (newest leftmost), fixed window of current season + 3 prior years.
- Dropped BEST / WORST columns.
- All columns sortable (name · Avg · each year column) with ▲▼ headers.
- Removed the inner scroll box — table is fully expanded.
- "Place by location" → "Rank by location"; ranks render as plain integers (no colors, no ordinal suffix).
- Added a location dropdown filter and a "Surfer Rank History" section title.
- Popularity tab functionally unchanged; mobile breakpoints inherited.

### `js/ui.js`
- `NAV_ITEMS` no longer includes "Dashboard"; the top-left logo is the canonical home link. Net nav: My Team · Standings · Clubhouse · Data Vault · About.
- Added a **user-avatar dropdown** in the nav (Profile / Sign Out) replacing the inline links.
- Added `openProfileEditModal()` to surface profile editing from the dropdown.
- `toast()` now de-dupes by `message + type` to prevent stacked duplicates during rapid drag-drop interactions.
- **New export: `padToSparseRoster(saved, size)`** — produces a length-`size` array where each surfer sits at its saved `team_position` (falls back to array index for legacy compact saves). Shared by Dashboard tiles, My Team editor, and prior-rosters strip.

### `css/fantasy.css`
- New `.team-row` / `.team-row__surfer` styles (photo + name overlay + price + delta + stance).
- Editable variant: drag-feedback `::before` outlines, × button, dim state for unaffordable.
- Removed `.locked-banner` styles.
- Consolidated `--max-width: 984px`.
- Audited / collapsed inconsistent breakpoints toward 1024px / 768px / 480px.

### `club.html`
- Added a "Club Standings by Event" chart below the existing Season Leaderboard, mirroring the League chart on the Dashboard. Same line colors (sage-dark for men's, dusty rose for women's).
- **Bug fix:** the Season Leaderboard's Best 9 / All Events toggle was passing the wrong arg list to `renderClubView()` (missing `userDoc`), which would throw `Cannot read properties of undefined` and silently fail to re-render. Toggle now flips the table correctly.

### `js/ui.js` + `index.html` + `team.html`
- All three now consume the same `padToSparseRoster()` helper, so a saved roster with mid-array gaps renders the same on every page.

---

## Data model change — sparse + position-aware rosters

### Old format (still readable)
```js
team.surfers = [
  { surferId: "abc", price: ..., stance: ... },
  { surferId: "def", ... },
  ...
]
```
A simple ordered list. Empty slots were implied by length.

### New format (forward-compatible)
```js
team.surfers = [
  { surferId: "abc", team_position: 0, ... },
  { surferId: "def", team_position: 2, ... },   // note: slot 1 is empty
  { surferId: "xyz", team_position: 8, isAlt: true, ... }
]
```
- `team_position` is the canonical slot index (0-based, includes the alt slot at `rosterSize`).
- Rosters are still saved as a compact array (no `null` entries) — the position info lives on each surfer object.
- `padToSparseRoster()` re-expands to a full sparse array for rendering. Surfers without `team_position` (legacy docs) fall back to array index — **fully backward-compatible**.

### Why
- Lets users intentionally leave a mid-roster slot empty (e.g. partial saves while shopping).
- Preserves the user's chosen slot ordering across save/load.
- Required for drag-and-drop swap semantics to round-trip through Firestore.

### Impact on consumers
| Consumer | Behavior | Status |
|---|---|---|
| `scoring.js` `scoreTeam()` | iterates `team.surfers`, reads `surferId/finish/points` only | unchanged — extra field is harmless |
| `team.js` `validateTeam()` | checks count / duplicates / cap | unchanged |
| `admin.html` popularity snapshot | reads `surferId` only | unchanged |
| `admin.html` recalc → leaderboard | reads `surferId` only | unchanged |
| `profile.html` "current team" view | reads compactly | works, but position-unaware (minor cosmetic) |

The leaderboard recalc path is fully untouched. Existing saved rosters (including the live Raglan event) continue to load and score correctly.

---

## Trading-lock safety (Raglan-critical)

Every save in `team.html` now:
1. Checks the local `event.tradingOpen` cache.
2. Re-fetches the event doc via `getEventFresh()` immediately before write.
3. Aborts and toasts if trading closed mid-edit.

This is the same guarantee that landed in commit `53621bf` (`Fix trading lock bypass caused by stale sessionStorage cache`) — preserved through this refactor.

---

## Backward compatibility & migration

- **No migration required.** Old rosters load via `padToSparseRoster()` array-index fallback.
- **No Firestore schema deploy required.** `team_position` is just an extra field on the existing `teams/{userId}_{eventId}` doc.
- **Rollback plan:** revert the branch. Saved docs with `team_position` will still load correctly under the old code (the field is simply ignored).

---

## Known issues / follow-ups

- **Drag-to-ALT square is flaky.** Dragging an alt-eligible surfer onto the ALT tile sometimes doesn't stick. The `+ ALT` button is a reliable workaround. Multiple fix attempts in this branch were inconclusive; ticketed for a follow-up.
- **`profile.html` is position-unaware.** The "current team" preview iterates the compact array. Cosmetic only; doesn't affect scoring. Low-priority follow-up.
- **Popularity tab is unchanged.** Optional follow-up: surface popularity as a `% picked` column inside the Results table.
- **Club search / invite flow** out of scope for this branch.
- **Popularity auto-update automation** out of scope for this branch.

---

## Verification checklist (pre-merge)

```bash
python3 -m http.server 8000
```

- [x] Dashboard renders both team rows, position-aware.
- [x] "Edit Team →" links route correctly from each team box.
- [x] League chart shows both tours; legend correct.
- [x] Schedule shows full season (no tour tabs).
- [x] My Team: drag-swap works between roster slots.
- [x] My Team: drag from Available adds to first empty slot; drop on tile swaps.
- [x] My Team: × button removes; `+ ALT` button adds alternate.
- [x] My Team: save round-trips with `team_position` field.
- [x] My Team: prior-rosters section lists completed events, position-aware.
- [x] Trading-lock: toggle to closed in admin, attempt save → rejected with toast.
- [x] Standings: tour toggle + Best-9 toggle work.
- [x] Clubhouse: Season Leaderboard Best 9 / All Events toggle re-renders the table (sortKey + totals column + header label all flip).
- [x] Data Vault: years descending, sortable, plain ranks, location dropdown filters correctly.
- [x] Nav: logo routes home from every page; user dropdown opens Profile modal and signs out.
- [x] No console errors on any page.
- [x] Admin recalc still works end-to-end (smoke test).

---

## Files touched

- `index.html` — rewritten body
- `team.html` — rewritten editor + sparse roster wiring
- `standings.html` — new file
- `surfers.html` — Data Vault refactor
- `club.html` — added club chart; fixed Best 9 / All Events toggle arg-list bug
- `js/ui.js` — nav, dropdown, `padToSparseRoster`, toast dedupe
- `css/fantasy.css` — team-row styles, breakpoint consolidation
- `profile.html`, `event.html` — link updates (players.html → standings.html)
