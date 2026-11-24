// odds.ts — the listing-probability logistic regression.
//
// Question: for a protocol with no token yet, how likely is a ticker to
// be RECORDED for it? The target is "ticker recorded" (gecko_id or symbol
// set in the snapshot) against no token recorded at all — the chance a
// ticker exists in the record, not the chance the token trades and not a
// forecast that it will launch. The training rows are built in
// lib/model.ts; this file only ever sees the `y` it is handed.
//
// The regression is written from scratch, standard library only:
// full-batch gradient descent, a ridge penalty on every weight except the
// bias, numeric features standardised, family and category as separate
// ridge groups of raw 0/1 dummies, and a sigmoid whose input is clamped
// so it can never overflow. Nothing is hardcoded: every mean, scale and
// weight is fitted at run time from the rows passed in.
//
// Two walk-forward procedures are reported. The PRIMARY one (4 blocks, 3
// expanding folds) is the only one the keep rule uses. The SECONDARY one
// (3 blocks, 2 expanding folds) is an additional honesty check: the
// walk-forward Brier depends strongly on how the folds are built, and a
// rival board's published 0.215 matches the 3-block construction, not
// the stricter 4-block one. Reporting both, labelled, keeps the
// comparison honest in both directions — neither hiding behind the
// stricter number nor cherry-picking the friendlier one. The secondary
// procedure is: same dated sort, same block-building rule with chunks = 3,
// two folds (train block 0 → test block 1; train blocks 0–1 → test block 2),
// same fit machinery as the primary procedure.

/** One odds training row: the protocol's features and its 0/1 target. */
export interface OddsRow {
  slug: string;
  listedAt: string | null;
  ageYears: number | null;
  lnTvl: number;
  growthRaw: number | null;
  lnChains: number;
  family: string;
  category: string;
  y: number;
}

/** Whether a candidate group survived the two-test keep rule. */
export type OddsTermKept = "kept" | "tested, not kept" | "baseline";

/**
 * One evidence row per candidate group: its ten-fold Brier, its PRIMARY
 * walk-forward Brier, its SECONDARY walk-forward Brier, and whether it
 * was kept. The secondary number never decides a keep — it is reported
 * alongside so the reader can see how fold construction moves the score.
 */
export interface OddsTermEvidence {
  name: string;
  brier: number;
  wfBrier: number;
  wfBrierAlt: number;
  kept: OddsTermKept;
}

/** The odds evidence the dashboard renders. */
export interface OddsEvidence {
  n: number;
  baseRate: number;
  baselineBrier: number;
  baselineWfBrier: number;
  baselineWfBrierAlt: number;
  finalBrier: number;
  finalWfBrier: number;
  finalWfBrierAlt: number;
  walkForwardCorrect: number;
  walkForwardCorrectAlt: number;
  terms: OddsTermEvidence[];
}

/**
 * The candidate groups, in test order. "growth" (the old raw clamp) is
 * gone: the snapshot's 7-day change is in PERCENT, and the old feature
 * clamped the raw value into [-0.9, 3] — a clamp written for fractions —
 * which collapsed 81% of rows onto the single value -0.9. The replacement
 * is "growthW", the winsorised percent change, plus two interactions
 * built from the row's own fields.
 */
export const ODDS_GROUPS = [
  "age",
  "lntvl",
  "ageXlntvl",
  "lntvlXgrowthW",
  "growthW",
  "family",
  "category",
  "lnch",
] as const;
export type OddsGroup = (typeof ODDS_GROUPS)[number];

/** Human labels for the evidence table, one per group. */
export const GROUP_LABELS: Record<OddsGroup, string> = {
  age: "age (years listed)",
  lntvl: "ln(TVL)",
  ageXlntvl: "age × ln(TVL)",
  lntvlXgrowthW: "ln(TVL) × winsorised growth",
  growthW: "7-day TVL growth (winsorised %)",
  family: "family (ridge 16, raw dummies)",
  category: "category (ridge 16, raw dummies)",
  lnch: "chain count (ln)",
};

/** Fit-time statistics: the means, the dummy levels, and the standardisation. */
interface OddsStats {
  meanAge: number;
  meanGrowth: number;
  catLevels: string[];
  famLevels: string[];
  means: number[];
  sds: number[];
}

/** A fitted odds model: the kept groups, its statistics, weights and base rate. */
interface OddsModel {
  groups: OddsGroup[];
  stats: OddsStats;
  weights: number[];
  baseRate: number;
}

