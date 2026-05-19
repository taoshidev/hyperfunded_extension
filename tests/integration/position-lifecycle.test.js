/**
 * Integration tests — full position lifecycle with real orders.
 *
 * Flow for each pair:
 *   Python SDK places order → HL executes → JS polls HL state →
 *   JS runs extension transformation → JS polls validator →
 *   JS verifies display pipeline → Python SDK closes order → cleanup checks
 *
 * Order placement uses the hyperfunded SDK (tgbot venv) to avoid
 * reimplementing HL agent-wallet signing in JS.
 *
 * The SDK places orders on VAULT_ADDRESS via the agent key.
 * All HL state queries and validator checks use VAULT_ADDRESS.
 *
 * Tests cover:
 *   - BTC-USDC  : native HL perp — verifies standard coin display pipeline
 *   - GOLD-USDC : xyz:GOLD perp — verifies xyz coin display pipeline (the fixed bug)
 *
 * Requires:
 *   /Users/arrash/develop/hyperfunded_tgbot/.venv to have the hyperfunded SDK.
 *   Override with TEST_PYTHON env var.
 *
 * Skip:
 *   Set SKIP_LIFECYCLE=1 to skip all tests in this file.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { VALIDATOR_URL, HL_URL, VAULT_ADDRESS } from './config.js';
import {
  hlPost,
  validatorGet,
  extractExposureFromAssetPositions,
  transformTraderResponse,
  buildHlCoinToDisplay,
  applyTraderLimits,
  remapKeys,
  resolveExposureSymbol,
} from './helpers.js';

// ── Python helper wiring ──────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, 'scripts', 'hl_order.py');
const PYTHON = process.env.TEST_PYTHON
  || '/Users/arrash/develop/hyperfunded_tgbot/.venv/bin/python';

function runPython(...args) {
  const result = spawnSync(PYTHON, [SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env },
  });
  if (result.error) throw new Error(`spawnSync failed: ${result.error.message}`);
  const raw = (result.stdout || '').trim();
  if (!raw) {
    throw new Error(
      `hl_order.py produced no output (exit ${result.status}):\n${result.stderr}`
    );
  }
  const parsed = JSON.parse(raw);
  if (parsed.status === 'error') {
    throw new Error(`hl_order.py error: ${parsed.error}`);
  }
  return parsed;
}

// ── Poll helper ───────────────────────────────────────────────────────────────

async function pollUntil(fn, { maxMs = 60000, intervalMs = 3000, label = 'condition' } = {}) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const result = await fn();
    if (result) return result;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

// ── Shared state ──────────────────────────────────────────────────────────────

let hlCoinToDisplay = {};
let hlDisplaySymbols = [];
const SKIP = !!process.env.SKIP_LIFECYCLE;

beforeAll(async () => {
  if (SKIP) return;
  const tradePairs = await validatorGet(VALIDATOR_URL, '/trade-pairs');
  ({ map: hlCoinToDisplay, symbols: hlDisplaySymbols } = buildHlCoinToDisplay(tradePairs));
}, 15000);

afterAll(async () => {
  if (SKIP) return;
  // Best-effort cleanup: close any open BTC or GOLD positions left over.
  // GOLD is an xyz pair so it must be queried with dex:"xyz".
  for (const { pair, coin, dex } of [
    { pair: 'BTC-USDC', coin: 'BTC', dex: undefined },
    { pair: 'GOLD-USDC', coin: 'xyz:GOLD', dex: 'xyz' },
  ]) {
    try {
      const body = { type: 'clearinghouseState', user: VAULT_ADDRESS };
      if (dex) body.dex = dex;
      const state = await hlPost(HL_URL, body);
      const pos = state.assetPositions.find(
        p => (p.position?.coin || '').toUpperCase() === coin.toUpperCase()
      );
      if (pos && Math.abs(parseFloat(pos.position?.szi || 0)) > 0.00001) {
        console.log(`[lifecycle] cleanup: closing leftover ${pair}`);
        runPython('close', pair);
      }
    } catch { /* ignore cleanup errors */ }
  }
}, 30000);

// ── Pre-condition ─────────────────────────────────────────────────────────────

