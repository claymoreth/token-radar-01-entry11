// model.ts — the value model, the board builder, and the odds training rows.
//
// The board answers: if a protocol with no token issued one tomorrow,
// what would it be worth? implied value = TVL × fitted multiple × token
// odds. The multiple is fitted from the snapshot's own priced protocols;
// the odds come from lib/odds.ts; the intervals come from lib/range.ts.
//
// The value model in this entry is fitted on the DATED priced rows only
// (95 of 128 priced): the walk-forward test can only run on dated rows,
// so the fit is aligned with the validation instead of being scored on a
// set it was never tested against. The flat median multiple and the
// per-category reference multiples are still computed from all 128 priced
// protocols — only the fit itself uses the dated 95. Terms are added one
// at a time and kept only when they lower the held-out miss in BOTH
// out-of-sample tests (leave-one-out and chronological walk-forward).
// A shuffled-growth control is tested last and never kept: if it ever
// "helped", the selection would be measuring noise, not signal.

import { fitOddsWithEvidence, predictOdds } from "./odds.ts";
import type { OddsRow } from "./odds.ts";
import type { OddsEvidence } from "./odds.ts";
import { coverageFraction, fnv1a, intervalBounds, mulberry32, quantile, residualQuantiles } from "./range.ts";
import type { ResidualQuantiles } from "./range.ts";
import { PARENT_PRODUCTS, parentScale } from "./parent.ts";

/** One protocol, in the snapshot's own field names. */
export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The snapshot. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** The three factors of a row's fitted multiple. */
export interface Factors {
  multiple: number;
  size: number;
  category: number;
}

/** One step of a farm plan, as the farm stage writes it. */
export interface FarmPlanStep {
  n: number;
  title: string;
  text: string;
  cost: string;
  time: string;
}

/** One nearest priced peer, with a genuinely held-out model figure. */
export interface PeerRow {
  name: string;
  category: string | null;
  tvl: number;
  mcap: number;
  ratio: number;
  heldOut: number;
}

/**
 * One board row, fields in this exact order — JSON key order depends on
 * it. `parentFactor` and `parentName` are appended after `peers` by
 * main.ts, never by this file.
 */
export interface BoardRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvlUsd: number;
  change7d: number | null;
  ageDays: number | null;
  watchlist: boolean;
  rank: number;
  impliedValueUsd: number;
  valueIfLaunches: number;
  tokenOdds: number;
  p25: number;
  p75: number;
  p10: number;
  p90: number;
  bootstrapLow: number;
  bootstrapHigh: number;
  bootstrapRankLow: number;
  bootstrapRankHigh: number;
  factors: Factors;
  verdict: "FARM" | "MARGINAL" | "SKIP";
  netFees: number;
  netPerHour: number;
  dropUsd: number;
  feesUsd: number;
  handsOnHours: number;
  depositUsd: number;
  dropShare: number;
  horizonWeeks: number;
  farmSteps: string[];
  farmPlan: FarmPlanStep[];
  exitRule: string;
  peers: PeerRow[];
  parentFactor?: number;
  parentName?: string;
  /**
   * Gate aliases in the starter kit's snake_case, as the gate reads
   * board.json (implied_value_usd, farm_steps). Same numbers as the
   * camelCase fields the dashboard reads; appended last so the existing
   * key order is untouched. Set by main.ts after the final sort.
   */
  implied_value_usd?: number;
  farm_steps?: string[];
}

/** One value-model evidence row. */
export interface ValueTermEvidence {
  name: string;
  loo: number;
  wf: number;
  kept: "kept" | "tested, not kept" | "baseline" | "must not help";
}

/** One odds-model evidence row (mirrors lib/odds.ts, without the secondary Brier). */
export interface OddsTermEvidence {
  name: string;
  brier: number;
  wfBrier: number;
  kept: "kept" | "tested, not kept" | "baseline";
}

