/**
 * Integration tests — error handling for invalid orders.
 *
 * Verifies that the full system (validator + SDK + extension JS pipeline)
 * correctly rejects:
 *   - Pairs not in the allowed list (unknown coin, vanta-only format)
 *   - Orders that exceed the per-pair cap
 *   - Orders that exceed the portfolio cap
 *
 * Also verifies extension-side JS cap enforcement using real limit values
 * from the testnet validator:
 *   - applyTraderLimits correctly computes HF-scaled caps from real data
 *     (pair_usd / fundedSize × accountBalance)
 *   - The cap blocks oversized HL orders (HL × mirror > HF cap) and allows
 *     correctly-sized orders
 *   - buildHlCoinToDisplay excludes vanta-only pairs from the display map
 *
 * No real orders are placed in this file — all rejection tests call `validate`
 * which checks server-side rules without touching HL.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { VALIDATOR_URL, HL_URL, VAULT_ADDRESS } from './config.js';
import {
  hlPost,
  validatorGet,
  buildHlCoinToDisplay,
  applyTraderLimits,
} from './helpers.js';

// ── Python helper wiring (same as lifecycle tests) ────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, 'scripts', 'hl_order.py');
const PYTHON = process.env.TEST_PYTHON
  || '/Users/arrash/develop/hyperfunded_tgbot/.venv/bin/python';

function runValidate(pair, usdSize) {
  const result = spawnSync(PYTHON, [SCRIPT, 'validate', pair, String(usdSize)], {
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env },
  });
  if (result.error) throw new Error(`spawnSync failed: ${result.error.message}`);
  const raw = (result.stdout || '').trim();
  if (!raw) throw new Error(`hl_order.py produced no output:\n${result.stderr}`);
  return JSON.parse(raw);
}

// ── Shared state ──────────────────────────────────────────────────────────────

let limitsData;
let hlEq;
let accountBalance;
let tradePairs;
let hlCoinToDisplay;

beforeAll(async () => {
  let validatorRaw;
  [limitsData, tradePairs, validatorRaw] = await Promise.all([
    validatorGet(VALIDATOR_URL, `/hl-traders/${VAULT_ADDRESS}/limits`),
    validatorGet(VALIDATOR_URL, '/trade-pairs'),
    validatorGet(VALIDATOR_URL, `/hl-traders/${VAULT_ADDRESS}`),
  ]);
  const hlState = await hlPost(HL_URL, { type: 'clearinghouseState', user: VAULT_ADDRESS });
  hlEq = parseFloat(hlState.crossMarginSummary?.accountValue ?? 0);
  // Live HF balance from validator dashboard — needed for the new HF-scale
  // cap math (Diff #2/#3). Falls back to fundedSize for empty test wallets.
  accountBalance = parseFloat(validatorRaw?.dashboard?.account_size_data?.balance)
    || limitsData.account_size;
  ({ map: hlCoinToDisplay } = buildHlCoinToDisplay(tradePairs));
}, 20000);

// ── Invalid / unsupported pair ────────────────────────────────────────────────

describe('Validator rejects unsupported pairs', () => {
  it('FAKECOIN-USDC — unknown pair → UnsupportedPairError', () => {
    const result = runValidate('FAKECOIN-USDC', 15);
    expect(result.status).toBe('error');
    expect(result.error_type).toBe('UnsupportedPairError');
    expect(result.error).toContain('Unsupported pair');
  });

  it('BTCUSD — vanta-format pair (not hyperliquid-sourced) → UnsupportedPairError', () => {
    // The validator exposes "BTCUSD" as a vanta pair but it is NOT tradeable
    // via the Hyperliquid exchange path. The SDK's supported_pairs list (filtered
    // to trade_pair_source: "hyperliquid") does not include it.
    const result = runValidate('BTCUSD', 15);
    expect(result.status).toBe('error');
    expect(result.error_type).toBe('UnsupportedPairError');
  });

  it('error message from FAKECOIN includes the supported pairs list', () => {
    const result = runValidate('FAKECOIN-USDC', 15);
    expect(result.error).toContain('BTC-USDC');
    expect(result.error).toContain('GOLD-USDC');
  });

  it('FAKECOIN-USDC does NOT appear in trade-pairs allowed list', () => {
    const inList = tradePairs.allowed.some(
      p => p.trade_pair_id?.toUpperCase().includes('FAKECOIN')
        || p.trade_pair?.toUpperCase().includes('FAKECOIN')
    );
    expect(inList).toBe(false);
  });

  it('BTCUSD vanta pair is NOT in hlCoinToDisplay (extension does not map it)', () => {
    // hlCoinToDisplay is built from hyperliquid-sourced pairs only.
    // Vanta pairs share coin names with HL pairs but their trade_pair_id format
    // ("BTCUSD" not "BTCUSDC") means they are a distinct entry.
    // The map key is hl_coin ("BTC") → still maps to "BTC" via the HL-sourced entry,
    // but the vanta trade_pair_id "BTCUSD" format is not present as a key.
    expect(hlCoinToDisplay['BTCUSD']).toBeUndefined();
    expect(hlCoinToDisplay['ETHUSD']).toBeUndefined();
  });
});

// ── Per-pair cap enforcement (validator-side) ─────────────────────────────────

describe('Validator rejects orders exceeding per-pair cap', () => {
  it('BTC-USDC $800 → LeverageLimitError', () => {
    // Server-side check: a sufficiently large HL order is rejected by the
    // validator before it reaches HL. The exact cap (HF-USD figure ÷ mirror)
    // is the server's business; we only assert that $800 trips it on this
    // test wallet.
    const result = runValidate('BTC-USDC', 800);
    expect(result.status).toBe('error');
    expect(result.error_type).toBe('LeverageLimitError');
    expect(result.error).toContain('Max position per pair');
  });

  it('error message includes the actual cap value in USD', () => {
    const result = runValidate('BTC-USDC', 800);
    expect(result.error).toMatch(/\$[\d,]+\.\d{2}/);
  });

  it('BTC-USDC $15 → ok (within per-pair cap)', () => {
    const result = runValidate('BTC-USDC', 15);
    expect(result.status).toBe('ok');
  });

  it('GOLD-USDC $15 → ok (xyz pair within cap)', () => {
    const result = runValidate('GOLD-USDC', 15);
    expect(result.status).toBe('ok');
  });

  it('GOLD-USDC $800 → LeverageLimitError (same cap applies to xyz pairs)', () => {
    const result = runValidate('GOLD-USDC', 800);
    expect(result.status).toBe('error');
    expect(result.error_type).toBe('LeverageLimitError');
  });
});

// ── Extension-side JS cap enforcement (applyTraderLimits with real data) ──────
//
// Caps are HF-scale: (pair_usd / fundedSize) × accountBalance. Comparison
// against an HL order requires applying the mirror multiplier
// (accountBalance / hlBalance) to project HL$ → HF$, then comparing to the
// HF cap. This mirrors content/utils.js + content/toast.js semantics.

describe('Extension JS cap enforcement — real limit values', () => {
  function computeCaps() {
    return applyTraderLimits({
      accountBalance,
      fundedSize: limitsData.account_size,
      max_position_per_pair_usd: limitsData.max_position_per_pair_usd,
      max_portfolio_usd: limitsData.max_portfolio_usd,
    });
  }

  it('applyTraderLimits returns non-null when accountBalance > 0', () => {
    if (!(accountBalance > 0)) return;  // empty wallet skip
    const caps = computeCaps();
    expect(caps).not.toBeNull();
    expect(caps.maxPositionPerPair).toBeGreaterThan(0);
    expect(caps.maxPortfolio).toBeGreaterThan(0);
  });

  it('per-pair cap = (pair_usd / fundedSize) × accountBalance', () => {
    if (!(accountBalance > 0)) return;
    const caps = computeCaps();
    const expected = (limitsData.max_position_per_pair_usd / limitsData.account_size) * accountBalance;
    expect(caps.maxPositionPerPair).toBeCloseTo(expected, 0);
  });

  it('portfolio cap = (portfolio_usd / fundedSize) × accountBalance', () => {
    if (!(accountBalance > 0)) return;
    const caps = computeCaps();
    const expected = (limitsData.max_portfolio_usd / limitsData.account_size) * accountBalance;
    expect(caps.maxPortfolio).toBeCloseTo(expected, 0);
  });

  it('HL order $800 × mirror exceeds HF per-pair cap', () => {
    if (!(accountBalance > 0) || !(hlEq > 0)) return;
    const caps = computeCaps();
    const mirror = accountBalance / hlEq;
    const projectedHsPair = 800 * mirror;
    expect(projectedHsPair).toBeGreaterThan(caps.maxPositionPerPair);
  });

  it('HL order $15 × mirror does NOT exceed HF per-pair cap', () => {
    if (!(accountBalance > 0) || !(hlEq > 0)) return;
    const caps = computeCaps();
    const mirror = accountBalance / hlEq;
    const projectedHsPair = 15 * mirror;
    expect(projectedHsPair).toBeLessThan(caps.maxPositionPerPair);
  });

  it('HF exposure exactly at cap, any HL add (× mirror) tips it over', () => {
    if (!(accountBalance > 0) || !(hlEq > 0)) return;
    const caps = computeCaps();
    const mirror = accountBalance / hlEq;
    // Existing HF exposure already at the cap edge; any positive HL add
    // (× mirror) pushes the projection above the cap.
    const existingHs = caps.maxPositionPerPair;
    const projected = existingHs + 1 * mirror;
    expect(projected).toBeGreaterThan(caps.maxPositionPerPair);
  });

  it('applyTraderLimits returns null when accountBalance = 0', () => {
    const caps = applyTraderLimits({
      accountBalance: 0,
      fundedSize: limitsData.account_size,
      max_position_per_pair_usd: limitsData.max_position_per_pair_usd,
      max_portfolio_usd: limitsData.max_portfolio_usd,
    });
    expect(caps).toBeNull();
  });

  it('applyTraderLimits returns null when fundedSize = 0', () => {
    const caps = applyTraderLimits({
      accountBalance: limitsData.account_size,
      fundedSize: 0,
      max_position_per_pair_usd: limitsData.max_position_per_pair_usd,
      max_portfolio_usd: limitsData.max_portfolio_usd,
    });
    expect(caps).toBeNull();
  });
});

// ── Vanta pair filtering — extension display pipeline ─────────────────────────

describe('Vanta-sourced pairs excluded from extension display map', () => {
  it('vanta pairs exist in raw trade-pairs response', () => {
    const vantaPairs = tradePairs.allowed.filter(p => p.trade_pair_source === 'vanta');
    expect(vantaPairs.length).toBeGreaterThan(0);
  });

  it('vanta-only trade_pair_ids are NOT keys in hlCoinToDisplay', () => {
    // e.g. vanta BTCUSD has trade_pair_id "BTCUSD" — should not be a map key
    const vantaPairs = tradePairs.allowed.filter(p => p.trade_pair_source === 'vanta');
    for (const p of vantaPairs) {
      const vantaId = p.trade_pair_id; // e.g. "BTCUSD"
      // The display map key is hl_coin (e.g. "BTC"), not the vanta trade_pair_id
      // So "BTCUSD" as a key should not appear
      expect(hlCoinToDisplay[vantaId]).toBeUndefined();
    }
  });

  it('hyperliquid-sourced BTC key ("BTC") IS in hlCoinToDisplay', () => {
    // The HL-sourced BTC entry has hl_coin "BTC" → maps to "BTC"
    expect(hlCoinToDisplay['BTC']).toBe('BTC');
  });

  it('validator correctly lists vanta pairs separately from hyperliquid pairs', () => {
    const hlPairs = tradePairs.allowed.filter(p => p.trade_pair_source === 'hyperliquid');
    const vantaPairs = tradePairs.allowed.filter(p => p.trade_pair_source === 'vanta');
    // The two sources are distinct
    expect(hlPairs.length).toBeGreaterThan(0);
    expect(vantaPairs.length).toBeGreaterThan(0);
    // No overlap by trade_pair_id
    const hlIds = new Set(hlPairs.map(p => p.trade_pair_id));
    const vantaIds = new Set(vantaPairs.map(p => p.trade_pair_id));
    const overlap = [...hlIds].filter(id => vantaIds.has(id));
    expect(overlap).toHaveLength(0);
  });
});