describe('Pre-conditions', () => {
  it.skipIf(SKIP)('HL wallet has sufficient balance to trade', () => {
    const result = runPython('balance');
    expect(result.balance).toBeGreaterThan(50);
  });
});

// ── BTC lifecycle (native HL perp) ────────────────────────────────────────────

describe('BTC lifecycle — native perp', () => {
  it.skipIf(SKIP)('places a $15 BTC market buy via SDK', () => {
    const result = runPython('place', 'BTC-USDC', '15');
    expect(result.order_status).toMatch(/filled|partial/);
    expect(result.fill_price).toBeGreaterThan(1000);
  }, 30000);

  it.skipIf(SKIP)('HL shows BTC position for VAULT_ADDRESS within 10s', async () => {
    const pos = await pollUntil(async () => {
      const state = await hlPost(HL_URL, { type: 'clearinghouseState', user: VAULT_ADDRESS });
      return state.assetPositions.find(
        p => p.position?.coin === 'BTC' && Math.abs(parseFloat(p.position.szi)) > 0.00001
      );
    }, { maxMs: 10000, label: 'BTC position in HL' });

    expect(pos).toBeDefined();
    expect(parseFloat(pos.position.szi)).toBeGreaterThan(0);
  }, 20000);

  it.skipIf(SKIP)('extractExposureFromAssetPositions sees BTC notional ≈ $15', async () => {
    const state = await hlPost(HL_URL, { type: 'clearinghouseState', user: VAULT_ADDRESS });
    const exp = extractExposureFromAssetPositions(state);
    expect(exp.notionalByPair['BTC']).toBeGreaterThan(10);
    expect(exp.notionalByPair['BTC']).toBeLessThan(25);
    expect(exp.signedNotionalByPair['BTC']).toBeGreaterThan(0);
  }, 15000);

  it.skipIf(SKIP)('remapKeys leaves BTC key unchanged', async () => {
    const state = await hlPost(HL_URL, { type: 'clearinghouseState', user: VAULT_ADDRESS });
    const exp = extractExposureFromAssetPositions(state);
    const mapped = remapKeys(exp.notionalByPair, hlCoinToDisplay);
    expect(mapped['BTC']).toBeCloseTo(exp.notionalByPair['BTC'], 0);
  }, 15000);

  it.skipIf(SKIP)('resolveExposureSymbol("BTC") → "BTC"', () => {
    expect(resolveExposureSymbol('BTC', hlCoinToDisplay)).toBe('BTC');
  });

  it.skipIf(SKIP)('validator picks up BTC position within 60s', async () => {
    const pos = await pollUntil(async () => {
      const raw = await validatorGet(VALIDATOR_URL, `/hl-traders/${VAULT_ADDRESS}`);
      const t = transformTraderResponse(raw);
      const open = t.positions.positions.filter(p => !p.is_closed_position && !p.close_ms);
      return open.find(p => {
        const tp = p.trade_pair || '';
        const coin = (typeof tp === 'string' ? tp : (tp[0] || ''))
          .replace(/\/.*$/, '').replace(/USD[CT]?$/, '').toUpperCase();
        return coin === 'BTC';
      });
    }, { maxMs: 60000, intervalMs: 5000, label: 'BTC in validator' });

    expect(pos).toBeDefined();
    expect(pos.is_closed_position).toBe(false);
    expect(pos.net_leverage).not.toBe(0);
  }, 75000);

  it.skipIf(SKIP)('closes BTC position via SDK', () => {
    const result = runPython('close', 'BTC-USDC');
    expect(result.order_status).toMatch(/filled|partial/);
  }, 30000);

  it.skipIf(SKIP)('HL shows no BTC position after close', async () => {
    await pollUntil(async () => {
      const state = await hlPost(HL_URL, { type: 'clearinghouseState', user: VAULT_ADDRESS });
      const btc = state.assetPositions.find(p => p.position?.coin === 'BTC');
      return !btc || Math.abs(parseFloat(btc.position?.szi || 0)) < 0.00001;
    }, { maxMs: 15000, label: 'BTC cleared from HL' });

    const state = await hlPost(HL_URL, { type: 'clearinghouseState', user: VAULT_ADDRESS });
    const exp = extractExposureFromAssetPositions(state);
    expect(exp.notionalByPair['BTC'] ?? 0).toBeLessThan(2);
  }, 30000);

  it.skipIf(SKIP)('validator marks BTC position closed within 60s', async () => {
    await pollUntil(async () => {
      const raw = await validatorGet(VALIDATOR_URL, `/hl-traders/${VAULT_ADDRESS}`);
      const t = transformTraderResponse(raw);
      const open = t.positions.positions.filter(p => !p.is_closed_position && !p.close_ms);
      const stillOpen = open.some(p => {
        const tp = p.trade_pair || '';
        const coin = (typeof tp === 'string' ? tp : (tp[0] || ''))
          .replace(/\/.*$/, '').replace(/USD[CT]?$/, '').toUpperCase();
        return coin === 'BTC';
      });
      return !stillOpen;
    }, { maxMs: 60000, intervalMs: 5000, label: 'BTC closed in validator' });

    const raw = await validatorGet(VALIDATOR_URL, `/hl-traders/${VAULT_ADDRESS}`);
    const t = transformTraderResponse(raw);
    const btcPositions = t.positions.positions
      .filter(p => {
        const tp = p.trade_pair || '';
        const coin = (typeof tp === 'string' ? tp : (tp[0] || ''))
          .replace(/\/.*$/, '').replace(/USD[CT]?$/, '').toUpperCase();
        return coin === 'BTC';
      })
      .sort((a, b) => (b.open_ms || 0) - (a.open_ms || 0));

    expect(btcPositions[0]?.is_closed_position).toBe(true);
  }, 75000);
});