/** The board's evidence: value terms, odds evidence, and range honesty. */
export interface Evidence {
  value: {
    n: number;
    baselineLoo: number;
    baselineWf: number;
    finalLoo: number;
    finalWf: number;
    terms: ValueTermEvidence[];
  };
  odds: OddsEvidence;
  range: {
    rows: { label: string; stated: number; loo: number; wf: number }[];
    note: string;
  };
}

/** The whole board: model tag, snapshot date, rows, reference multiples, live count, evidence. */
export interface Board {
  model: string;
  as_of: string;
  rows: BoardRow[];
  multiples: { category: string; multiple: number; n: number }[];
  globalMultiple: number;
  liveCount: number;
  evidence: Evidence;
}

/** Median of a list: the middle element, or the mean of the two middle ones. Empty reads as 0. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Whole days between a listing date and the snapshot date, or null when
 * the listing date is missing or unparseable. Never negative.
 */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(listedAt + "T00:00:00Z");
  const end = Date.parse(asOf + "T00:00:00Z");
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.floor((end - start) / 86400000));
}

/**
 * A protocol's family: the first whitespace-separated word of its
 * trimmed name, lowercased; the slug when the name is empty. "Aave V2"
 * and "Aave V3" are one family, "Aavegotchi" is another.
 */
export function familyOf(name: string, slug: string): string {
  const trimmed = name.trim();
  const first = trimmed === "" ? slug : trimmed.split(/\s+/)[0]!;
  return first.toLowerCase();
}

// ---------------------------------------------------------------- exclusions

/** Categories that are never board candidates and never odds training rows. */
const EXCLUDED_CATEGORIES = new Set(["CEX", "Liquid Staking", "Bridge", "Canonical Bridge", "Liquid Restaking", "Restaked BTC"]);

/** A name ending in a version marker, e.g. "Aave V3" or "Curve 2.0". */
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word "wrapped", "staked" or "staking", any case. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchange prefixes: a name starting with one of these is an exchange arm, not a protocol. */
const EXCHANGE_PREFIXES = ["Binance", "Coinbase", "Bybit", "Kraken", "Bitget", "OKX", "Bitfinex", "Gemini"];

/** True when the name is versioned, wrapped/staked, or starts with an exchange prefix. */
function isExcludedName(p: Protocol): boolean {
  if (VERSION_SUFFIX.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  for (const prefix of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(prefix)) return true;
  }
  return false;
}

/** True when DefiLlama records no token at all for the protocol. */
function isNoToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** True when a protocol belongs on the board: no token, not an excluded category, not an excluded name. */
function isBoardCandidate(p: Protocol): boolean {
  return isNoToken(p) && (p.category === null || !EXCLUDED_CATEGORIES.has(p.category)) && !isExcludedName(p);
}

/** True when a protocol is out of the odds training set (category or name only — no token check). */
function isOddsExcluded(p: Protocol): boolean {
  return (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) || isExcludedName(p);
}

// ---------------------------------------------------------------- value model

/** One row the value model trains on (or scores, with y null). */
interface ModelRow {
  slug: string;
  listedAt: string | null;
  ageYears: number | null;
  lnTvl: number;
  growthRaw: number | null;
  growthShuffled: number | null;
  lnChains: number;
  family: string;
  category: string;
  y: number | null;
}

/** The one-variable features a stage can use. */
type FeatureKey = "lnTvl" | "growth" | "growthShuffled" | "age" | "lnChains";

/** One candidate stage of the value model. */
type Stage =
  | { kind: "const"; name: string }
  | { kind: "ols"; key: FeatureKey; name: string }
  | { kind: "group"; key: "family" | "category"; lambda: number; name: string };

/** The training means the feature fallbacks use. */
interface FitStats {
  meanGrowth: number;
  meanAge: number;
}

/** Mean growth and mean age over the non-null values of a training set (0 when none). */
function fitStatsOf(train: ModelRow[]): FitStats {
  let growthSum = 0;
  let growthCount = 0;
  let ageSum = 0;
  let ageCount = 0;
  for (const row of train) {
    if (row.growthRaw !== null) {
      growthSum += row.growthRaw;
      growthCount += 1;
    }
    if (row.ageYears !== null) {
      ageSum += row.ageYears;
      ageCount += 1;
    }
  }
  return {
    meanGrowth: growthCount > 0 ? growthSum / growthCount : 0,
    meanAge: ageCount > 0 ? ageSum / ageCount : 0,
  };
}

