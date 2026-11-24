// accounting.ts — the 758-protocol ledger buckets.
//
// Every protocol in the snapshot lands in exactly one bucket, so the
// buckets always add up to the ledger total. A protocol is tested top to
// bottom and takes the FIRST bucket it matches, which is what makes the
// partition unambiguous: a ranked watchlist row is counted once, as a
// watchlist row, even though it would also match later buckets.

/** One protocol, in the snapshot's own field names. */
export interface AccountingProtocol {
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

/** The snapshot, as far as the ledger cares. */
export interface AccountingSnapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: AccountingProtocol[];
  watchlist: string[];
}

/** One bucket: its key, its human label, and how many protocols fell in. */
export interface AccountingGroup {
  key: string;
  label: string;
  count: number;
}

/** The whole ledger: total, buckets in priority order, ranked and watchlist counts. */
export interface Accounting {
  total: number;
  groups: AccountingGroup[];
  ranked: number;
  watchlist: number;
}

/** Categories that are bridges, in any spelling the snapshot uses. */
const BRIDGE_CATEGORIES = new Set(["Bridge", "Canonical Bridge", "Cross Chain Bridge"]);

/** Categories that are liquid staking or restaking. */
const LIQUID_STAKING_CATEGORIES = new Set(["Liquid Staking", "Liquid Restaking"]);

/**
 * The nine bucket definitions, in priority order. The floor label is
 * derived from the snapshot's floor_usd, never hardcoded: with a
 * $50,000,000 floor it reads "$50M".
 */
function groupDefinitions(floorUsd: number): { key: string; label: string }[] {
  const floorLabel = floorUsd >= 1e6 ? "$" + floorUsd / 1e6 + "M" : "$" + floorUsd;
  return [
    { key: "ranked-watchlist", label: "Ranked — on the 40-name watchlist" },
    { key: "ranked-early-below-floor", label: `Ranked — early, pre-token, below the ${floorLabel} floor` },
    { key: "ranked-off-list", label: "Ranked — pre-token, off the watchlist and above the floor" },
    { key: "token-trades-priced-comp", label: "Priced token — trades, used as a comparable" },
    { key: "token-recorded-no-usable-cap", label: "Token recorded, but no usable market cap" },
    { key: "out-bridge", label: "Out — bridge" },
    { key: "out-liquid-staking", label: "Out — liquid staking / restaking" },
    { key: "out-exchange", label: "Out — centralised exchange" },
    { key: "out-versioned-or-wrapped", label: "Out — versioned/wrapped variant, or unranked pre-token with no recorded token" },
  ];
}

/**
 * Classify one protocol into its bucket key. First match wins:
 * ranked rows first (watchlist, then early below the floor, then
 * off-list), then priced tokens that trade, then tokens recorded without
 * a usable cap, then the out-groups (bridge, liquid staking, exchange),
 * and everything else falls into the last bucket.
 */
function classify(
  p: AccountingProtocol,
  rankedSlugs: Set<string>,
  watchlistSlugs: Set<string>,
  floorUsd: number,
): string {
  if (rankedSlugs.has(p.slug) && watchlistSlugs.has(p.slug)) return "ranked-watchlist";
  if (rankedSlugs.has(p.slug) && p.tvl_usd < floorUsd && p.mcap_usd === null) return "ranked-early-below-floor";
  if (rankedSlugs.has(p.slug)) return "ranked-off-list";
  if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) return "token-trades-priced-comp";
  if (p.symbol !== null || p.gecko_id !== null) return "token-recorded-no-usable-cap";
  if (p.category !== null && BRIDGE_CATEGORIES.has(p.category)) return "out-bridge";
  if (p.category !== null && LIQUID_STAKING_CATEGORIES.has(p.category)) return "out-liquid-staking";
  if (p.category === "CEX") return "out-exchange";
  return "out-versioned-or-wrapped";
}

/**
 * Build the ledger: classify every protocol in snapshot order, count
 * each bucket, and return the total, the buckets in definition order,
 * the ranked row count and the watchlist size. On this snapshot the
 * expected counts are 40 / 138 / 20 / 128 / 288 / 43 / 41 / 42 / 18,
 * which sum to 758 — the whole ledger, nothing left uncounted.
 */
export function buildAccounting(snapshot: AccountingSnapshot, rows: { slug: string }[]): Accounting {
  const rankedSlugs = new Set(rows.map((r) => r.slug));
  const watchlistSlugs = new Set(snapshot.watchlist);
  const defs = groupDefinitions(snapshot.floor_usd);
  const groups: AccountingGroup[] = defs.map((d) => ({ key: d.key, label: d.label, count: 0 }));
  const byKey = new Map(groups.map((g) => [g.key, g]));
  for (const p of snapshot.protocols) {
    const key = classify(p, rankedSlugs, watchlistSlugs, snapshot.floor_usd);
    const group = byKey.get(key);
    if (group) group.count += 1;
  }
  return {
    total: snapshot.protocols.length,
    groups,
    ranked: rows.length,
    watchlist: snapshot.watchlist.length,
  };
}
