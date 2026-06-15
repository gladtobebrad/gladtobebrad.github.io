# Surfer Pricing Model

How surfer **values** (prices) are set each event. Pure logic lives in
[`js/pricing.js`](../js/pricing.js); the admin orchestration/preview is the
**Update Values** button on the Surfers tab of `admin.html`.

> Value (price) is separate from fantasy **points** (`js/scoring.js`). This doc
> is only about price.

## Running it

After a completed CT event, before the next trading window opens:
**Surfers tab → Update Values** (reprices whichever sub-tab — Men's/Women's — is
active). It scrapes fresh WSL season ranks, previews every change with a
tenability readout, and writes `value` + `rank` only on **Apply**.

## The model: anchor + wiggle

Prices are a **target function of live season rank**, re-derived from scratch
each cycle (not evolved from the previous price), so they can't drift.

1. **Anchor to season rank.** A two-point-pinned nonlinear curve, pinned at
   `peak` (rank 1) and `RANKED_FLOOR` (the field's last rank):

   ```
   value(rank) = RANKED_FLOOR + (peak − RANKED_FLOOR) ·
                 (decay^(rank−1) − decay^(maxRank−1)) / (1 − decay^(maxRank−1))
   ```

   The #1→#2 gap is the largest and each subsequent gap shrinks — elite ranks
   are worth far more than mid-pack.

2. **Pool-managed.** `decay` is *solved* (binary search) so the anchors sum to
   `targetPool = cap · N / starters · poolFactor` over the actually-matched
   ranks. At `poolFactor 1.0` an average-priced full squad costs exactly the cap.

3. **Recency wiggle.** A bounded nudge for over/under-performance:
   `delta = (pre-event rank) − finish` in the most recent event. The pre-event
   rank is the surfer's **stored `rank` from the prior cycle** — *not* the
   freshly-scraped post-event rank, which already absorbed the event (that would
   be circular and net ~0).

4. **Glide (rate-limited).** Anchor + wiggle is the *target*; each price moves
   toward it by at most `MAX_CHANGE` per cycle, so big corrections land over a
   few events rather than in one jump.

Surfers not matched to a WSL ranking by name keep their value untouched and are
flagged in the preview.

## Tunables (`PRICING` + constants in `pricing.js`)

| Constant | Value | Meaning |
|---|---|---|
| `peak` | $11M (both tours) | rank-#1 anchor (top 5 land ~$10M ±1M) |
| `RANKED_FLOOR` | $3M | lowest price for a ranked surfer (curve's pinned bottom) |
| `WILDCARD_VALUE` | $1.5M | wildcard price — the **only** value below the floor |
| `MAX_VALUE` | $12.5M | absolute ceiling (reserved for a top rank on a heater) |
| `MAX_WIGGLE` | $750K | cap on the recency nudge, either direction |
| `MAX_CHANGE` | $2M | hard cap on price movement per cycle |
| `VALUE_STEP` | $250K | all prices are multiples of this |
| `poolFactor` | 1.0 men / **0.9 women** | scales the target pool (see gotchas) |
| `cap` / `starters` | $50M/8, $35M/5 | salary cap and squad size (alt excluded) |

Wiggle ladder (by `|delta|`): `≤1 → $0`, `≤3 → $250K`, `≤7 → $500K`, `>7 → $750K`.

## Invariants

- Ranked values stay in **[$3M, $12.5M]**; wildcards sit at **$1.5M**; nothing
  in between.
- No value changes by more than **$2M** in one cycle.
- Every value is a multiple of **$250K**.
- The lowest-ranked matched surfer lands on exactly **$3M** (before wiggle).
- The pool stays managed (the wiggle is off-pool and ~mean-zero).
- Repricing never touches an unmatched surfer or a user's team roster.

## Gotchas

- **Reprice once per event.** Re-running on the *same* most-recent event
  recomputes the wiggle off the now-updated rank (circular) and erodes the prior
  nudge toward the pure anchor. The normal once-per-event flow is fine.
- **Women's `poolFactor` is 0.9, not 1.0.** Women's `cap/starters` ($7M) equals
  the curve's mid-average `(peak+floor)/2`, so `1.0` makes the target pool
  unreachable and flattens the taper. `buildCurve` flags that case as
  `degenerate` and the preview warns — a guard against future mis-tuning.
- **Curve shape adapts to matched count.** If many surfers go unmatched (name
  mismatches), `maxRank` shrinks and the curve flattens — watch the "unmatched"
  count and "pool vs target" in the preview.

## Repricing a price distribution by hand?

Don't — use the button. But the shape it produces (men's, ~36 ranked): ~$11M at
#1 tapering to exactly $3M at the last rank, top 5 in the $10M ±1M band, pool
≈ `cap·N/starters`.
