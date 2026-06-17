# Surfer Pricing Model

How surfer **values** (prices) are set each event. Pure logic lives in
[`js/pricing.js`](../js/pricing.js); the admin orchestration/preview is the
**Update Values** button on the Surfers tab of `admin.html`.

> Value (price) is separate from fantasy **points** (`js/scoring.js`). This doc
> is only about price.

## The idea: a low-pass filter toward a rank-based target

A surfer's value is an **exponential moving average (single-pole low-pass
filter)** of their "true value", nudged one gentle step toward a rank-based
target each event:

```
value_t  =  α · target(rank_t)  +  (1 − α) · value_{t-1}
```

- `target(rank)` — where the surfer's live WSL season rank sits on a fixed price
  curve (below).
- `α` (`ALPHA`, currently **0.5**) — the one smoothness knob. Higher = faster /
  larger moves; lower = gentler.
- A hard backstop `MAX_CHANGE` (**$1.5M**) caps any single move.

This was chosen over a "snap to rank" anchor for one key reason: **early-season
rank is a noisy few-sample estimate.** A filter moves only a fraction toward a
noisy target and converges as the rank firms up — gradual, never lurching.
Move-size profile at α=0.5: most surfers shift only **$0–$250K** event-to-event
(a settled field barely moves); a surfer genuinely climbing or falling adjusts
**$250K–$1M**; **$1.5M** is the rare hard cap (a big mover or a correction), and
nothing exceeds it.

## Idempotent (safe to re-run)

Repricing is keyed to the **most recent results event**. Each surfer stores
`valuePrev` (their value *before* that event) and `lastPricedEvent`. Re-running
the same event recomputes from `valuePrev`, so it produces the **identical
result** every time — re-clicking Apply, or re-pricing after correcting an
event's results, never double-steps. A genuinely new event advances the filter
once (and `valuePrev` rolls forward). Finishes themselves aren't read — the
season rank already encodes them; the event is just the cadence + idempotency
key.

## The target curve

`target(rank)` is a **two-point-pinned** nonlinear curve — `peak` at rank 1,
`RANKED_FLOOR` ($3M) at the field's last rank — with `decay` solved so the curve
sums to a chosen pool total:

```
target(rank) = RANKED_FLOOR + (peak − RANKED_FLOOR) ·
               (decay^(rank−1) − decay^(maxRank−1)) / (1 − decay^(maxRank−1))
```

The #1→#2 gap is the largest and each shrinks, so elite is worth far more than
mid-pack. Approximate shapes today (peak $11M, floor $3M):

```
        Men's (N≈36, pool ≈ cap·N/8)      Women's (N≈18, pool ≈ cap·N/5·0.9)
  #1   $11.00M  ████████████████████      $11.00M  ████████████████████
  #2   $10.50M  ██████████████████        $10.25M  █████████████████
  #5   $ 9.50M  ███████████████           $ 8.25M  ████████████
  #10  $ 8.00M  ██████████                $ 5.75M  ███████
  #20  $ 6.00M  █████                         —
  last $ 3.00M                            $ 3.00M
```

## Tunables (constants in `pricing.js`)

| Constant | Value | Meaning |
|---|---|---|
| `ALPHA` | 0.5 | EMA smoothing — the main knob (move size / convergence speed) |
| `PEAK` | $11M (both tours) | rank-#1 target **and the value ceiling** (top-5 land ~$10M ±1M) |
| `RANKED_FLOOR` | $3M | last-ranked surfer's price (curve's pinned bottom) |
| `WILDCARD_VALUE` | $1.5M | wildcard price — the **only** value below the floor |
| `MAX_CHANGE` | $1.5M | hard backstop on a single event's move |
| `VALUE_STEP` | $250K | all prices are multiples of this |
| `POOL_FACTOR` | 1.0 men / **0.9 women** | the one per-tour knob — scales the target pool (see gotchas) |
| `cap` / `starters` | $50M/8, $35M/5 | salary cap & squad size — from `getTeamRules()` in `team.js`, not duplicated (alt excluded) |

## Invariants

- Ranked values stay in **[$3M, $12.5M]**; wildcards at **$1.5M**; nothing between.
- No value moves more than **$1.5M** in one event.
- Every value is a multiple of **$250K**.
- Re-running the same event is **idempotent** (identical result).
- Repricing never touches an unmatched surfer or a user's team roster.

## Gotchas & known limits

- **Lag is by design.** At α=0.5 a surfer whose rank climbs/falls over events is
  tracked within ~1–2 events (price trails true value slightly — the intended
  "gradual hone", which creates buy-low value). A *one-off large* mispricing
  (e.g. season seeding from far off) is cap-limited to ~5–6 events at the $1.5M
  ceiling: you can't cross a $6M gap faster without breaching the cap. Raising α
  speeds the small-gap tail but not the capped head; lower it for a calmer board.
- **Pool converges, not instant.** Because the filter lags the target, the pool
  total approaches `targetPool` over events rather than hitting it each cycle.
  The preview shows "pool vs target" so you can watch it.
- **One reprice per event.** The filter takes one step per event. If you *skip*
  an event entirely, that step is simply missed (slight under-convergence) — it
  doesn't double-count. (Re-running the *same* event is safe; see idempotency.)
- **Manual edits re-baseline.** A hand-edited value becomes the base for the
  next event's step. (Editing a surfer between pricing an event and re-running
  that same event is the one edge where the manual value is ignored on the
  re-run — rare.)
- **Women's `poolFactor` is 0.9, not 1.0.** Women's `cap/starters` ($7M) equals
  the curve's mid-average `(peak+floor)/2`, so `1.0` makes the target pool
  unreachable and flattens the taper. `buildCurve` flags that case as
  `degenerate` and the preview warns — a guard against future mis-tuning.

## Season seeding (deferred to season rollover)

At a fresh season start there's no prior value to filter from. The agreed
approach (not yet wired — ties into the season-rollover work): **seed each value
from the prior-season rank** — scrape it from the WSL rankings page if it carries
last year's order before event 1, else compute an internal rank from the
previous season's stored results in Firestore. Mid-season this isn't exercised
(every surfer already has a value, and brand-new mid-season entrants seed
straight to their rank's target via the filter's cold-start branch).
