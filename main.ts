// main.ts — the entry runner: model → parent discount → farm → accounting
// → integrity → board.json / data.js / dossier.json.
//
// Node 22, standard library only, no network. The entry directory is
// MAKEFUN_BOT_DIR when set, else the directory of this script — never
// process.cwd() alone, so the grader can run the entry from any working
// directory and still find dashboard/ and screenshots/.
//
//   mkdir -p out && RADAR_INPUT=<snapshot> RADAR_OUTPUT=out node main.ts
//
// --input <file|dir> overrides RADAR_INPUT; --output <dir> overrides
// RADAR_OUTPUT (or MAKEFUN_OUTPUT_DIR). A directory input means
// <dir>/snapshot.json. The run is deterministic: the same snapshot always
// yields the same bytes.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBoardModel, looRatioPredictor } from "./lib/model.ts";
import { addFarm } from "./lib/farm.ts";
import { buildAccounting } from "./lib/accounting.ts";
import { buildIntegrity } from "./lib/integrity.ts";
import { PARENT_FACTOR, PARENT_PRODUCTS, parentScale } from "./lib/parent.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

/** The most bytes the dossier's text may hold. */
const TEXT_MAX_BYTES = 65536;
/** Screenshot caps the dossier enforces: at most 4, each at most 512 KiB. */
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524288 };
/** Dashboard caps the dossier enforces: at most 400 files, 4 MiB in all. */
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4194304 };

/** The entry directory: MAKEFUN_BOT_DIR when set, else this script's directory. */
const ENTRY_DIR = process.env.MAKEFUN_BOT_DIR ?? fileURLToPath(new URL(".", import.meta.url));

/** Read one --name value / --name=value argument, or undefined. */
function argValue(name: string): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name && i + 1 < args.length) return args[i + 1];
    if (args[i]!.startsWith(name + "=")) return args[i]!.slice(name.length + 1);
  }
  return undefined;
}

/** Resolve the snapshot path: --input, RADAR_INPUT, or the default. */
function inputPath(): string {
  const fromArg = argValue("--input");
  const fromEnv = process.env.RADAR_INPUT;
  let p = fromArg ?? fromEnv ?? "/input/snapshot.json";
  try {
    if (statSync(p).isDirectory()) p = join(p, "snapshot.json");
  } catch {
    // A missing path is reported below with a clear message.
  }
  return p;
}

/** Resolve the output directory: --output, RADAR_OUTPUT, MAKEFUN_OUTPUT_DIR, or the default. */
function outputDir(): string {
  return argValue("--output") ?? process.env.RADAR_OUTPUT ?? process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
}

/** Copy a directory's regular files (skipping dot-names) into the output dir; returns the count copied. */
function copyDir(srcDir: string, outDir: string): number {
  if (!existsSync(srcDir)) return 0;
  mkdirSync(outDir, { recursive: true });
  let copied = 0;
  for (const name of readdirSync(srcDir)) {
    if (name.startsWith(".")) continue;
    const src = join(srcDir, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(outDir, name));
    copied += 1;
  }
  return copied;
}