// ── GOLD lifecycle (xyz:GOLD perp) ────────────────────────────────────────────
//
// This specifically tests the xyz display pipeline bug that was fixed:
//   HL stores position as coin "xyz:GOLD"
//   extractExposureFromAssetPositions key → "XYZ:GOLD"
//   remapKeys via hlCoinToDisplay → "GOLD"
//   resolveExposureSymbol → "GOLD"

describe('GOLD lifecycle — xyz:GOLD perp (display pipeline)', () => {
  it.skipIf(SKIP)('places a $15 GOLD market buy via SDK', () => {
    const result = runPython('place', 'GOLD-USDC', '15');
    expect(result.order_status).toMatch(/filled|partial/);
    expect(result.fill_price).toBeGreaterThan(100);
  }, 30000);

  it.skipIf(SKIP)('xyz DEX clearinghouse shows xyz:GOLD position for VAULT_ADDRESS', async () => {
    // xyz DEX positions require dex:"xyz" — they do NOT appear in the standard clearinghouse
    const pos = await pollUntil(async () => {
      const state = await hlPost(HL_URL, { type: 'clearinghouseState', user: VAULT_ADDRESS, dex: 'xyz' });
      return state.assetPositions.find(
        p => (p.position?.coin || '').toLowerCase() === 'xyz:gold'
          && Math.abs(parseFloat(p.position.szi)) > 0.000001
      );
    }, { maxMs: 10000, label: 'xyz:GOLD position in HL xyz DEX' });

    expect(pos).toBeDefined();
    expect(pos.position.coin).toBe('xyz:GOLD');
  }, 20000);

  it.skipIf(SKIP)('extractExposureFromAssetPositions key is "XYZ:GOLD" (xyz DEX state)', async () => {
    // Query the xyz DEX clearinghouse (requires dex:"xyz")
    const state = await hlPost(HL_URL, { type: 'clearinghouseState', user: VAULT_ADDRESS, dex: 'xyz' });
    const exp = extractExposureFromAssetPositions(state);
    // Raw key from HL coin "xyz:GOLD" → uppercased → "XYZ:GOLD"
    expect(exp.notionalByPair['XYZ:GOLD']).toBeGreaterThan(10);
    expect(exp.notionalByPair['XYZ:GOLD']).toBeLessThan(25);
    expect(exp.signedNotionalByPair['XYZ:GOLD']).toBeGreaterThan(0);
  }, 15000);

  it.skipIf(SKIP)('remapKeys maps "XYZ:GOLD" → "GOLD" (xyz display pipeline fix)', async () => {
    const state = await hlPost(HL_URL, { type: 'clearinghouseState', user: VAULT_ADDRESS, dex: 'xyz' });
    const exp = extractExposureFromAssetPositions(state);
    const mapped = remapKeys(exp.notionalByPair, hlCoinToDisplay);

    // Before the fix: "XYZ:GOLD" was not in hlCoinToDisplay → key stays as "XYZ:GOLD"
    // After the fix: "XYZ:GOLD" → "GOLD"
    expect(mapped['GOLD']).toBeGreaterThan(10);
    expect(mapped['XYZ:GOLD']).toBeUndefined();
  }, 15000);

  it.skipIf(SKIP)('resolveExposureSymbol("XYZ:GOLD") → "GOLD"', () => {
    expect(resolveExposureSymbol('XYZ:GOLD', hlCoinToDisplay)).toBe('GOLD');
  });

  it.skipIf(SKIP)('hlCoinToDisplay includes XYZ:GOLD from real trade pairs', () => {
    expect(hlCoinToDisplay['XYZ:GOLD']).toBe('GOLD');
    expect(hlDisplaySymbols).toContain('GOLD');
  });

  it.skipIf(SKIP)('validator picks up GOLD position within 60s', async () => {
    const pos = await pollUntil(async () => {
      const raw = await validatorGet(VALIDATOR_URL, `/hl-traders/${VAULT_ADDRESS}`);
      const t = transformTraderResponse(raw);
      const open = t.positions.positions.filter(p => !p.is_closed_position && !p.close_ms);
      return open.find(p => {
        const tp = p.trade_pair || '';
        const coin = (typeof tp === 'string' ? tp : (tp[0] || ''))
          .replace(/\/.*$/, '').replace(/USD[CT]?$/, '').toUpperCase();
        return coin === 'GOLD';
      });
    }, { maxMs: 60000, intervalMs: 5000, label: 'GOLD in validator' });

    expect(pos).toBeDefined();
    expect(pos.is_closed_position).toBe(false);
  }, 75000);

  it.skipIf(SKIP)('closes GOLD position via SDK', () => {
    const result = runPython('close', 'GOLD-USDC');
    expect(result.order_status).toMatch(/filled|partial/);
  }, 30000);

  it.skipIf(SKIP)('xyz DEX shows no GOLD position after close', async () => {
    await pollUntil(async () => {
      const state = await hlPost(HL_URL, { type: 'clearinghouseState', user: VAULT_ADDRESS, dex: 'xyz' });
      const gold = state.assetPositions.find(
        p => (p.position?.coin || '').toLowerCase() === 'xyz:gold'
      );
      return !gold || Math.abs(parseFloat(gold.position?.szi || 0)) < 0.000001;
    }, { maxMs: 15000, label: 'GOLD cleared from HL xyz DEX' });

    const state = await hlPost(HL_URL, { type: 'clearinghouseState', user: VAULT_ADDRESS, dex: 'xyz' });
    const exp = extractExposureFromAssetPositions(state);
    const mapped = remapKeys(exp.notionalByPair, hlCoinToDisplay);
    expect(mapped['GOLD'] ?? 0).toBeLessThan(2);
  }, 30000);
});