/** Sigmoid with the input clamped first, so it can never overflow. */
function sigmoid(z: number): number {
  const clamped = Math.max(-30, Math.min(30, z));
  return 1 / (1 + Math.exp(-clamped));
}

/** The row's age in years, falling back to the training mean when unknown. */
function ageOf(row: OddsRow, stats: OddsStats): number {
  return row.ageYears ?? stats.meanAge;
}

/**
 * The winsorised percent growth: the raw 7-day change is in percent, so
 * divide by 100 first, then clamp to [-0.5, 1.0]. A missing figure takes
 * the training set's mean raw growth before the same clamp.
 */
function growthWOf(row: OddsRow, stats: OddsStats): number {
  const raw = row.growthRaw ?? stats.meanGrowth;
  return Math.max(-0.5, Math.min(1.0, raw / 100));
}

/**
 * Raw design columns: walk `groups` in order and append each group's
 * columns. Numeric groups contribute one column each; family and category
 * contribute one raw 0/1 dummy per level. A group not in `groups`
 * contributes nothing.
 */
function rawColumns(row: OddsRow, groups: readonly OddsGroup[], stats: OddsStats): number[] {
  const cols: number[] = [];
  const age = ageOf(row, stats);
  const growthW = growthWOf(row, stats);
  for (const group of groups) {
    if (group === "age") cols.push(age);
    else if (group === "lntvl") cols.push(row.lnTvl);
    else if (group === "ageXlntvl") cols.push(age * row.lnTvl);
    else if (group === "lntvlXgrowthW") cols.push(row.lnTvl * growthW);
    else if (group === "growthW") cols.push(growthW);
    else if (group === "lnch") cols.push(row.lnChains);
    else if (group === "family") {
      for (const level of stats.famLevels) cols.push(row.family === level ? 1 : 0);
    } else if (group === "category") {
      for (const level of stats.catLevels) cols.push(row.category === level ? 1 : 0);
    }
  }
  return cols;
}

/**
 * Column metadata, aligned with the raw columns: whether a column is a
 * raw dummy (family/category, never standardised) and its ridge penalty
 * (16 per dummy, 1 per numeric column).
 */
function columnInfo(groups: readonly OddsGroup[], stats: OddsStats): { raw: boolean[]; penalty: number[] } {
  const raw: boolean[] = [];
  const penalty: number[] = [];
  for (const group of groups) {
    if (group === "family") {
      for (let i = 0; i < stats.famLevels.length; i++) {
        raw.push(true);
        penalty.push(16);
      }
    } else if (group === "category") {
      for (let i = 0; i < stats.catLevels.length; i++) {
        raw.push(true);
        penalty.push(16);
      }
    } else {
      raw.push(false);
      penalty.push(1);
    }
  }
  return { raw, penalty };
}

/**
 * Fit-time statistics over a set of rows: the mean age and mean growth
 * (over non-null values, 0 when none), the family levels (families with
 * at least 2 rows, alphabetically) and the category levels (unique,
 * alphabetically), then the per-column mean and population standard
 * deviation of the raw matrix — with raw dummy columns overridden to
 * mean 0 and sd 1 so the design matrix passes the 0/1 values through
 * unchanged.
 */
function fitStats(rows: OddsRow[], groups: readonly OddsGroup[]): OddsStats {
  let ageSum = 0;
  let ageCount = 0;
  let growthSum = 0;
  let growthCount = 0;
  const familyCounts = new Map<string, number>();
  const categorySet = new Set<string>();
  for (const row of rows) {
    if (row.ageYears !== null) {
      ageSum += row.ageYears;
      ageCount += 1;
    }
    if (row.growthRaw !== null) {
      growthSum += row.growthRaw;
      growthCount += 1;
    }
    familyCounts.set(row.family, (familyCounts.get(row.family) ?? 0) + 1);
    categorySet.add(row.category);
  }
  const famLevels: string[] = [];
  for (const [family, count] of familyCounts) {
    if (count >= 2) famLevels.push(family);
  }
  famLevels.sort();
  const catLevels = Array.from(categorySet).sort();
  const stats: OddsStats = {
    meanAge: ageCount > 0 ? ageSum / ageCount : 0,
    meanGrowth: growthCount > 0 ? growthSum / growthCount : 0,
    catLevels,
    famLevels,
    means: [],
    sds: [],
  };
  const matrix = rows.map((r) => rawColumns(r, groups, stats));
  const d = matrix.length > 0 ? matrix[0]!.length : 0;
  for (let j = 0; j < d; j++) {
    let mean = 0;
    for (let i = 0; i < matrix.length; i++) mean += matrix[i]![j]!;
    mean = matrix.length > 0 ? mean / matrix.length : 0;
    let variance = 0;
    for (let i = 0; i < matrix.length; i++) variance += (matrix[i]![j]! - mean) * (matrix[i]![j]! - mean);
    variance = matrix.length > 0 ? variance / matrix.length : 0;
    stats.means.push(mean);
    stats.sds.push(variance > 1e-12 ? Math.sqrt(variance) : 1);
  }
  const info = columnInfo(groups, stats);
  for (let j = 0; j < d; j++) {
    if (info.raw[j]) {
      stats.means[j] = 0;
      stats.sds[j] = 1;
    }
  }
  return stats;
}

