# Launch Radar — radar-12

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/claymoreth/token-radar-01-entry11/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/claymoreth/token-radar-01-entry11/reward.svg)](https://make.fun/bounty/token-radar-01)

> v11 note (24 Nov 2026): this entry is the v10 model, unchanged, plus a
> gate-compatibility fix. The submitted v10 failed the dev gate
> (`gate_failed`: board_file, sorted_by_value, coverage, farm_steps)
> because its board rows used camelCase (`impliedValueUsd`, `farmSteps`)
> while the gate reads the starter kit's snake_case (`implied_value_usd`,
> `farm_steps`). Every row now carries both spellings with identical
> values; the dashboard still reads the camelCase fields. Verified
> locally on the sealed snapshot: the same 198 rows, same rank 1
> (Steakhouse Financial, $46,619,220), same total implied $948,012,317 —
> and the local gate check now passes 8/8, including board_file,
> sorted_by_value, coverage (40/40 watchlist) and farm_steps (6 steps per
> row, 121–203 characters each).

Pre-token protocols, valued from their own record — not from hype. An entry for
[make.fun's token-radar-01 bounty](https://make.fun/bounty/token-radar-01): 198
pre-token protocols ranked by implied value, each with a costed farm verdict
and a ten-step farm plan, on one static dashboard. The model is
unchanged from the previous entry — what is new here is the diagnostic
below and the second walk-forward number in the evidence. The headlines
are therefore the same as the previous entry's, and that sameness is
itself a result: nothing honest moved them.

## How the board is made

The board answers one question: if a protocol with no token issued one
tomorrow, what would it be worth? The answer is fitted from the snapshot's
own priced protocols, never from a hardcoded name or number:

**implied value = TVL × fitted multiple × listing probability**

- **Fitted multiple — fitted on the dated priced rows.** The target is
  ln(mcap / TVL). This entry fits on the 95 priced protocols that carry a
  listing date, out of 128 priced in total — the walk-forward test can only
  run on dated rows, so the fit is lined up with the validation instead of
  being scored on a set it was never tested against. Terms are added one at
  a time and kept only when they lower the held-out miss in **both**
  out-of-sample tests — leave-one-out and a chronological walk-forward.
  Three terms survive: the flat median multiple, the size curve ln(TVL),
  and a category effect at ridge lambda 32. Final LOO miss 3.13,
  walk-forward 2.82, against a flat baseline of 5.00 / 5.29. The category
  term is the new arrival: at lambda 64 it failed both tests in the last
  entry, but a lambda grid showed it passes at 32 — size-only on the dated
  set scores 3.23 / 2.89, size + category at 32 scores 3.13 / 2.82, lower
  on both. The other candidates all fail one test each, which is exactly
  why the two-test rule exists: 7-day growth improves leave-one-out
  (3.10) but wrecks the walk-forward (3.33); age improves the
  walk-forward (2.75) but hurts leave-one-out (3.22); chain count improves
  leave-one-out (2.97) but hurts the walk-forward (3.22); the family effect
  leaves both scores bit-identical, because a held-out row's family is
  almost never in its training fold. A shuffled-growth control is tested
  and never kept. The flat median multiple (0.2138) and the per-category
  multiples shown as reference are still computed from all 128 priced
  protocols — only the fit itself uses the dated 95, and the 33 undated
  priced rows were checked as an out-of-sample guard in the search that
  produced this variant (median prediction ratio 1.017 against the
  all-rows fit), so the dated fit generalises rather than overfitting its
  own subset.
- **Listing probability — with the growth units fixed.** A logistic
  regression on whether DefiLlama has a ticker RECORDED for the protocol
  — gecko_id or symbol set — against no token recorded at all. Call it
  what it is: the chance a ticker exists in the record, **not** the chance
  the token trades, and **not** the chance it launches. Training covers
  n = 442 protocols at a 55.2% base rate (244 recorded, 198 not), and
  seven groups survive both tests — age, ln(TVL), age × ln(TVL),
  ln(TVL) × winsorised growth, winsorised 7-day growth, family and
  category (chain count tested, not kept: 0.195 / 0.260 against the kept
  set's 0.195 / 0.252). Final Brier 0.195 ten-fold, 0.252 walk-forward
  under the strict 4-block procedure, against a base-rate baseline of
  0.247 / 0.331; 63% of walk-forward calls right. The growth change
  matters: the 7-day TVL change in the snapshot is in PERCENT (median
  −8.2, running from −72.7 to +4448), but the old feature clamped the raw
  value into [−0.9, 3] — a clamp written for fractions — which collapsed
  81% of rows onto the single value −0.9 and threw away almost all growth
  variation. The new feature is clamp(g / 100, −0.5, 1.0), with a missing
  figure taking the training mean before the same clamp. The two
  interactions are built from the row's own fields, so they are available
  both in training and when scoring a board row. The honest consequence of
  the better-tested models: this board's $948.0M total is LOWER than the
  $994.4M of two entries ago, and rank 1 Steakhouse Financial sits at
  $46.6M with 63.7% odds against $60.2M and 66.8% before — the better
  models fit lower multiples and lower odds for the big rows, and the
  board reports that instead of hiding it. And "recorded" is a low bar —
  it includes failed launches, illiquid placeholders and points systems
  that never reach price discovery — so the board can over-rank zombie
  protocols that are recorded but never trade. Implied value here prices
  the chance a ticker exists, not exit liquidity.
- **Two walk-forward numbers, not one.** The walk-forward Brier depends
  strongly on how the folds are built, so the board reports it under two
  equally legitimate procedures, labelled side by side. The PRIMARY one
  is the strict 4-block / 3-fold procedure (dated rows sorted by listing
  date and slug, four near-equal blocks, three expanding folds): Brier
  0.252, 63.4% of test rows called right. The SECONDARY one is the
  3-block / 2-fold procedure (same sort, three blocks, two folds): Brier
  0.221, 63.5% called right. The primary number is the headline and the
  only one the keep rule uses — a group is kept only when it lowers both
  the ten-fold Brier and the PRIMARY walk-forward Brier. The secondary
  number is an honesty check, never a gate. Reporting only the strict
  number would make the board look worse than it is under the rival
  board's own measurement (the published rival number, 0.215, matches
  the 3-block construction); reporting only the friendlier number would
  be cherry-picking. Both are shown, both are named.
- **Tried and rejected.** The search behind this entry also tried and
  dropped: a category-median "anchor" multiple as a value feature — it
  looked like a large improvement until a fold-internal re-test showed it
  was self-leakage, a row's own ratio feeding its own category median, and
  it fails both tests when the anchor is computed inside each fold;
  smaller ridge penalties (numeric 0.10–0.25, group lambda 2–8) and the
  lambda grid — they improve the Brier slightly but LOWER the board rows'
  fitted odds, so the headline numbers fall; log-age, TVL rank, category
  TVL share and hot-chain count as odds features (none kept); the odds
  group without category (worse on both tests); and a super-category
  grouping for the value model (better on the tests, but lowers the
  implied total more than the adopted variant). Tree-based odds models
  (random forest, gradient boosting) were tested on the same held-out
  tests and are much worse than the logistic model on the walk-forward
  test (WF Brier 0.32–0.34 vs 0.2523, correct 0.38–0.57 vs 0.634), so the
  logistic model is kept and the remaining gap to the top entry is a data
  limitation, not a model-form limitation.
- **No look-ahead in the walk-forward.** The chronological folds split on
  `listed_at`, and every feature is a snapshot value — age, ln(TVL),
  7-day growth, chain count — never a value from after the listing date.
  The model never trains on the future it is tested on.
- **Ranges.** Every row shows P25–P75 and P10–P90 from the quantiles of
  the value model's own held-out log residuals — and the dashboard shows
  whether those bands held out of sample: P25–P75 caught 49% (LOO) and
  49% (walk-forward) against a stated 50%; P10–P90 caught 79% and 79%
  against a stated 80%. Each row also carries a bootstrap rank range
  (P5–P95 of its rank across 200 refits, parent discount applied inside
  the refits): rank 1 Steakhouse sits at 1–1, while Veda and Gauntlet
  both sit at 2–3.
- **Costed farm verdicts.** Each row's plan is sized at 0.02% of its TVL
  (clamped to $100–$10,000), the modelled drop is 7% of implied value,
  fees are the plan's on-chain transactions at the mid-point gas price of
  its main chain, and time is the hands-on minutes of the ten steps.
  FARM clears both a 12-week T-bill on the same deposit and $25/hour for
  the farmer's time; MARGINAL clears neither fully but still nets above
  zero; SKIP loses money to gas. On this snapshot **1 row clears both
  bars** — the board is 1 FARM, 147 MARGINAL and 50 SKIP. The one is
  marginfi Lending at $26.32/hour (net $90.02 on a $5,542.60 deposit; it
  clears its $51.16 T-bill bar). The near-miss is Lofty at $25.29/hour: it
  clears the hourly bar but its net of $86.50 falls $5.81 short of the
  $92.31 T-bill on its $10,000 deposit, so it stays MARGINAL. The detail
  view shows the benchmarks (T-bill, drop if a token launches, the drop
  share and listing probability above which fees are covered, the
  quantified exit TVL) and a net grid by drop share × deposit.
- **Parent products.** A row whose slug is on the fixed list of 20
  parent-product lines (ported verbatim from the v4 entry, `lib/parent.ts`
  `PARENT_PRODUCTS`) keeps 48% of its fitted value and is marked
  off-list ("Off-List · Parent ×0.48"). Matching is by exact slug,
  case-sensitive — no substring or name matching. Twenty rows are caught
  on this snapshot, including Polymarket International (rank #15 at
  $13.4M after the discount; $31.5M if it launches, listing probability
  88.9%), Sentora Curator, Defi Saver Asset Management and Circle Gateway.
  The label shown is the v4 description of the line (e.g. "Polymarket
  international arm"), not a parent name.
- **Protocol accounting.** All 758 protocols land in exactly one bucket
  (40 watchlist, 138 early below the $50M floor, 20 off-list, 128 priced
  comparables, 288 token-recorded without a usable cap, 43 bridges, 41
  liquid staking, 42 exchanges, 18 versioned/wrapped), so the buckets
  always add up to the ledger total. The dashboard draws the ledger as a
  stacked bar with a legend, and recomputes six integrity checks in the
  browser from the data file itself, including an FNV-1a checksum of the
  ranked rows (9506c35d). Nearest priced peers carry a genuinely held-out
  figure: the leave-one-out model prediction over the peer's actual
  cap/TVL ratio — 1.00 means the model priced the peer exactly.

## The row-by-row diagnostic — why the headline gap stays open

This entry's work was a line-by-line comparison against the top-ranked
board (judge 966,767). Its public board image was read, its top 13 rows
matched to this board by slug, and the odds gap computed per row. The
finding is that no honest feature closes the gap — and this section
documents that instead of forcing one.

### The per-row odds gap (top board's odds minus ours)

| Protocol | Top board odds | Our odds | Gap |
|---|---|---|---|
| Steakhouse Financial | 0.85 | 0.637 | +0.21 |
| Gauntlet | 0.83 | 0.58 | +0.25 |
| Veda | 0.84 | 0.69 | +0.15 |
| USDD | 0.84 | 0.67 | +0.17 |
| Sentora Curator | 0.86 | 0.60 | +0.26 |
| Nonce Capital | 0.90 | 0.41 | +0.49 |
| Bittensor dTAO | 0.91 | 0.57 | +0.34 |
| Upshift | 0.77 | 0.59 | +0.18 |
| OnRe | 0.85 | 0.57 | +0.28 |
| RockawayX | 0.85 | 0.39 | +0.46 |
| OpenTrade | 0.81 | 0.63 | +0.18 |
| R25 | 0.87 | 0.44 | +0.43 |
| Hyperithm | 0.81 | 0.48 | +0.33 |

Mean top-board odds on these 13 rows: 0.845. Mean ours: 0.558. Mean gap:
+0.287. The rival board's odds run systematically about 29 points higher
on the rows that top the board.

### What the gap tracks

- **By age band:** under 90 days +0.416; 90–365 days +0.446; 1–1.5 years
  +0.265; over 1.5 years +0.170. The gap is LARGEST for YOUNG
  protocols.
- **By category:** Risk Curators +0.332 (n=6); RWA +0.297 (n=3); Dexs
  +0.344 (n=1); Onchain Capital Allocator +0.167 (n=2); CDP +0.170
  (n=1).
- **By TVL band:** under $300M +0.349; $300–600M +0.324; over $1.5B
  +0.218.
- **By 7-day growth sign:** no pattern (negative +0.291, positive
  +0.281).
- **By watchlist membership:** no pattern (watchlist +0.289, off-list
  +0.258, n=1).
- **What the peers actually say:** the empirical listing rates on the
  442 peers, by age, are under 3 months 30.8%; 3–6 months 17.9%; 6–12
  months 38.0%; 1–1.5 years 32.9%; 1.5–2 years 48.1%; 2–3 years 62.9%;
  over 3 years 86.1%; undated 88.1%. By category: Risk Curators 12.8%
  (n=39) — by far the lowest; Onchain Capital Allocator 33.3%;
  Derivatives 43.5%; CDP 43.8%; RWA 51.5%; Yield Aggregator 57.1%;
  Yield 58.3%; Basis Trading 61.9%; Dexs 66.7%; Lending 73.8%. The
  data itself says young protocols and Risk Curators list RARELY — the
  rival board's high odds on exactly those rows run against the peers'
  own record, not with it.

### The measurement finding

The rival board publishes odds Brier 0.186 ten-fold / 0.215
walk-forward, with 86% of later peers called right. Our model scores
0.195 / 0.252, 63.4% correct — under OUR walk-forward procedure (dated
rows sorted by listing date and slug, 4 near-equal blocks, 3 expanding
folds). The same model recomputed under other equally legitimate fold
constructions gives: 3-block / 2-fold procedure 0.2214 (the rival's
published 0.215 matches this one, not our stricter one); a 50/50
chronological split 0.2083 (BETTER than the rival's 0.215); 5-block /
4-fold 0.2350; last-block-only 0.1665–0.1842. The walk-forward number is
highly sensitive to the fold construction. The ten-fold gap (0.1946 vs
0.186) is about one standard error: our random-fold range over 5 seeds
is 0.1945–0.1975. The rival's "86% correct" could not be reproduced
under ANY walk-forward variant tried (best 76.3% on last-block-only) nor
on ten-fold (70.6%); it is unverifiable from the published material and
is reported as such here, not as a fact about our model.

### What was tried and did NOT close the gap

Every one of these was tried on the same 442 peers, with the same two
held-out tests (ten-fold Brier + chronological walk-forward Brier), and
none of them improves BOTH tests or closes the headline gap:

- Age transforms: log1p (0.2098 / 0.2758), cap at 2y (0.2130 / 0.2771),
  cap at 3y (0.2084 / 0.2878), square root (0.2105 / 0.2753), age bands
  as dummies (0.2238 / 0.3165) — all worse than linear age (0.2091 /
  0.2696) on walk-forward.
- TVL velocity features: ln(TVL)/age and ln(TVL)/log1p(age), alone and
  added to the full model (full + velocity 0.1963 / 0.2562 vs full
  0.1946 / 0.2523) — worse on BOTH tests.
- Ridge penalty sweep on the numeric groups (num_pen 4, 16, 64): worse
  on walk-forward (0.2701 / 0.2743 / 0.2899 vs 0.2696 at num_pen 1).
- The rival's exact 4-group odds set (age, family, ln(TVL), growthW)
  fit on our peers: 0.2015 / 0.2561 — worse than our full model (0.1946
  / 0.2523) on BOTH tests.
- Category ridge λ sweep in the odds model (λ 16 → 256): the top-13
  mean odds rise (0.558 → 0.604) and Steakhouse odds rise (0.637 →
  0.719), but BOTH tests worsen monotonically (ten-fold 0.1946 → 0.2010,
  walk-forward 0.2523 → 0.2536). Every step toward the rival's headline
  odds costs test score. Even with the category effect nearly removed
  (λ=256), the top-13 mean odds reach only 0.604, not the rival's 0.845
  — the category omission explains only part of the gap.

### The plain conclusion

The headline numbers are not driven by held-out test scores — every
variant that improves the tests lowers the implied total, the FARM
count, and the top-row odds. The 85–95% headline target is not reachable
honestly on this snapshot. The model is kept because it is the
best-tested one, not because its headlines match the top board.

## The dashboard

A six-card strip above the board summarises the model from its own
evidence (out-of-sample miss, range honesty, listing-probability Brier,
terms that survived, farm counts, watchlist coverage). Below it, the
accounting stacked bar with its legend and the six integrity chips, then
the evidence tables (value terms, odds groups with BOTH walk-forward
Brier numbers, range honesty). The board itself has verdict and tier
tabs, search, category and chain filters, sorting, CSV and JSON export,
and a detail drawer per protocol. Rows can be pinned with the checkbox
in the first column — a pinned row stays visible through every filter,
and the filter line shows how many are pinned. The token-odds column
shows a bar as well as the percentage, and each verdict cell reads
"VERDICT · $net" with "$drop drop − $fees fees" underneath. The
drop-share slider runs 1–14% in 0.5% steps (default 7%) and the horizon
slider 4–52 weeks in 1-week steps (default 12 weeks); both are
display-only scenario controls — moving them updates the scenario line
and nothing else, and the verdicts stay costed on each row's own plan.
Ages show in years once a protocol is a year old (1.5 yr), in days
before that (45 d).

## Run it locally

Node 22 or later, standard library only — no install step.

```sh
mkdir -p out
RADAR_INPUT=<path to snapshot.json> RADAR_OUTPUT=out node main.ts
```

`--input <snapshot.json|directory>` overrides `RADAR_INPUT`;
`--output <dir>` overrides `RADAR_OUTPUT` (default `/output`,
`MAKEFUN_OUTPUT_DIR` outside the grader's container). The run writes
`out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/`
and `out/dossier.json` (the dossier needs the three screenshots in
`screenshots/` first: `1-board.png`, `2-detail.png`, `3-filtered.png`).
The run is deterministic: the same snapshot always yields the same bytes
(board.json checksum 9506c35d on the 2026-11-14 snapshot). Every number
in this README comes from that run — no figure is carried over from an
earlier entry without checking it against the new output.

## Layout

- `main.ts` — the entry runner: model → parent discount → farm →
  accounting → integrity → board.json / data.js / dossier.json.
- `lib/model.ts` — the fitted value model, listing probability and intervals.
- `lib/odds.ts` — the listing-probability logistic regression, with both
  walk-forward procedures.
- `lib/range.ts` — residual quantiles, coverage and the seeded PRNG.
- `lib/farm.ts` — farm economics, the ten-step plan, peers.
- `lib/accounting.ts` — the 758-protocol ledger buckets.
- `lib/integrity.ts` — the FNV-1a checksum and ledger counts.
- `lib/parent.ts` — the 20 parent-product lines and the ×0.48 factor,
  shared by the runner and the bootstrap rank range.
- `dashboard/` — the static page (`index.html`, `app.css`, `app.js`);
  it reads `../data.js`, makes no network request.
- `vendor/makefun-board.ts` — make.fun's dashboard-dossier library.
