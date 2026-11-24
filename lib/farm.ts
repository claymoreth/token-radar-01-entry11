// farm.ts — farm economics, the ten-step plan, and nearest priced peers.
//
// What a real user would actually net from farming a pre-token protocol,
// after gas, after time, and against doing nothing. The row's implied
// value already prices in the chance the token ever trades, so the odds
// are NOT multiplied in a second time: the modelled drop is 7% of the
// implied value, fees are the plan's on-chain transactions at the
// mid-point gas price of the protocol's main chain, and time is the
// hands-on minutes of the ten steps.
//
// Verdict rule: FARM clears BOTH benchmarks (net above the 12-week
// T-bill on the same deposit AND net per hour at or above $25);
// MARGINAL clears neither fully but still nets above zero; SKIP loses
// money to gas (net at or below zero).

/** One step of the ten-step farm plan. */
export interface FarmStep {
  n: number;
  title: string;
  text: string;
  cost: string;
  time: string;
}

/** One nearest priced peer, with a genuinely held-out model figure. */
export interface FarmPeer {
  name: string;
  category: string | null;
  tvl: number;
  mcap: number;
  ratio: number;
  heldOut: number;
}

/** A board row, in the same field order lib/model.ts writes it. */
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
  factors: { multiple: number; size: number; category: number };
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
  farmPlan: FarmStep[];
  exitRule: string;
  peers: FarmPeer[];
  parentFactor?: number;
  parentName?: string;
}