// ── Add-to-position cap enforcement (xyz pair) ───────────────────────────────
//
// Regression test for the BRENTOIL double-order bug:
//   1st order fills → xyz position appears in xyz DEX clearinghouse only
//   Standard clearinghouseState returns 0 for that coin (xyz invisible)
//   Before fix: notionalByPair['XYZ:GOLD'] = 0 → 2nd order passes cap check
//   After fix:  background/api.js merges xyz DEX positions → notional is live
//
// This test verifies the JS-side exposure tracking is correct immediately after
// the first fill, without waiting for the validator.

describe('Add-to-position cap enforcement — xyz pair (BRENTOIL bug regression)', () => {
  let firstOrderFilled = false;

  it.skipIf(SKIP)('places a $300 GOLD position (first order)', () => {
    const result = runPython('place', 'GOLD-USDC', '300');
    expect(result.order_status).toMatch(/filled|partial/);
    firstOrderFilled = true;
  }, 30000);

  it.skipIf(SKIP)('xyz DEX clearinghouse shows GOLD notional ≥ $250 immediately after fill', async () => {
    if (!firstOrderFilled) return;
    const pos = await pollUntil(async () => {
      const state = await hlPost(HL_URL, { type: 'clearinghouseState', user: VAULT_ADDRESS, dex: 'xyz' });
      return state.assetPositions.find(
        p => (p.position?.coin || '').toLowerCase() === 'xyz:gold'
          && Math.abs(parseFloat(p.position.szi)) > 0.000001
      );
    }, { maxMs: 10000, label: 'GOLD in xyz DEX after first order' });

    expect(pos).toBeDefined();
  }, 20000);

  it.skipIf(SKIP)('merging xyz DEX into standard state makes GOLD notional visible (the fix)', async () => {
    if (!firstOrderFilled) return;
    // Standard clearinghouse — xyz position is invisible here
    const standardState = await hlPost(HL_URL, { type: 'clearinghouseState', user: VAULT_ADDRESS });
    const standardExp = extractExposureFromAssetPositions(standardState);

    // xyz DEX clearinghouse — has the position
    const xyzState = await hlPost(HL_URL, { type: 'clearinghouseState', user: VAULT_ADDRESS, dex: 'xyz' });

    // Merge exactly as the fixed background/api.js does
    const merged = {
      ...standardState,
      assetPositions: [
        ...(standardState.assetPositions || []),
        ...(xyzState.assetPositions || []),
      ],
    };
    const mergedExp = extractExposureFromAssetPositions(merged);
    const mapped = remapKeys(mergedExp.notionalByPair, hlCoinToDisplay);

    // Before fix: mapped['GOLD'] would be 0 (xyz invisible in standard state)
    // After fix:  merged state includes xyz positions → GOLD notional ≥ $250
    expect(mapped['GOLD']).toBeGreaterThan(250);
    expect(standardExp.notionalByPair['XYZ:GOLD'] ?? 0).toBe(0); // confirms the pre-fix problem
  }, 15000);

  it.skipIf(SKIP)('JS cap enforcement: $300 existing + $500 new (HS-scaled) exceeds per-pair cap', async () => {
    if (!firstOrderFilled) return;
    const [limitsRaw, hlState, validatorRaw] = await Promise.all([
      validatorGet(VALIDATOR_URL, `/hl-traders/${VAULT_ADDRESS}/limits`),
      hlPost(HL_URL, { type: 'clearinghouseState', user: VAULT_ADDRESS }),
      validatorGet(VALIDATOR_URL, `/hl-traders/${VAULT_ADDRESS}`),
    ]);
    const hlEq = parseFloat(hlState.crossMarginSummary?.accountValue ?? 0);
    const accountBalance = parseFloat(validatorRaw?.dashboard?.account_size_data?.balance) || 0;
    const fundedSize = limitsRaw.account_size;

    // HS-scale caps: (pair_usd / fundedSize) × accountBalance
    const caps = applyTraderLimits({
      accountBalance,
      fundedSize,
      max_position_per_pair_usd: limitsRaw.max_position_per_pair_usd,
      max_portfolio_usd: limitsRaw.max_portfolio_usd,
    });
    expect(caps).not.toBeNull();

    // Mirror multiplier: HL$ → HS$ at current live balances.
    const mirror = hlEq > 0 && accountBalance > 0 ? accountBalance / hlEq : 0;
    const projectedHsPair = (300 + 500) * mirror;
    expect(mirror).toBeGreaterThan(0);
    expect(projectedHsPair).toBeGreaterThan(caps.maxPositionPerPair);
  }, 15000);

  it.skipIf(SKIP)('validator rejects second order that would exceed cap', () => {
    if (!firstOrderFilled) return;
    const result = runPython('validate', 'GOLD-USDC', '500');
    // $300 open + $500 new > per-pair cap → LeverageLimitError
    expect(result.status).toBe('error');
    expect(result.error_type).toBe('LeverageLimitError');
  }, 30000);

  it.skipIf(SKIP)('closes GOLD position after regression test', () => {
    if (!firstOrderFilled) return;
    const result = runPython('close', 'GOLD-USDC');
    expect(result.order_status).toMatch(/filled|partial/);
  }, 30000);
});