/** The design matrix: each row's raw columns standardised by the fit stats. */
function designMatrix(rows: OddsRow[], groups: readonly OddsGroup[], stats: OddsStats): number[][] {
  return rows.map((row) => {
    const raw = rawColumns(row, groups, stats);
    return raw.map((v, j) => (v - stats.means[j]!) / stats.sds[j]!);
  });
}

/**
 * Full-batch gradient descent for the logistic loss with a ridge penalty
 * on every weight except the bias. Learning rate 0.15, at most 1000
 * iterations, early stop when the largest step falls below 1e-9. The
 * gradient accumulates row by row, in index order.
 */
function fitLogistic(x: number[][], y: number[], penalties: number[]): number[] {
  const n = x.length;
  const d = n > 0 ? x[0]!.length : 0;
  const w: number[] = new Array(d + 1).fill(0);
  for (let iter = 0; iter < 1000; iter++) {
    const grad: number[] = new Array(d + 1).fill(0);
    for (let i = 0; i < n; i++) {
      let z = w[0]!;
      for (let j = 0; j < d; j++) z += w[j + 1]! * x[i]![j]!;
      const err = sigmoid(z) - y[i]!;
      grad[0]! += err;
      for (let j = 0; j < d; j++) grad[j + 1]! += err * x[i]![j]!;
    }
    let maxStep = 0;
    for (let j = 0; j <= d; j++) {
      const penalty = j === 0 ? 0 : (penalties[j - 1]! * w[j]!) / n;
      const step = 0.15 * (grad[j]! / n + penalty);
      w[j]! -= step;
      if (Math.abs(step) > maxStep) maxStep = Math.abs(step);
    }
    if (maxStep < 1e-9) break;
  }
  return w;
}

/** Fit an odds model on a set of rows with a given group list. */
export function fitOdds(rows: OddsRow[], groups: OddsGroup[], baseRate: number): OddsModel {
  const stats = fitStats(rows, groups);
  const x = designMatrix(rows, groups, stats);
  const weights = fitLogistic(x, rows.map((r) => r.y), columnInfo(groups, stats).penalty);
  return { groups, stats, weights, baseRate };
}

/**
 * Predict one row's listing probability: standardise its raw columns with
 * the model's statistics, take the dot product with the weights, and clip
 * the result to [0.02, 0.98] — a protocol is never priced as certainly
 * tokenless or certainly tokenised.
 */
export function predictOdds(model: OddsModel, row: OddsRow): number {
  const raw = rawColumns(row, model.groups, model.stats);
  let z = model.weights[0]!;
  for (let j = 0; j < raw.length; j++) {
    const standardised = (raw[j]! - model.stats.means[j]!) / model.stats.sds[j]!;
    z += model.weights[j + 1]! * standardised;
  }
  const p = sigmoid(z);
  return Math.max(0.02, Math.min(0.98, p));
}

/** Mean squared error between predicted probabilities and actual 0/1 outcomes. */
export function brierScore(predicted: number[], actual: number[]): number {
  if (predicted.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < predicted.length; i++) sum += (predicted[i]! - actual[i]!) * (predicted[i]! - actual[i]!);
  return sum / predicted.length;
}

/**
 * Chronological expanding folds over already-sorted rows: split into
 * `chunks` near-equal blocks (base = floor(n / chunks), the first
 * n - chunks*base blocks get one extra row each), then one fold per
 * boundary — fold k trains on blocks 0..k and tests on block k+1.
 */