/**
 * One feature's value for a row. Growth is clamped to [-0.9, 3] (the
 * value model's growth clamp, unchanged); a missing growth or age takes
 * the training mean.
 */
function featureValue(row: ModelRow, key: FeatureKey, stats: FitStats): number {
  if (key === "lnTvl") return row.lnTvl;
  if (key === "growth") return Math.max(-0.9, Math.min(3, row.growthRaw ?? stats.meanGrowth));
  if (key === "growthShuffled") return Math.max(-0.9, Math.min(3, row.growthShuffled ?? stats.meanGrowth));
  if (key === "age") return row.ageYears ?? stats.meanAge;
  return row.lnChains;
}

/** One fitted stage: its intercept/slope, or its shrunk group effects. */
interface FittedStage {
  stage: Stage;
  intercept: number;
  slope: number;
  effects: Map<string, number>;
}

/** A fitted value model: its stages in order, and its training means. */
interface ValueModel {
  stages: FittedStage[];
  stats: FitStats;
}

/**
 * Fit the stages IN ORDER, each on the residuals of the ones before it.
 * const takes the median residual; ols takes the one-variable least
 * squares fit; group takes shrunk group means (sum / (count + lambda),
 * so lambda pseudo-observations of zero pull small groups toward no
 * effect).
 */