function main(): number {
  const input = inputPath();
  const out = outputDir();
  let raw: string;
  try {
    raw = readFileSync(input, "utf8");
  } catch {
    console.error(`main.ts: cannot read snapshot at ${input}`);
    return 2;
  }
  let snapshot: ReturnType<typeof JSON.parse>;
  try {
    snapshot = JSON.parse(raw);
  } catch {
    console.error(`main.ts: snapshot at ${input} is not valid JSON`);
    return 2;
  }
  if (!snapshot || !Array.isArray(snapshot.protocols) || !Array.isArray(snapshot.watchlist)) {
    console.error(`main.ts: snapshot at ${input} has no protocols/watchlist arrays`);
    return 2;
  }

  // Build the board, then discount the parent-product lines: scale the
  // implied value and every bound derived from it, tag the row, and
  // re-rank with $1 tie-nudges so implied values stay strictly decreasing.
  const board = buildBoardModel(snapshot);
  const detected: { slug: string; name: string; parent: string }[] = [];
  const missing: string[] = [];
  for (const row of board.rows) {
    const parent = PARENT_PRODUCTS[row.slug];
    if (parent === undefined) continue;
    row.parentFactor = PARENT_FACTOR;
    row.parentName = parent;
    row.impliedValueUsd = parentScale(row.impliedValueUsd);
    row.p25 = parentScale(row.p25);
    row.p75 = parentScale(row.p75);
    row.p10 = parentScale(row.p10);
    row.p90 = parentScale(row.p90);
    row.bootstrapLow = parentScale(row.bootstrapLow);
    row.bootstrapHigh = parentScale(row.bootstrapHigh);
    detected.push({ slug: row.slug, name: row.name, parent });
  }
  for (const slug of Object.keys(PARENT_PRODUCTS)) {
    if (!board.rows.some((r) => r.slug === slug)) missing.push(slug);
  }
  board.rows.sort((a, b) => {
    if (b.impliedValueUsd !== a.impliedValueUsd) return b.impliedValueUsd - a.impliedValueUsd;
    if (b.tvlUsd !== a.tvlUsd) return b.tvlUsd - a.tvlUsd;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  for (let i = 1; i < board.rows.length; i++) {
    if (board.rows[i]!.impliedValueUsd >= board.rows[i - 1]!.impliedValueUsd) {
      board.rows[i]!.impliedValueUsd = board.rows[i - 1]!.impliedValueUsd - 1;
    }
  }
  board.rows.forEach((row, i) => {
    row.rank = i + 1;
  });

  // Farm, accounting, integrity — in that order, as the spec requires.
  addFarm(board.rows, snapshot, looRatioPredictor());
  const accounting = buildAccounting(snapshot, board.rows);
  const integrity = buildIntegrity(board.rows, snapshot);
  // Gate aliases: the gate reads board.json in the starter kit's
  // snake_case (implied_value_usd, farm_steps); the dashboard keeps
  // reading the camelCase fields. Same numbers and strings, two
  // spellings — set here, after the final sort and tie-nudges, so the
  // aliases always match the shipped values.
  for (const row of board.rows) {
    row.implied_value_usd = row.impliedValueUsd;
    row.farm_steps = row.farmSteps;
  }
  const outObject = { ...board, floorUsd: snapshot.floor_usd, accounting, integrity };
  const json = JSON.stringify(outObject, null, 2);

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "board.json"), json + "\n", "utf8");
  writeFileSync(join(out, "data.js"), `window.RADAR = ${json};\n`, "utf8");
  const dashboardCopied = copyDir(join(ENTRY_DIR, "dashboard"), join(out, "dashboard"));
  const screenshotsCopied = copyDir(join(ENTRY_DIR, "screenshots"), join(out, "screenshots"));

  let dossierWritten = false;
  if (screenshotsCopied === 0) {
    console.error("main.ts: warning — no screenshots copied, skipping dossier.json");
  } else {
    try {
      const dossier = buildDossier(out, {
        text_max_bytes: TEXT_MAX_BYTES,
        screenshots: SCREENSHOT_CAPS,
        dashboard: DASHBOARD_CAPS,
      });
      writeFileSync(join(out, "dossier.json"), dossier);
      dossierWritten = true;
    } catch (err) {
      console.error(`main.ts: dossier build failed: ${(err as Error).message}`);
      return 2;
    }
  }

  const watchlistCovered = board.rows.filter((r) => r.watchlist).length;
  const totalImplied = board.rows.reduce((sum, r) => sum + r.impliedValueUsd, 0);
  console.log(`snapshot: ${snapshot.protocols.length} protocols, watchlist ${snapshot.watchlist.length}`);
  console.log(`board: ${board.rows.length} rows, watchlist covered ${watchlistCovered}/${snapshot.watchlist.length}`);
  console.log(`rank 1: ${board.rows[0]?.name ?? "—"} $${(board.rows[0]?.impliedValueUsd ?? 0).toLocaleString("en-US")}`);
  console.log(`total implied: $${Math.round(totalImplied).toLocaleString("en-US")}`);
  console.log(`parent rows ×0.48: ${detected.length}${detected.length > 0 ? " — " + detected.map((d) => d.slug).join(", ") : ""}`);
  if (missing.length > 0) console.log(`parent slugs with no board row: ${missing.join(", ")}`);
  console.log(
    `wrote: board.json, data.js${dashboardCopied > 0 ? `, dashboard/ (${dashboardCopied} files)` : ""}${screenshotsCopied > 0 ? `, screenshots/ (${screenshotsCopied} files)` : ""}${dossierWritten ? ", dossier.json" : ""} → ${out}`,
  );
  return 0;
}

process.exit(main());
