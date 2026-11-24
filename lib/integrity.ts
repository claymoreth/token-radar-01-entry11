// integrity.ts — the checksum and ledger counts.
//
// Proves the board on screen is the board that was computed: the dashboard
// recomputes these same six numbers from the data file in the browser, so
// a tampered or stale data file shows up as a failed check instead of
// silently rendering wrong numbers. The hash here is FNV-1a over UTF-8
// bytes, returned as eight lowercase hex digits — a different function
// from the number-returning FNV-1a in lib/range.ts, which hashes UTF-16
// code units and is only used for seeding.

/** One ranked row, as far as the checksum cares: slug, rank, value. */
export interface IntegrityRow {
  slug: string;
  rank: number;
  impliedValueUsd: number;
  watchlist?: boolean;
}

/** The snapshot, as far as the ledger cares: its size and its watchlist. */
export interface IntegritySnapshot {
  protocols: unknown[];
  watchlist: string[];
}

/** The six integrity numbers the dashboard re-checks. */
export interface Integrity {
  checksum: string;
  totalImplied: number;
  watchlistCovered: number;
  watchlistTotal: number;
  ledgerTotal: number;
  rows: number;
}

/**
 * 32-bit FNV-1a over UTF-8 bytes, as an 8-digit hex string.
 * Check values: fnv1a("") is "811c9dc5", fnv1a("a") is "e40c292c".
 */
export function fnv1a(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let hash = 0x811c9dc5;
  for (const b of bytes) {
    hash = hash ^ b;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * The exact string the checksum is taken over: one line per row,
 * "slug|rank|impliedValueUsd" with the value in JavaScript's default
 * number form, rows sorted by rank, lines joined with "\n" and no
 * trailing newline. Any change to a row's slug, rank or value changes
 * the checksum — and because the dashboard recomputes it from the same
 * rule, a reader can verify the board they see is the board that ran.
 */
export function checksumInput(rows: IntegrityRow[]): string {
  const sorted = rows.slice().sort((a, b) => a.rank - b.rank);
  return sorted.map((r) => `${r.slug}|${r.rank}|${r.impliedValueUsd}`).join("\n");
}

/**
 * Build the integrity record for a finished board: the checksum of the
 * ranked rows, the total implied value (rounded to cents), how many of
 * the watchlist slugs are covered, the watchlist size, the ledger size
 * (every protocol in the snapshot), and the row count.
 */
export function buildIntegrity(rows: IntegrityRow[], snapshot: IntegritySnapshot): Integrity {
  const watchlist = new Set(snapshot.watchlist);
  let covered = 0;
  let total = 0;
  for (const row of rows) {
    if (watchlist.has(row.slug)) covered += 1;
    total += row.impliedValueUsd;
  }
  return {
    checksum: fnv1a(checksumInput(rows)),
    totalImplied: Math.round(total * 100) / 100,
    watchlistCovered: covered,
    watchlistTotal: snapshot.watchlist.length,
    ledgerTotal: snapshot.protocols.length,
    rows: rows.length,
  };
}