function fitValueModel(train: ModelRow[], stages: Stage[]): ValueModel {
  const stats = fitStatsOf(train);
  const fitted: FittedStage[] = [];
  let residuals = train.map((r) => r.y!);
  for (const stage of stages) {
    if (stage.kind === "const") {
      const a = median(residuals);
      fitted.push({ stage, intercept: a, slope: 0, effects: new Map() });
      residuals = residuals.map((r) => r - a);
    } else if (stage.kind === "ols") {
      const xs = train.map((r) => featureValue(r, stage.key, stats));
      let meanX = 0;
      let meanR = 0;
      for (let i = 0; i < xs.length; i++) {
        meanX += xs[i]!;
        meanR += residuals[i]!;
      }
      meanX = xs.length > 0 ? meanX / xs.length : 0;
      meanR = residuals.length > 0 ? meanR / residuals.length : 0;
      let sxx = 0;
      let sxy = 0;
      for (let i = 0; i < xs.length; i++) {
        sxx += (xs[i]! - meanX) * (xs[i]! - meanX);
        sxy += (xs[i]! - meanX) * (residuals[i]! - meanR);
      }
      const slope = sxx > 0 ? sxy / sxx : 0;
      const intercept = meanR - slope * meanX;
      fitted.push({ stage, intercept, slope, effects: new Map() });
      residuals = residuals.map((r, i) => r - (intercept + slope * xs[i]!));
    } else {
      const sums = new Map<string, number>();
      const counts = new Map<string, number>();
      for (let i = 0; i < train.length; i++) {
        const key = stage.key === "family" ? train[i]!.family : train[i]!.category;
        sums.set(key, (sums.get(key) ?? 0) + residuals[i]!);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const effects = new Map<string, number>();
      for (const [key, sum] of sums) {
        effects.set(key, sum / (counts.get(key)! + stage.lambda));
      }
      fitted.push({ stage, intercept: 0, slope: 0, effects });
      residuals = residuals.map((r, i) => {
        const key = stage.key === "family" ? train[i]!.family : train[i]!.category;
        return r - (effects.get(key) ?? 0);
      });
    }
  }
  return { stages: fitted, stats };
}

/**
 * Predict a row's log multiple: the sum of its stages' contributions.
 * `sizePart` accumulates the ln(TVL) curve's contribution; `categoryPart`
 * accumulates the group effects' contribution; `total` is the whole log
 * multiple.
 */
function predictValue(model: ValueModel, row: ModelRow): { total: number; sizePart: number; categoryPart: number } {
  let total = 0;
  let sizePart = 0;
  let categoryPart = 0;
  for (const fitted of model.stages) {
    let add = 0;
    if (fitted.stage.kind === "const") {
      add = fitted.intercept;
    } else if (fitted.stage.kind === "ols") {
      add = fitted.intercept + fitted.slope * featureValue(row, fitted.stage.key, model.stats);
      if (fitted.stage.key === "lnTvl") sizePart += add;
    } else {
      const key = fitted.stage.key === "family" ? row.family : row.category;
      add = fitted.effects.get(key) ?? 0;
      categoryPart += add;
    }
    total += add;
  }
  return { total, sizePart, categoryPart };
}

/** The miss factor: exp of the median absolute log error. A miss of 3 means the typical price is off by 3x. */
function missFactor(predicted: number[], actual: number[]): number {
  const errors: number[] = [];
  for (let i = 0; i < predicted.length; i++) errors.push(Math.abs(predicted[i]! - actual[i]!));
  return Math.exp(median(errors));
}

/** Leave-one-out predictions: for each row, fit on all the others and predict it. */
function looPredictions(rows: ModelRow[], stages: Stage[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const train = rows.filter((_, j) => j !== i);
    const model = fitValueModel(train, stages);
    out.push(predictValue(model, rows[i]!).total);
  }
  return out;
}

/**
 * Walk-forward predictions: dated rows sorted by (listedAt, slug),
 * split into 4 near-equal blocks; fold k trains on blocks 0..k and
 * predicts block k+1. Returns the predictions and the actual log ratios
 * of the tested rows.
 */
function wfPredictions(dated: ModelRow[], stages: Stage[]): { predicted: number[]; actual: number[] } {
  const sorted = dated.slice().sort((a, b) => {
    if (a.listedAt! < b.listedAt!) return -1;
    if (a.listedAt! > b.listedAt!) return 1;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  const n = sorted.length;
  const base = Math.floor(n / 4);
  const extra = n - base * 4;
  const blocks: ModelRow[][] = [];
  let at = 0;
  for (let b = 0; b < 4; b++) {
    const size = base + (b < extra ? 1 : 0);
    blocks.push(sorted.slice(at, at + size));
    at += size;
  }
  const predicted: number[] = [];
  const actual: number[] = [];
  for (let k = 0; k < 3; k++) {
    const train: ModelRow[] = [];
    for (let b = 0; b <= k; b++) train.push(...blocks[b]!);
    const model = fitValueModel(train, stages);
    for (const row of blocks[k + 1]!) {
      predicted.push(predictValue(model, row).total);
      actual.push(row.y!);
    }
  }
  return { predicted, actual };
}

// ---------------------------------------------------------------- LOO ratio lookup

/** The leave-one-out fitted ratio per priced slug, set by buildBoardModel. */
let looRatioBySlug = new Map<string, number>();

/**
 * A predictor for the farm stage: given a priced peer, return the
 * leave-one-out model prediction over the peer's actual cap/TVL ratio.
 * 1 means the model priced the peer exactly. A peer with no usable cap,
 * or one outside the fitted map, falls back to 1.
 */
export function looRatioPredictor(): (peer: Protocol) => number {
  const snapshot = new Map(looRatioBySlug);
  return (peer: Protocol): number => {
    const actual = peer.mcap_usd !== null && peer.tvl_usd > 0 ? peer.mcap_usd / peer.tvl_usd : 0;
    const predicted = snapshot.get(peer.slug);
    if (actual <= 0 || predicted === undefined) return 1;
    return predicted / actual;
  };
}

// ---------------------------------------------------------------- board builder

/**
 * Build the whole board from a snapshot. Steps: seed; priced protocols
 * and reference multiples; the dated value-model rows and their stage
 * selection; the final fit and its residuals; the LOO ratio lookup; the
 * interval honesty table; the odds training rows and their selection;
 * the board drafts; the 200-refit bootstrap; ranking with $1 tie-nudges;
 * the rows; the evidence.
 */
export function buildBoardModel(snapshot: Snapshot): Board {
  // Step 1 — seed: the snapshot date plus every slug, in snapshot order.
  const seed = fnv1a(snapshot.as_of + "|" + snapshot.protocols.map((p) => p.slug).join(","));

  // Step 2 — priced protocols: a cap on a positive TVL with a positive ratio.
  const allRatios: number[] = [];
  const ratiosByCategory = new Map<string, number[]>();
  const priced: Protocol[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd !== null && p.tvl_usd > 0) {
      const ratio = p.mcap_usd / p.tvl_usd;
      if (ratio > 0) {
        priced.push(p);
        allRatios.push(ratio);
        const key = p.category ?? "Uncategorized";
        const list = ratiosByCategory.get(key) ?? [];
        list.push(ratio);
        ratiosByCategory.set(key, list);
      }
    }
  }
  const globalMultiple = median(allRatios);

  // Step 3 — category reference multiples, from ALL priced protocols.
  const multiples: { category: string; multiple: number; n: number }[] = [];
  const categoryEntries = Array.from(ratiosByCategory.entries());
  categoryEntries.sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
  for (const [category, ratios] of categoryEntries) {
    multiples.push({
      category,
      multiple: ratios.length >= 3 ? Math.min(1, Math.max(0.05, median(ratios))) : globalMultiple,
      n: ratios.length,
    });
  }

  // Step 4 — value-model rows: the DATED priced protocols only, slug order.
  // The shuffled-growth values are drawn from the dated set itself.
  const orderedDated = priced
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const shuffleRng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const perm: number[] = [];
  for (let i = 0; i < orderedDated.length; i++) perm.push(i);
  for (let i = perm.length - 1; i >= 1; i--) {
    const j = Math.floor(shuffleRng() * (i + 1));
    const tmp = perm[i]!;
    perm[i] = perm[j]!;
    perm[j] = tmp;
  }
  const buildModelRow = (p: Protocol, shuffledGrowth: number | null): ModelRow => {
    const days = ageDays(snapshot.as_of, p.listed_at);
    return {
      slug: p.slug,
      listedAt: p.listed_at,
      ageYears: days === null ? null : days / 365.25,
      lnTvl: Math.log(p.tvl_usd / 1e8),
      growthRaw: p.change_7d,
      growthShuffled: shuffledGrowth,
      lnChains: Math.log(Math.max(1, p.chains.length)),
      family: familyOf(p.name, p.slug),
      category: p.category ?? "Uncategorized",
      y: p.mcap_usd !== null && p.tvl_usd > 0 ? Math.log(p.mcap_usd / p.tvl_usd) : null,
    };
  };
  const valueRows: ModelRow[] = orderedDated.map((p, i) => buildModelRow(p, orderedDated[perm[i]!]!.change_7d));
  const datedRows = valueRows;
  const actuals = valueRows.map((r) => r.y!);

  // Step 5 — sequential term selection: keep a stage only if it lowers
  // BOTH the LOO miss and the walk-forward miss, strictly.
  const constStage: Stage = { kind: "const", name: "flat median multiple" };
  const sizeStage: Stage = { kind: "ols", key: "lnTvl", name: "size curve ln(TVL)" };
  const categoryStage: Stage = { kind: "group", key: "category", lambda: 32, name: "category effect (ridge 32)" };
  const familyStage: Stage = { kind: "group", key: "family", lambda: 8, name: "family effect (ridge)" };
  const growthStage: Stage = { kind: "ols", key: "growth", name: "7-day TVL growth" };
  const ageStage: Stage = { kind: "ols", key: "age", name: "age (years listed)" };
  const chainsStage: Stage = { kind: "ols", key: "lnChains", name: "chain count (ln)" };
  const controlStage: Stage = { kind: "ols", key: "growthShuffled", name: "CONTROL shuffled growth" };
  const evaluate = (stages: Stage[]): { loo: number; wf: number } => {
    const looPreds = looPredictions(valueRows, stages);
    const wf = wfPredictions(datedRows, stages);
    return { loo: missFactor(looPreds, actuals), wf: missFactor(wf.predicted, wf.actual) };
  };
  let keptStages: Stage[] = [constStage];
  let current = evaluate(keptStages);
  const baseline = { ...current };
  const valueTerms: ValueTermEvidence[] = [
    { name: "flat median multiple", loo: current.loo, wf: current.wf, kept: "baseline" },
  ];
  for (const stage of [sizeStage, categoryStage, familyStage, growthStage, ageStage, chainsStage]) {
    const candidate = [...keptStages, stage];
    const score = evaluate(candidate);
    const helps = score.loo < current.loo && score.wf < current.wf;
    valueTerms.push({ name: stage.name, loo: score.loo, wf: score.wf, kept: helps ? "kept" : "tested, not kept" });
    if (helps) {
      keptStages = candidate;
      current = score;
    }
  }
  const controlScore = evaluate([...keptStages, controlStage]);
  valueTerms.push({ name: "CONTROL shuffled growth", loo: controlScore.loo, wf: controlScore.wf, kept: "must not help" });

  // Step 6 — final fit and residuals.
  const finalValueModel = fitValueModel(valueRows, keptStages);
  const finalLooPreds = looPredictions(valueRows, keptStages);
  const looResiduals = actuals.map((y, i) => y - finalLooPreds[i]!);
  const finalWf = wfPredictions(datedRows, keptStages);
  const wfResiduals = finalWf.actual.map((y, i) => y - finalWf.predicted[i]!);
  const looQuantiles: ResidualQuantiles = residualQuantiles(looResiduals);
  const wfQuantiles: ResidualQuantiles = residualQuantiles(wfResiduals);

  // Step 7 — LOO ratio lookup for the farm stage's peers.
  looRatioBySlug = new Map(valueRows.map((row, i) => [row.slug, Math.exp(finalLooPreds[i]!)]));

  // Step 8 — interval honesty (coverage), in ratio space.
  const looActualRatios = actuals.map((y) => Math.exp(y));
  const looPredRatios = finalLooPreds.map((p) => Math.exp(p));
  const looCover50 = coverageFraction(
    looActualRatios,
    looPredRatios.map((p) => p * Math.exp(looQuantiles.q25)),
    looPredRatios.map((p) => p * Math.exp(looQuantiles.q75)),
  );
  const looCover80 = coverageFraction(
    looActualRatios,
    looPredRatios.map((p) => p * Math.exp(looQuantiles.q10)),
    looPredRatios.map((p) => p * Math.exp(looQuantiles.q90)),
  );
  const wfActualRatios = finalWf.actual.map((y) => Math.exp(y));
  const wfPredRatios = finalWf.predicted.map((p) => Math.exp(p));
  const wfCover50 = coverageFraction(
    wfActualRatios,
    wfPredRatios.map((p) => p * Math.exp(wfQuantiles.q25)),
    wfPredRatios.map((p) => p * Math.exp(wfQuantiles.q75)),
  );
  const wfCover80 = coverageFraction(
    wfActualRatios,
    wfPredRatios.map((p) => p * Math.exp(wfQuantiles.q10)),
    wfPredRatios.map((p) => p * Math.exp(wfQuantiles.q90)),
  );

  // Step 9 — odds training rows: the ticker-RECORDED target. y = 1 when
  // DefiLlama records a ticker (gecko_id or symbol set), 0 when no token
  // is recorded at all. The middle class is included as y = 1.
  const oddsRows: OddsRow[] = [];
  for (const p of snapshot.protocols) {
    if (isOddsExcluded(p)) continue;
    const days = ageDays(snapshot.as_of, p.listed_at);
    oddsRows.push({
      slug: p.slug,
      listedAt: p.listed_at,
      ageYears: days === null ? null : days / 365.25,
      lnTvl: Math.log(p.tvl_usd / 1e8),
      growthRaw: p.change_7d,
      lnChains: Math.log(Math.max(1, p.chains.length)),
      family: familyOf(p.name, p.slug),
      category: p.category ?? "Uncategorized",
      y: p.gecko_id !== null || p.symbol !== null ? 1 : 0,
    });
  }
  const { model: oddsModel, evidence: oddsEvidence } = fitOddsWithEvidence(oddsRows);

  // Step 10 — board drafts: one per board candidate.
  const watchlist = new Set(snapshot.watchlist);
  const candidates = snapshot.protocols.filter((p) => isBoardCandidate(p));
  interface Draft {
    protocol: Protocol;
    implied: number;
    valueIfLaunches: number;
    odds: number;
    fittedMultiple: number;
    sizeFactor: number;
    categoryFactor: number;
    boardFeature: ModelRow;
    bootImplied: number[];
    bootRanks: number[];
    bootLow: number;
    bootHigh: number;
    bootRankLow: number;
    bootRankHigh: number;
  }
  const drafts: Draft[] = [];
  for (const p of candidates) {
    const boardFeature = buildModelRow(p, null);
    boardFeature.y = null;
    const oddsFeature: OddsRow = {
      slug: p.slug,
      listedAt: p.listed_at,
      ageYears: boardFeature.ageYears,
      lnTvl: boardFeature.lnTvl,
      growthRaw: p.change_7d,
      lnChains: boardFeature.lnChains,
      family: boardFeature.family,
      category: boardFeature.category,
      y: 0,
    };
    const pred = predictValue(finalValueModel, boardFeature);
    const fittedMultiple = Math.exp(pred.total);
    const odds = predictOdds(oddsModel, oddsFeature);
    const valueIfLaunches = Math.max(1, Math.round(p.tvl_usd * fittedMultiple));
    const implied = Math.max(1, Math.round(p.tvl_usd * fittedMultiple * odds));
    drafts.push({
      protocol: p,
      implied,
      valueIfLaunches,
      odds,
      fittedMultiple,
      sizeFactor: Math.exp(pred.sizePart),
      categoryFactor: Math.exp(pred.categoryPart),
      boardFeature,
      bootImplied: [],
      bootRanks: [],
      bootLow: 0,
      bootHigh: 0,
      bootRankLow: 0,
      bootRankHigh: 0,
    });
  }

  // Step 11 — bootstrap: 200 refits on resampled value rows, odds held
  // fixed, parent discount applied inside the refits so the rank ranges
  // are measured on the discounted board the reader sees.
  const bootRng = mulberry32(seed);
  for (let b = 0; b < 200; b++) {
    const resample: ModelRow[] = [];
    for (let i = 0; i < valueRows.length; i++) {
      resample.push(valueRows[Math.floor(bootRng() * valueRows.length)]!);
    }
    const bootModel = fitValueModel(resample, keptStages);
    const bootValues = drafts.map((draft) =>
      Math.max(1, Math.round(draft.protocol.tvl_usd * Math.exp(predictValue(bootModel, draft.boardFeature).total) * draft.odds)),
    );
    for (let i = 0; i < drafts.length; i++) drafts[i]!.bootImplied.push(bootValues[i]!);
    const rankedValues = bootValues.map((v, i) => (drafts[i]!.protocol.slug in PARENT_PRODUCTS ? parentScale(v) : v));
    const order = drafts.map((_, i) => i);
    order.sort((a, b) => {
      if (rankedValues[b]! !== rankedValues[a]!) return rankedValues[b]! - rankedValues[a]!;
      if (drafts[b]!.protocol.tvl_usd !== drafts[a]!.protocol.tvl_usd) return drafts[b]!.protocol.tvl_usd - drafts[a]!.protocol.tvl_usd;
      return drafts[a]!.protocol.slug < drafts[b]!.protocol.slug ? -1 : drafts[a]!.protocol.slug > drafts[b]!.protocol.slug ? 1 : 0;
    });
    order.forEach((draftIndex, place) => {
      drafts[draftIndex]!.bootRanks.push(place + 1);
    });
  }
  for (const draft of drafts) {
    const sortedImplied = draft.bootImplied.slice().sort((a, b) => a - b);
    const sortedRanks = draft.bootRanks.slice().sort((a, b) => a - b);
    draft.bootLow = quantile(sortedImplied, 0.05);
    draft.bootHigh = quantile(sortedImplied, 0.95);
    draft.bootRankLow = Math.round(quantile(sortedRanks, 0.05));
    draft.bootRankHigh = Math.round(quantile(sortedRanks, 0.95));
  }

  // Step 12 — rank and nudge: implied descending, TVL descending, slug
  // ascending; ties nudged down by $1 so implied values strictly decrease.
  drafts.sort((a, b) => {
    if (b.implied !== a.implied) return b.implied - a.implied;
    if (b.protocol.tvl_usd !== a.protocol.tvl_usd) return b.protocol.tvl_usd - a.protocol.tvl_usd;
    return a.protocol.slug < b.protocol.slug ? -1 : a.protocol.slug > b.protocol.slug ? 1 : 0;
  });
  for (let i = 1; i < drafts.length; i++) {
    if (drafts[i]!.implied >= drafts[i - 1]!.implied) drafts[i]!.implied = drafts[i - 1]!.implied - 1;
  }

  // Step 13 — rows, in the BoardRow field order.
  const rows: BoardRow[] = drafts.map((draft, i) => {
    const p = draft.protocol;
    const bounds = intervalBounds(draft.implied, looQuantiles);
    const days = ageDays(snapshot.as_of, p.listed_at);
    return {
      slug: p.slug,
      name: p.name,
      category: p.category ?? "Uncategorized",
      chains: p.chains,
      tvlUsd: p.tvl_usd,
      change7d: p.change_7d,
      ageDays: days,
      watchlist: watchlist.has(p.slug),
      rank: i + 1,
      impliedValueUsd: draft.implied,
      valueIfLaunches: draft.valueIfLaunches,
      tokenOdds: draft.odds,
      p25: bounds.p25,
      p75: bounds.p75,
      p10: bounds.p10,
      p90: bounds.p90,
      bootstrapLow: Math.max(1, Math.round(Math.min(draft.bootLow, draft.implied))),
      bootstrapHigh: Math.max(1, Math.round(Math.max(draft.bootHigh, draft.implied))),
      bootstrapRankLow: draft.bootRankLow,
      bootstrapRankHigh: draft.bootRankHigh,
      factors: { multiple: draft.fittedMultiple, size: draft.sizeFactor, category: draft.categoryFactor },
      verdict: "MARGINAL",
      netFees: 0,
      netPerHour: 0,
      dropUsd: 0,
      feesUsd: 0,
      handsOnHours: 0,
      depositUsd: 0,
      dropShare: 0,
      horizonWeeks: 0,
      farmSteps: [1, 2, 3, 4, 5, 6].map(
        (n) => `Placeholder langkah farm ${n} dari 6 — subagent farm mengganti teks ini dengan langkah nyata sebelum submit.`,
      ),
      farmPlan: [],
      exitRule: "",
      peers: [],
    };
  });

  // Step 14 — evidence and return.
  const evidence: Evidence = {
    value: {
      n: valueRows.length,
      baselineLoo: baseline.loo,
      baselineWf: baseline.wf,
      finalLoo: current.loo,
      finalWf: current.wf,
      terms: valueTerms,
    },
    odds: oddsEvidence,
    range: {
      rows: [
        { label: "P25–P75", stated: 0.5, loo: looCover50, wf: wfCover50 },
        { label: "P10–P90", stated: 0.8, loo: looCover80, wf: wfCover80 },
      ],
      note: "Intervals are the implied value shifted by the quantiles of the value model's own held-out log residuals (LOO residuals for the board bounds). Coverage is the share of priced protocols whose real cap fell inside the interval: LOO over the dated priced rows the model was fitted on, walk-forward over the same dated rows with a walk-forward prediction.",
    },
  };
  return {
    model: "radar-11",
    as_of: snapshot.as_of,
    rows,
    multiples,
    globalMultiple,
    liveCount: valueRows.length,
    evidence,
  };
}