function expandingFoldsChunks<T>(sortedRows: T[], chunks: number): { train: T[]; test: T[] }[] {
  const n = sortedRows.length;
  const base = Math.floor(n / chunks);
  const extra = n - base * chunks;
  const blocks: T[][] = [];
  let at = 0;
  for (let b = 0; b < chunks; b++) {
    const size = base + (b < extra ? 1 : 0);
    blocks.push(sortedRows.slice(at, at + size));
    at += size;
  }
  const folds: { train: T[]; test: T[] }[] = [];
  for (let k = 0; k < chunks - 1; k++) {
    const train: T[] = [];
    for (let b = 0; b <= k; b++) train.push(...blocks[b]!);
    folds.push({ train, test: blocks[k + 1]! });
  }
  return folds;
}

/**
 * The PRIMARY chronological folds: 4 blocks, 3 expanding folds. This is
 * the fold construction the keep rule uses, and the one the dashboard
 * headlines.
 */
export function expandingFolds<T>(sortedRows: T[]): { train: T[]; test: T[] }[] {
  return expandingFoldsChunks(sortedRows, 4);
}

/**
 * Ten-fold Brier: rows sorted by slug, fold f holds out every 10th row
 * starting at f. Each fold fits on the other nine and predicts the held
 * out rows; the Brier is over all rows' out-of-fold predictions.
 */
export function tenFoldBrier(rows: OddsRow[], groups: OddsGroup[]): number {
  const ordered = rows.slice().sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const predicted: number[] = new Array(ordered.length).fill(0);
  for (let fold = 0; fold < 10; fold++) {
    const train: OddsRow[] = [];
    const test: OddsRow[] = [];
    for (let i = 0; i < ordered.length; i++) {
      if (i % 10 !== fold) train.push(ordered[i]!);
      else test.push(ordered[i]!);
    }
    if (test.length === 0) continue;
    let trainSum = 0;
    for (const r of train) trainSum += r.y;
    const baseRate = train.length > 0 ? trainSum / train.length : 0;
    const model = fitOdds(train, groups, baseRate);
    for (const row of test) predicted[ordered.indexOf(row)] = predictOdds(model, row);
  }
  return brierScore(predicted, ordered.map((r) => r.y));
}

/**
 * Walk-forward Brier under a given block count: dated rows sorted by
 * (listedAt, slug), expanding folds, each fold fit on its training blocks
 * and predicting its test block. `correct` is the share of test rows
 * called right — a row counts as called right when (predicted > overall
 * base rate) matches its actual outcome. The PRIMARY procedure uses 4
 * blocks; the SECONDARY uses 3.
 */