/** One protocol from the snapshot, in the snapshot's own field names. */
export interface SnapshotProtocol {
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

/** The snapshot, as far as the farm stage cares. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The modelled airdrop is 7% of implied value. */
export const DROP_SHARE = 0.07;
/** The modelled hold is 12 weeks. */
export const HORIZON_WEEKS = 12;
/** The plan size is 0.02% of TVL, clamped to [$100, $10,000]. */
export const DEPOSIT_MIN = 100;
export const DEPOSIT_MAX = 10000;
/** 12-week T-bill on the same deposit: 4% a year. */
export const TBILL_ANNUAL = 0.04;
/** The farmer's time is benchmarked at $25/hour. */
export const HOURLY_BENCHMARK = 25;

/** Mid-point gas price per transaction, in dollars, by chain. */
const GAS_MID: Record<string, number> = {
  Ethereum: 11.5,
  Solana: 0.03,
  Base: 0.175,
  Arbitrum: 0.3,
  Binance: 0.2,
  BNB: 0.2,
  Avalanche: 0.4,
  Polygon: 0.055,
  Optimism: 0.175,
  Monad: 0.175,
  Plasma: 0.175,
  Hyperliquid: 0.175,
  "Hyperliquid L1": 0.175,
  "Robinhood Chain": 0.175,
  Unichain: 0.175,
};

/** The gas range string shown in the plan, by chain. */
const GAS_RANGE: Record<string, string> = {
  Ethereum: "$8-15",
  Solana: "$0.01-0.05",
  Base: "$0.05-0.30",
  Arbitrum: "$0.10-0.50",
  Binance: "$0.10-0.30",
  BNB: "$0.10-0.30",
  Avalanche: "$0.20-0.60",
  Polygon: "$0.01-0.10",
  Optimism: "$0.05-0.30",
  Monad: "$0.05-0.30",
  Plasma: "$0.05-0.30",
  Hyperliquid: "$0.05-0.30",
  "Hyperliquid L1": "$0.05-0.30",
  "Robinhood Chain": "$0.05-0.30",
  Unichain: "$0.05-0.30",
};

/** Mid-point gas price for one transaction on a chain ($1.25 when unknown). */
export function gasPerTx(chain: string): number {
  return GAS_MID[chain] ?? 1.25;
}

/** The gas range string for a chain ("$0.50-2" when unknown). */
export function gasRange(chain: string): string {
  return GAS_RANGE[chain] ?? "$0.50-2";
}

/** Money with two decimals, e.g. "$11.50". */
export function money(n: number): string {
  return "$" + n.toFixed(2);
}

/** Whole dollars with thousands separators, e.g. "$2,750,000". */
export function moneyInt(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

/** Round to two decimals. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Round a ratio to four decimals. */
function ratio4(ratio: number): number {
  return Math.round(ratio * 10000) / 10000;
}

/**
 * The plan deposit for a row: 0.02% of its TVL, clamped to [$100,
 * $10,000], rounded to cents. A whale-sized protocol and a small one
 * both get a farm a real person could actually run.
 */
export function planDeposit(tvlUsd: number): number {
  const sized = 0.0002 * tvlUsd;
  if (sized < DEPOSIT_MIN) return DEPOSIT_MIN;
  if (sized > DEPOSIT_MAX) return DEPOSIT_MAX;
  return Math.round(sized * 100) / 100;
}

/** The 12-week T-bill return on the same deposit at 4% a year. */
export function tbillFor(depositUsd: number): number {
  return depositUsd * TBILL_ANNUAL * (HORIZON_WEEKS / 52);
}

/**
 * The core move and the follow-up move per category. The core is the one
 * thing the protocol exists for; the follow-up is a second, different use
 * of the same protocol a few weeks later. `{name}` and `{chain}` are
 * filled in at run time. Categories the table does not know fall back to
 * DEFAULT_ACTION.
 */
type ActionPair = [string, string];
const ACTIONS: Record<string, ActionPair> = {
  Dexs: [
    "Swap a modest amount through {name} on {chain}, then place the same pair into a liquidity position so it starts earning trading fees.",
    "After two weeks, take half the liquidity back out, swap the proceeds through {name} again, and open a new position at a different size.",
  ],
  Lending: [
    "Deposit collateral into {name} on {chain} and borrow against it at well under half its value, keeping the position far from liquidation.",
    "Repay part of the loan, add a little more collateral, then borrow again at a smaller size so the account completes two full cycles.",
  ],
  Yield: [
    "Place the deposit into the biggest vault on {name} on {chain} and leave it compounding untouched for at least two weeks.",
    "Harvest the yield once, put the harvest straight back into the same vault, and keep the position open for the rest of the hold.",
  ],
  "Yield Aggregator": [
    "Place the deposit into the leading strategy on {name} on {chain} and let it run for three weeks without touching it.",
    "Collect the yield once, move the harvest into a second strategy on the same aggregator, and keep both running.",
  ],
  RWA: [
    "Mint the tokenised asset on {name} on {chain} with the deposit and hold it in the same wallet for the full hold period.",
    "Redeem a quarter of the position, then mint again at a different size so both directions of the primary market appear.",
  ],
  "Onchain Capital Allocator": [
    "Place the deposit into the flagship allocation vault on {name} on {chain} and leave the allocation untouched for a month.",
    "Read the vault's allocation report, move a small slice into a second vault on the same protocol, and compare the two.",
  ],
  "Risk Curators": [
    "Place the deposit into a curated vault on {name} on {chain} run by a curator with a public track record, after reading its risk note.",
    "Move a small slice to a second curator's vault after two weeks and keep both positions open.",
  ],
  Derivatives: [
    "Open a small position on {name} on {chain} with a stop-loss in place, sized so a bad week costs little, and close it within a week.",
    "Open a second, smaller position later in the hold and close it before the hold ends, so the account shows more than one trade.",
  ],
  CDP: [
    "Lock collateral in {name} on {chain} and mint its stablecoin against it at less than half the collateral's value.",
    "Spend the minted stablecoin somewhere low-risk, buy it back, and close the vault before the hold period ends.",
  ],
  "Basis Trading": [
    "Place the deposit into the basis vault on {name} on {chain} and hold it through at least one full funding cycle of two weeks.",
    "Withdraw a third of the position, wait a week, and put it back in, so the vault is used rather than just parked.",
  ],
  Chain: [
    "Bridge the deposit to {name} on its own chain and spend it on a real transaction in the chain's flagship app.",
    "Stake a small amount with a validator on {name}, then unstake and stake again once to show continued participation.",
  ],
  "Staking Pool": [
    "Stake the deposit in the pool on {name} on {chain} and leave it earning for the full hold period.",
    "Unstake a quarter after a month, then stake it again so the account shows two staking cycles.",
  ],
  "Liquid Staking": [
    "Stake the deposit through {name} on {chain} and hold the liquid staking token in the same wallet for the full hold period.",
    "Use a slice of the liquid staking token in a low-risk venue, then bring it back into the stake before the hold ends.",
  ],
  "Liquid Restaking": [
    "Restake the deposit through {name} on {chain} and keep the restaked position open for the full hold period.",
    "Move a slice to a second operator after two weeks and keep both delegations active.",
  ],
  "Liquidity Manager": [
    "Put a pair into a managed position on {name} on {chain} and let the manager rebalance it for two weeks.",
    "Withdraw half, open a fresh managed position with it, and compare how the two positions perform.",
  ],
  Restaking: [
    "Restake the deposit through {name} on {chain} and keep the position open for the full hold period.",
    "Delegate a slice to a second operator after two weeks and keep both delegations active.",
  ],
  CeDeFi: [
    "Place the deposit into the CeDeFi vault on {name} on {chain} and hold the position for the full hold period.",
    "Withdraw a quarter after a month and put it back in, so the vault is used more than once.",
  ],
  "Anchor BTC": [
    "Put BTC collateral into {name} on {chain} and mint against it at less than half the collateral's value.",
    "Pay back part of the minted amount after two weeks, then mint again at a smaller size.",
  ],
  "Leveraged Farming": [
    "Open a small leveraged farm on {name} on {chain} at under 2x leverage, with a planned exit inside two weeks.",
    "Close the farm, take the result, and open a second farm at half the size.",
  ],
  "Dual-Token Stablecoin": [
    "Mint the stablecoin on {name} on {chain} with the deposit and hold it in the same wallet for the full hold period.",
    "Swap a quarter of it for the paired token, then swap it back, so both sides of the peg show up.",
  ],
  "Decentralized BTC": [
    "Mint the BTC-backed token on {name} on {chain} and hold it for the full hold period.",
    "Redeem a quarter back to BTC after a month, then mint again at a smaller size.",
  ],
  "Interest Rate Derivatives": [
    "Open a small fixed-rate position on {name} on {chain} for a 30-day term and hold it to maturity.",
    "Open a second position at a different rate after two weeks and compare the two terms.",
  ],
  Indexes: [
    "Buy the index token on {name} on {chain} with the deposit and hold it for the full hold period.",
    "Sell a quarter after a month, then buy it back, so the index is used more than once.",
  ],
  Payments: [
    "Make three small real payments through {name} on {chain}, a week apart, to different recipients.",
    "Receive one payment back into the same wallet so the account shows flow in both directions.",
  ],
  "Prediction Market": [
    "Place three small bets on {name} on {chain} on markets that resolve on different dates, never more than $20 each.",
    "Claim the winnings of the first market that resolves and place one more bet with part of the proceeds.",
  ],
  Insurance: [
    "Buy a small cover policy on {name} on {chain} for a protocol you actually use, for a 30-day term.",
    "Renew the cover once it lapses, so the account shows two consecutive policies.",
  ],
  "Crypto Card Issuer": [
    "Order the card from {name} on {chain}, top it up with the deposit, and spend it on two real purchases.",
    "Top it up a second time after two weeks and make one more purchase with it.",
  ],
  Farm: [
    "Stake LP tokens in the farm on {name} on {chain} and collect the rewards after two weeks.",
    "Put the collected rewards straight back into the same farm and keep the position open through the hold.",
  ],
  Bridge: [
    "Bridge the deposit through {name} on {chain} to a chain you actually use, and use the bridged funds there.",
    "Bridge a slice back the other way after two weeks, so the account shows both directions of the bridge.",
  ],
  "Canonical Bridge": [
    "Bridge the deposit through {name} on {chain} to a chain you actually use, and use the bridged funds there.",
    "Bridge a slice back the other way after two weeks, so the account shows both directions of the bridge.",
  ],
  "Cross Chain Bridge": [
    "Bridge the deposit through {name} on {chain} to a chain you actually use, and use the bridged funds there.",
    "Bridge a slice back the other way after two weeks, so the account shows both directions of the bridge.",
  ],
  "Uncollateralized Lending": [
    "Borrow a small amount through {name} on {chain} at a size you could repay from cash, and repay it inside two weeks.",
    "Borrow once more at a smaller size after repaying, so the account shows two completed loans.",
  ],
  Launchpad: [
    "Join one sale on {name} on {chain} with a small allocation and hold what you receive for the full hold period.",
    "Join a second sale at a smaller size after two weeks and compare the two allocations.",
  ],
  Synthetics: [
    "Mint a small synthetic position on {name} on {chain} and hold it through one full week of price moves.",
    "Close the position, then open a second one at half the size and hold it to the end of the hold period.",
  ],
};

/** The fallback pair for a category the table does not know. */
const DEFAULT_ACTION: ActionPair = [
  "Use the flagship feature on {name} on {chain} with the deposit and keep the position open for at least two weeks.",
  "Use the same feature once more at a different size after two weeks, so the account shows continued use.",
];

/**
 * How many transactions the core step needs: Dexs, Lending and CDP cores
 * need 2 calls (trade + add liquidity, supply + borrow, lock + mint);
 * every other core is 1.
 */
function coreTxCount(category: string): number {
  if (category === "Dexs" || category === "Lending" || category === "CDP") return 2;
  return 1;
}

/** Total plan transactions: FUND 1 + CORE coreTx + DEEPEN 1 + CADENCE 1 + CLAIM 1. */
function planTxCount(row: BoardRow): number {
  return 4 + coreTxCount(row.category);
}

/** The plan's total gas fees: transaction count times the chain's mid gas price. */
function feesFor(row: BoardRow): number {
  const chain = row.chains[0] ?? "Ethereum";
  return round2(planTxCount(row) * gasPerTx(chain));
}

/** The modelled drop for a deposit at a drop share: the deposit's share of implied value. */
function dropFor(row: BoardRow, deposit: number, share: number): number {
  if (row.tvlUsd <= 0) return 0;
  return round2((row.impliedValueUsd * share * deposit) / row.tvlUsd);
}

/** Fill a plan template's {name} and {chain} placeholders for a row. */
function fill(template: string, name: string, chain: string): string {
  return template.split("{name}").join(name).split("{chain}").join(chain);
}

/** The cost line for a step that needs `n` transactions on a chain. */
function txCost(n: number, chain: string, gas: number, range: string): string {
  if (n === 0) return "COST: $0.00 (no transaction — reading and checking only)";
  return `COST: ${money(n * gas)} (${n === 1 ? "one transaction" : n + " transactions"} on ${chain} at ~${money(gas)} each, gas ${range} per tx)`;
}

/**
 * The ten-step farm plan for a row: setup, verify, fund, risk, the
 * category's core move, the follow-up, cadence, watch, record, claim.
 * Every step carries its cost and its hands-on time.
 */
export function farmPlanFor(row: BoardRow): FarmStep[] {
  const chain = row.chains[0] ?? "Ethereum";
  const gas = gasPerTx(chain);
  const range = gasRange(chain);
  const deposit = planDeposit(row.tvlUsd);
  const coreTx = coreTxCount(row.category);
  const pair = ACTIONS[row.category] ?? DEFAULT_ACTION;
  const core = pair[0];
  const second = pair[1];
  const exitTvl = 0.83 * row.tvlUsd;
  return [
    {
      n: 1,
      title: "SETUP",
      text: `Open a fresh wallet used only for this farm, fund it on ${chain} with ${money(deposit)} plus gas, and connect it to ${row.name}. A wallet that has never touched another farm keeps the activity clean and easy to explain.`,
      cost: "COST: $0.00 (no transaction — wallet creation and funding are arranged off-chain before the first on-chain step)",
      time: "TIME: 10 min hands-on",
    },
    {
      n: 2,
      title: "VERIFY",
      text: `Check ${row.name} on DefiLlama and on its official site or docs, and match the contract address shown there against the one the app asks you to sign. Never open the app from a link in a DM or a search ad — type the address yourself.`,
      cost: "COST: $0.00 (no transaction — reading and checking only)",
      time: "TIME: 15 min hands-on",
    },
    {
      n: 3,
      title: "FUND",
      text: `Move ${money(deposit)} into the fresh wallet on ${chain} — one withdrawal from an exchange, or one bridge if the funds sit on another chain — and confirm the balance landed before doing anything else.`,
      cost: txCost(1, chain, gas, range),
      time: "TIME: 10 min hands-on",
    },
    {
      n: 4,
      title: "RISK",
      text: `Read the strategy and risk note for ${row.name} before depositing: what the position holds, what can be lost, and whether withdrawals can pause. If the note is missing or unreadable, stop here and keep the funds in the wallet.`,
      cost: "COST: $0.00 (no transaction — reading and checking only)",
      time: "TIME: 20 min hands-on",
    },
    {
      n: 5,
      title: "CORE",
      text: fill(core, row.name, chain),
      cost: txCost(coreTx, chain, gas, range),
      time: "TIME: 15 min hands-on",
    },
    {
      n: 6,
      title: "DEEPEN",
      text: fill(second, row.name, chain),
      cost: txCost(1, chain, gas, range),
      time: "TIME: 15 min hands-on",
    },
    {
      n: 7,
      title: "CADENCE",
      text: `Touch the position once a week for ${HORIZON_WEEKS} weeks: check the balance and the protocol's announcements, and make one real top-up or rebalance transaction halfway through. Weekly check-ins are free reads; only the mid-hold transaction pays gas.`,
      cost: txCost(1, chain, gas, range),
      time: "TIME: 60 min hands-on (5 min a week for 12 weeks)",
    },
    {
      n: 8,
      title: "WATCH",
      text: `Set the exit rule and keep it: withdraw if ${row.name} TVL prints below ${moneyInt(exitTvl)}, which is -17% from today's ${moneyInt(row.tvlUsd)}, or at once if withdrawals pause or the team says a snapshot has already been taken.`,
      cost: "COST: $0.00 (no transaction — monitoring only)",
      time: "TIME: 30 min hands-on (a few minutes a week for 12 weeks)",
    },
    {
      n: 9,
      title: "RECORD",
      text: "Keep a ledger of the farm: date, transaction hash, asset, and dollar value for every move, in one place. If a claim ever needs proof of activity, this ledger is the proof.",
      cost: "COST: $0.00 (no transaction — writing down what already happened)",
      time: "TIME: 15 min hands-on",
    },
    {
      n: 10,
      title: "CLAIM",
      text: `Watch for the claim window on ${row.name}'s official channels, check vesting or lockup terms first, and claim in one transaction. If you sell at all, sell only part of the claim on day one — the rest can wait for the price to find its level.`,
      cost: txCost(1, chain, gas, range),
      time: "TIME: 15 min hands-on",
    },
  ];
}

/** Total hands-on minutes of a plan: the first number in each step's time string, summed.
 *  Every row totals 205 minutes (10+15+10+20+15+15+60+30+15+15). */
function totalPlanMinutes(plan: FarmStep[]): number {
  let total = 0;
  for (const step of plan) {
    const match = /TIME: (\d+) min/.exec(step.time);
    if (match) total += Number(match[1]);
  }
  return total;
}

/**
 * The six short farm steps the gate checks (3–12 strings, each 20–600
 * chars): setup, the core move, the follow-up, the hold, the one-wallet
 * rule, and the claim.
 */
export function farmStepsFor(row: BoardRow, plan: FarmStep[]): string[] {
  const chain = row.chains[0] ?? "Ethereum";
  const gas = gasPerTx(chain);
  const deposit = planDeposit(row.tvlUsd);
  const core = plan[4]?.text ?? "";
  const second = plan[5]?.text ?? "";
  return [
    `Set up a fresh wallet, fund it on ${chain} with ${money(deposit)} plus gas (${gasRange(chain)} per tx), and connect it to ${row.name}. COST: $0.00 to set up. TIME: 10 min hands-on.`,
    `${core} COST: ${money(coreTxCount(row.category) * gas)} on ${chain}. TIME: 15 min hands-on.`,
    `${second} COST: ${money(gas)} on ${chain}. TIME: 15 min hands-on.`,
    `Hold the position for ${HORIZON_WEEKS} weeks and touch it once a week, spreading activity across days so it reads as a real user. COST: ${money(gas)} for one mid-hold transaction. TIME: 60 min hands-on.`,
    `Do not split the farm across many wallets or copy identical transactions: one wallet, organic timing, and no scripted bursts. COST: $0.00. TIME: 0 min hands-on.`,
    `At launch, watch for the claim window, check any vesting or lockup first, and sell only part of the claim on day one if you sell at all. COST: ${money(gas)} to claim. TIME: 15 min hands-on.`,
  ];
}

/** The exit rule for a row: pull out if TVL prints 17% below today's, or at once on a pause or snapshot. */
export function exitRuleFor(row: BoardRow): string {
  const exitTvl = 0.83 * row.tvlUsd;
  return `Withdraw if ${row.name} TVL prints below ${moneyInt(exitTvl)}, which is -17% from today's ${moneyInt(row.tvlUsd)}. Also pull out at once if withdrawals pause, the team announces a snapshot has already been taken, or the claim window opens and the position no longer needs to sit there.`;
}

/**
 * Up to 8 nearest priced peers in the row's category, nearest by
 * |log(peer TVL / row TVL)|, snapshot order breaking ties. `heldOut` is
 * the leave-one-out model prediction over the peer's actual cap/TVL
 * ratio when the caller passes a predictor — 1.00 means the model priced
 * the peer exactly; without one it falls back to the peer's own ratio,
 * which is NOT a held-out number.
 */
export function peersFor(row: BoardRow, snapshot: Snapshot, predict?: (peer: SnapshotProtocol) => number): FarmPeer[] {
  const scored: { peer: SnapshotProtocol; distance: number }[] = [];
  for (const p of snapshot.protocols) {
    if (p.slug === row.slug) continue;
    if (p.category !== row.category) continue;
    if (!(p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)) continue;
    scored.push({ peer: p, distance: Math.abs(Math.log(p.tvl_usd / row.tvlUsd)) });
  }
  scored.sort((a, b) => a.distance - b.distance);
  return scored.slice(0, 8).map(({ peer }) => {
    const ratio = peer.mcap_usd! / peer.tvl_usd;
    const r4 = ratio4(ratio);
    return {
      name: peer.name,
      category: peer.category,
      tvl: peer.tvl_usd,
      mcap: peer.mcap_usd!,
      ratio: r4,
      heldOut: predict ? Math.round(predict(peer) * 10000) / 10000 : r4,
    };
  });
}

/**
 * Cost a row's farm: deposit, plan, fees, drop, net, hours, net per
 * hour, and the verdict against the two benchmarks. Mutates the row in
 * place, assigning the farm fields in a fixed order.
 */
export function addFarm(rows: BoardRow[], snapshot: Snapshot, predict?: (peer: SnapshotProtocol) => number): void {
  for (const row of rows) {
    const deposit = planDeposit(row.tvlUsd);
    const plan = farmPlanFor(row);
    const fees = feesFor(row);
    const drop = dropFor(row, deposit, DROP_SHARE);
    const net = round2(drop - fees);
    const hours = round2(totalPlanMinutes(plan) / 60);
    const netPerHour = hours > 0 ? round2(net / hours) : 0;
    const tbill = tbillFor(deposit);
    let verdict: "FARM" | "MARGINAL" | "SKIP";
    if (net <= 0) verdict = "SKIP";
    else if (net > tbill && netPerHour >= HOURLY_BENCHMARK) verdict = "FARM";
    else verdict = "MARGINAL";
    row.depositUsd = deposit;
    row.dropShare = DROP_SHARE;
    row.horizonWeeks = HORIZON_WEEKS;
    row.dropUsd = drop;
    row.feesUsd = fees;
    row.netFees = net;
    row.netPerHour = netPerHour;
    row.handsOnHours = hours;
    row.verdict = verdict;
    row.farmPlan = plan;
    row.farmSteps = farmStepsFor(row, plan);
    row.exitRule = exitRuleFor(row);
    row.peers = peersFor(row, snapshot, predict);
  }
}

/**
 * The net-by-drop-share × deposit grid the detail view renders: three
 * drop shares (3.5%, 7%, 14%) against four deposits ($1,000 / $3,000 /
 * $10,000 / $30,000), each cell the modelled drop at that share and
 * deposit minus the row's own fees.
 */
export function netMatrix(row: BoardRow): { shares: number[]; deposits: number[]; values: number[][] } {
  const shares = [0.035, 0.07, 0.14];
  const deposits = [1000, 3000, 10000, 30000];
  const fees = row.feesUsd !== undefined && row.feesUsd !== null ? row.feesUsd : feesFor(row);
  const values = shares.map((share) => deposits.map((deposit) => round2(dropFor(row, deposit, share) - fees)));
  return { shares, deposits, values };
}
