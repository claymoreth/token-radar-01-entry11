// range.ts — seeded randomness, residual quantiles, interval bounds, coverage.
//
// Small, stateless helpers. The only randomness in the whole entry lives
// here: mulberry32, driven by a seed the caller derives from the snapshot.
// Nothing in this file reads a file, touches the network, or keeps state
// between calls, so every result is a pure function of its arguments.
// The two callers that need randomness — the shuffled-growth control in
// lib/model.ts and the bootstrap refits — each open their own stream from
// the same seed family and never share one.

/** The four quantiles of a set of held-out log residuals. */
export interface ResidualQuantiles {
  q10: number;
  q25: number;
  q75: number;
  q90: number;
}

/**
 * 32-bit FNV-1a over a string's UTF-16 code units, returned as an unsigned
 * number. Used only to seed the PRNG streams; the checksum in
 * lib/integrity.ts is the separate UTF-8, hex-string variant.
 */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = hash ^ text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * mulberry32: a tiny deterministic PRNG. Each call advances the state by
 * the golden-gamma constant and scrambles it; the result is uniform in
 * [0, 1). Given the same seed it returns the same sequence forever, which
 * is what makes the shuffle and the bootstrap reproducible.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = t ^ (t + Math.imul(t ^ (t >>> 7), t | 61));
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A quantile of an ascending array by linear interpolation. `q` is in
 * [0, 1]; the caller always passes a pre-sorted array. An empty array
 * reads as 0 and a single element reads as itself.
 */
export function quantile(sortedValues: number[], q: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0]!;
  const pos = q * (sortedValues.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedValues[lo]!;
  return sortedValues[lo]! + (sortedValues[hi]! - sortedValues[lo]!) * (pos - lo);
}

/**
 * The four quantiles the board's intervals are built from: the 10th, 25th,
 * 75th and 90th percentiles of the held-out log residuals.
 */
export function residualQuantiles(residuals: number[]): ResidualQuantiles {
  const sorted = residuals.slice().sort((a, b) => a - b);
  return {
    q10: quantile(sorted, 0.1),
    q25: quantile(sorted, 0.25),
    q75: quantile(sorted, 0.75),
    q90: quantile(sorted, 0.9),
  };
}

/**
 * The board's interval bounds for one implied value: the value shifted by
 * the residual quantiles, floored at $1 so no bound ever prints as zero.
 * The caller passes the LOO quantiles, so the board's bounds are the
 * model's own held-out error, not a guess.
 */
export function intervalBounds(
  impliedValueUsd: number,
  q: ResidualQuantiles,
): { p25: number; p75: number; p10: number; p90: number } {
  return {
    p25: Math.max(1, Math.round(impliedValueUsd * Math.exp(q.q25))),
    p75: Math.max(1, Math.round(impliedValueUsd * Math.exp(q.q75))),
    p10: Math.max(1, Math.round(impliedValueUsd * Math.exp(q.q10))),
    p90: Math.max(1, Math.round(impliedValueUsd * Math.exp(q.q90))),
  };
}

/**
 * The share of actual values that fell inside their interval, inclusive on
 * both ends. This is the honesty check for the intervals: a P25–P75 band
 * that claims 50% should catch about half the held-out values.
 */
export function coverageFraction(actual: number[], lower: number[], upper: number[]): number {
  if (actual.length === 0) return 0;
  let inside = 0;
  for (let i = 0; i < actual.length; i++) {
    if (actual[i]! >= lower[i]! && actual[i]! <= upper[i]!) inside += 1;
  }
  return inside / actual.length;
}