function walkForward(rows: OddsRow[], groups: OddsGroup[], chunks: number): { brier: number; correct: number; n: number; predicted: number[]; actual: number[] } {
  const dated = rows
    .filter((r) => r.listedAt !== null)
    .sort((a, b) => {
      if (a.listedAt! < b.listedAt!) return -1;
      if (a.listedAt! > b.listedAt!) return 1;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  const predicted: number[] = [];
  const actual: number[] = [];
  for (const fold of expandingFoldsChunks(dated, chunks)) {
    let trainSum = 0;
    for (const r of fold.train) trainSum += r.y;
    const baseRate = fold.train.length > 0 ? trainSum / fold.train.length : 0;
    const model = fitOdds(fold.train, groups, baseRate);
    for (const row of fold.test) {
      predicted.push(predictOdds(model, row));
      actual.push(row.y);
    }
  }
  let allSum = 0;
  for (const r of rows) allSum += r.y;
  const baseRate = rows.length > 0 ? allSum / rows.length : 0;
  let right = 0;
  for (let i = 0; i < predicted.length; i++) {
    if ((predicted[i]! > baseRate ? 1 : 0) === actual[i]) right += 1;
  }
  return {
    brier: brierScore(predicted, actual),
    correct: actual.length > 0 ? right / actual.length : 0,
    n: actual.length,
    predicted,
    actual,
  };
}

/** The PRIMARY walk-forward Brier: 4 blocks, 3 expanding folds. */
export function walkForwardBrier(rows: OddsRow[], groups: OddsGroup[]): { brier: number; correct: number; n: number; predicted: number[]; actual: number[] } {
  return walkForward(rows, groups, 4);
}

/** The SECONDARY walk-forward Brier: 3 blocks, 2 expanding folds. */
export function walkForwardBrierAlt(rows: OddsRow[], groups: OddsGroup[]): { brier: number; correct: number; n: number; predicted: number[]; actual: number[] } {
  return walkForward(rows, groups, 3);
}

/**
 * Baseline walk-forward Brier under a given block count: each fold
 * predicts its test block with the training blocks' mean outcome — the
 * no-model score the fitted model has to beat.
 */
function baselineWalkForward(rows: OddsRow[], chunks: number): number {
  const dated = rows
    .filter((r) => r.listedAt !== null)
    .sort((a, b) => {
      if (a.listedAt! < b.listedAt!) return -1;
      if (a.listedAt! > b.listedAt!) return 1;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  const predicted: number[] = [];
  const actual: number[] = [];
  for (const fold of expandingFoldsChunks(dated, chunks)) {
    let trainSum = 0;
    for (const r of fold.train) trainSum += r.y;
    const rate = fold.train.length > 0 ? trainSum / fold.train.length : 0;
    for (const row of fold.test) {
      predicted.push(rate);
      actual.push(row.y);
    }
  }
  return brierScore(predicted, actual);
}

/** Baseline walk-forward Brier under the PRIMARY (4-block) procedure. */
export function baselineWalkForwardBrier(rows: OddsRow[]): number {
  return baselineWalkForward(rows, 4);
}

/** Baseline walk-forward Brier under the SECONDARY (3-block) procedure. */
export function baselineWalkForwardBrierAlt(rows: OddsRow[]): number {
  return baselineWalkForward(rows, 3);
}

/**
 * Sequential selection with evidence. Groups are tried in ODDS_GROUPS
 * order; a group is kept only if adding it lowers BOTH the ten-fold
 * Brier AND the PRIMARY walk-forward Brier, strictly. The secondary
 * walk-forward Brier is computed for every candidate and reported, but
 * it never decides a keep — it is an honesty check on the measurement,
 * not a gate. The final model is fitted on the kept groups.
 */
export function fitOddsWithEvidence(rows: OddsRow[]): { model: OddsModel; evidence: OddsEvidence } {
  let allSum = 0;
  for (const r of rows) allSum += r.y;
  const baseRate = rows.length > 0 ? allSum / rows.length : 0;
  const baselineBrier = brierScore(
    rows.map(() => baseRate),
    rows.map((r) => r.y),
  );
  const baselineWfBrier = baselineWalkForwardBrier(rows);
  const baselineWfBrierAlt = baselineWalkForwardBrierAlt(rows);
  const terms: OddsTermEvidence[] = [
    { name: "intercept-only (base rate)", brier: baselineBrier, wfBrier: baselineWfBrier, wfBrierAlt: baselineWfBrierAlt, kept: "baseline" },
  ];
  let kept: OddsGroup[] = [];
  let bestBrier = baselineBrier;
  let bestWfBrier = baselineWfBrier;
  let finalBrier = baselineBrier;
  let finalWfBrier = baselineWfBrier;
  let finalWfBrierAlt = baselineWfBrierAlt;
  let finalCorrect = 0;
  let finalCorrectAlt = 0;
  for (const group of ODDS_GROUPS) {
    const candidate: OddsGroup[] = [...kept, group];
    const brier = tenFoldBrier(rows, candidate);
    const wf = walkForwardBrier(rows, candidate);
    const wfAlt = walkForwardBrierAlt(rows, candidate);
    const helps = brier < bestBrier && wf.brier < bestWfBrier;
    terms.push({
      name: GROUP_LABELS[group],
      brier,
      wfBrier: wf.brier,
      wfBrierAlt: wfAlt.brier,
      kept: helps ? "kept" : "tested, not kept",
    });
    if (helps) {
      kept = candidate;
      bestBrier = brier;
      bestWfBrier = wf.brier;
      finalBrier = brier;
      finalWfBrier = wf.brier;
      finalWfBrierAlt = wfAlt.brier;
      finalCorrect = wf.correct;
      finalCorrectAlt = wfAlt.correct;
    }
  }
  if (kept.length === 0) {
    finalCorrect = walkForwardBrier(rows, []).correct;
    finalCorrectAlt = walkForwardBrierAlt(rows, []).correct;
  }
  const model = fitOdds(rows, kept, baseRate);
  const evidence: OddsEvidence = {
    n: rows.length,
    baseRate,
    baselineBrier,
    baselineWfBrier,
    baselineWfBrierAlt,
    finalBrier,
    finalWfBrier,
    finalWfBrierAlt,
    walkForwardCorrect: finalCorrect,
    walkForwardCorrectAlt: finalCorrectAlt,
    terms,
  };
  return { model, evidence };
}
