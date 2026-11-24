// parent.ts — the 20 parent-product lines and the ×0.48 factor.
//
// Some board rows are not standalone protocols: they are one product line
// of a larger parent (a perps desk, a stablecoin arm, a vault product).
// A line like that keeps only 48% of its fitted value, because the value
// of the line is not the value of the whole parent. The list is a fixed
// data table carried over from the v4 entry; each value is the v4
// description of the line, not a parent name. Matching is by exact slug,
// case-sensitive — no substring or name matching, so a lookalike slug
// never gets discounted by accident.

/** The share of fitted value a parent-product line keeps. */
export const PARENT_FACTOR = 0.48;

/**
 * Slug → line description, in the v4 order. Twenty entries; the runner
 * and the bootstrap both read this same table so the discount is applied
 * identically in the board and inside the rank ranges. A slug that is not
 * in this table is a standalone protocol and keeps its full fitted value.
 */
export const PARENT_PRODUCTS: Record<string, string> = {
  "arcus-perps": "Arcus perps desk",
  "avant-avusd": "Avant avUSD stablecoin",
  "azverse-perps": "AZverse perps desk",
  "bitfi-basis": "BitFi basis-trading product",
  "cian-yield-layer": "CIAN yield product",
  "circle-gateway": "Circle cross-chain product",
  "defi-saver-asset-management": "DeFi Saver asset-management product",
  "extended-perps": "Extended perps desk",
  "figure-markets-exchange": "Figure Markets exchange arm",
  "figure-markets-prime": "Figure Markets prime arm",
  "ipor-fusion": "IPOR Fusion vault product",
  "loopscale-lending": "Loopscale lending product",
  "mellow-core": "Mellow core vault product",
  "nado-spot": "Nado spot product",
  "polymarket-international": "Polymarket international arm",
  "sentora-curator": "Sentora curator product",
  "solv-strategies": "Solv strategy product",
  "stellar-defi-hub": "Stellar DeFi hub product",
  "theo-network-thusd": "Theo Network thUSD stablecoin",
  "usdcx": "Circle USDCx wrapped product",
};

/**
 * Scale a dollar value by the parent factor, rounding to whole dollars
 * and never below $1. The $1 floor matters for the tiniest rows: a
 * discount must shrink a value, never erase it.
 */
export function parentScale(v: number): number {
  return Math.max(1, Math.round(v * PARENT_FACTOR));
}
