/**
 * Integration tests — full data pipeline.
 *
 * Exercises the complete flow that the extension executes on each poll cycle:
 *
 *   1. HL clearinghouseState → extractExposureFromAssetPositions
 *      → remapKeys (HL coin → display names via hlCoinToDisplay)
 *      → ACCOUNT.notionalByPair / signedNotionalByPair
 *
 *   2. Validator /hl-traders → transformTraderResponse
 *      → openPositions filter → notionalByPair keyed by coin display name
 *
 *   3. Trade pairs → buildHlCoinToDisplay (the bridge between both sources)
 *
 *   4. Limits → applyTraderLimits (HF-scale: pair_usd / fundedSize × accountBalance)
 *      → guard fires when accountBalance = 0 (balance not yet loaded)
 *
 * Asserts that both pipelines produce consistent state and that the
 * xyz pair symbol normalization bug (XYZ:CL vs XYZ:WTIOIL) is handled
 * correctly end-to-end with real production data.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { VALIDATOR_URL, HL_URL, WALLET } from './config.js';
import {
  hlPost,
  validatorGet,
  extractExposureFromAssetPositions,
  transformTraderResponse,
  deriveHsPositionsByCoin,
  buildHlCoinToDisplay,
  applyTraderLimits,
  remapKeys,
  resolveExposureSymbol,
  resolveChallengeModeFromValidator,
} from './helpers.js';

// ── Fetch all data once ───────────────────────────────────────────────────────

let perpsData;
let validatorRaw;
let transformed;
let limits;
let tradePairs;
let hlCoinToDisplay;

beforeAll(async () => {
  [perpsData, validatorRaw, limits, tradePairs] = await Promise.all([
    hlPost(HL_URL, { type: 'clearinghouseState', user: WALLET }),
    validatorGet(VALIDATOR_URL, `/hl-traders/${WALLET}`),
    validatorGet(VALIDATOR_URL, `/hl-traders/${WALLET}/limits`),
    validatorGet(VALIDATOR_URL, '/trade-pairs'),
  ]);

  transformed = transformTraderResponse(validatorRaw);
  ({ map: hlCoinToDisplay } = buildHlCoinToDisplay(tradePairs));
}, 15000);

// ── HL pipeline: extraction + remap ──────────────────────────────────────────

describe('HL data pipeline (extraction → remap)', () => {
  let rawExposure;
  let mappedNotional;
  let mappedSigned;

  beforeAll(() => {
    rawExposure = extractExposureFromAssetPositions(perpsData);
    mappedNotional = remapKeys(rawExposure.notionalByPair, hlCoinToDisplay);
    mappedSigned = remapKeys(rawExposure.signedNotionalByPair, hlCoinToDisplay);
  });

  it('raw extraction returns valid object', () => {
    expect(rawExposure).toHaveProperty('notionalByPair');
    expect(rawExposure).toHaveProperty('signedNotionalByPair');
    expect(rawExposure).toHaveProperty('openTotalUsed');
  });

  it('HL account is empty — openTotalUsed = 0', () => {
    expect(rawExposure.openTotalUsed).toBe(0);
  });

  it('mappedNotional is empty (no HL positions to remap)', () => {
    expect(Object.keys(mappedNotional)).toHaveLength(0);
  });

  it('mappedSigned is empty', () => {
    expect(Object.keys(mappedSigned)).toHaveLength(0);
  });

  it('remap does not throw on empty input', () => {
    expect(() => remapKeys({}, hlCoinToDisplay)).not.toThrow();
    expect(() => remapKeys(null, hlCoinToDisplay)).not.toThrow();
  });

  it('remap correctly maps XYZ:CL → WTIOIL if present (synthetic check)', () => {
    const synthetic = { 'XYZ:CL': 700 };
    const result = remapKeys(synthetic, hlCoinToDisplay);
    expect(result['WTIOIL']).toBe(700);
    expect(result['XYZ:CL']).toBeUndefined();
  });

  it('remap preserves BTC key unchanged', () => {
    const synthetic = { 'BTC': 1000 };
    const result = remapKeys(synthetic, hlCoinToDisplay);
    expect(result['BTC']).toBe(1000);
  });
});

// ── Validator pipeline ────────────────────────────────────────────────────────

describe('Validator data pipeline', () => {
  it('account is in challenge mode', () => {
    expect(resolveChallengeModeFromValidator(transformed)).toBe(true);
  });

  it('fundedSize = $100,000 from transformed response', () => {
    expect(transformed.account_size).toBe(100000);
  });

  it('all validator positions are closed — no open exposure', () => {
    const openPos = transformed.positions.positions.filter(
      p => !p.is_closed_position && !p.close_ms
    );
    expect(openPos).toHaveLength(0);
  });

  it('validator hfPositionsByCoin is empty (all positions closed)', () => {
    // Post-refactor: HF positions derive strictly as size × price (sum of
    // signed `q` × HL mid). With no open positions, the map is empty —
    // no `nl × account_size` fallback that would produce phantom values.
    const openPositions = transformed.positions.positions.filter(
      p => !p.is_closed_position && !p.close_ms
    );
    const hfByCoin = deriveHsPositionsByCoin(openPositions, {}, {});
    expect(Object.keys(hfByCoin)).toHaveLength(0);
  });

  it('both pipelines agree: 0 open exposure (empty state consistent)', () => {
    const rawExposure = extractExposureFromAssetPositions(perpsData);
    const openPositions = transformed.positions.positions.filter(
      p => !p.is_closed_position && !p.close_ms
    );
    // Both sources agree on zero open exposure
    expect(rawExposure.openPositionCount).toBe(0);
    expect(openPositions).toHaveLength(0);
  });
});

// ── Limits pipeline ───────────────────────────────────────────────────────────

describe('Limits pipeline — applyTraderLimits with real limit values (HF-scale)', () => {
  // Caps are HF-side now: (pair_usd / fundedSize) × accountBalance.
  // Tests covering PnL-driven balance changes live in tests/unit/limits.test.js;
  // here we exercise the helper against real validator values.
  const FUNDED_SIZE = 100000;
  const MAX_PAIR = 50000;
  const MAX_PORTFOLIO = 200000;

  it('guard fires when accountBalance = 0 (no balance loaded)', () => {
    const result = applyTraderLimits({
      accountBalance: 0,
      fundedSize: FUNDED_SIZE,
      max_position_per_pair_usd: MAX_PAIR,
      max_portfolio_usd: MAX_PORTFOLIO,
    });
    expect(result).toBeNull();
  });

  it('flat PnL (balance = fundedSize): caps equal validator USD figures', () => {
    const result = applyTraderLimits({
      accountBalance: FUNDED_SIZE,
      fundedSize: FUNDED_SIZE,
      max_position_per_pair_usd: MAX_PAIR,
      max_portfolio_usd: MAX_PORTFOLIO,
    });
    expect(result).not.toBeNull();
    expect(result.maxPositionPerPair).toBe(MAX_PAIR);
    expect(result.maxPortfolio).toBe(MAX_PORTFOLIO);
  });

  it('drawdown to $9k on $10k funded → caps shrink by 10%', () => {
    const result = applyTraderLimits({
      accountBalance: 9000,
      fundedSize: 10000,
      max_position_per_pair_usd: 5000,
      max_portfolio_usd: 20000,
    });
    expect(result.maxPositionPerPair).toBe(4500);
    expect(result.maxPortfolio).toBe(18000);
  });

  it('per-pair cap always equals fixed fraction × accountBalance', () => {
    // max_position_per_pair_usd / account_size = 50000/100000 = 50%
    const balance = 80000;  // simulate 20% drawdown
    const result = applyTraderLimits({
      accountBalance: balance,
      fundedSize: FUNDED_SIZE,
      max_position_per_pair_usd: MAX_PAIR,
      max_portfolio_usd: MAX_PORTFOLIO,
    });
    expect(result.maxPositionPerPair).toBeCloseTo(balance * 0.5, 1);
  });

  it('portfolio cap always equals fixed fraction × accountBalance', () => {
    // max_portfolio_usd / account_size = 200000/100000 = 200%
    const balance = 80000;
    const result = applyTraderLimits({
      accountBalance: balance,
      fundedSize: FUNDED_SIZE,
      max_position_per_pair_usd: MAX_PAIR,
      max_portfolio_usd: MAX_PORTFOLIO,
    });
    expect(result.maxPortfolio).toBeCloseTo(balance * 2.0, 1);
  });

  it('uses real limits values from /hl-traders/{address}/limits endpoint', () => {
    // Use account_size as both fundedSize and accountBalance (no PnL applied
    // here). The unit-test suite covers the balance-≠-funded case.
    const result = applyTraderLimits({
      accountBalance: limits.account_size,
      fundedSize: limits.account_size,
      max_position_per_pair_usd: limits.max_position_per_pair_usd,
      max_portfolio_usd: limits.max_portfolio_usd,
    });
    expect(result).not.toBeNull();
    expect(result.maxPositionPerPair).toBe(limits.max_position_per_pair_usd);
    expect(result.maxPortfolio).toBe(limits.max_portfolio_usd);
  });
});

// ── Symbol resolution pipeline (hlCoinToDisplay with real data) ────────────────

describe('Symbol resolution pipeline — real hlCoinToDisplay map', () => {
  it('XYZ:WTIOIL (URL symbol) resolves to WTIOIL', () => {
    expect(resolveExposureSymbol('XYZ:WTIOIL', hlCoinToDisplay)).toBe('WTIOIL');
  });

  it('XYZ:CL (HL coin key) resolves to WTIOIL', () => {
    expect(resolveExposureSymbol('XYZ:CL', hlCoinToDisplay)).toBe('WTIOIL');
  });

  it('XYZ:GOLD resolves to GOLD', () => {
    expect(resolveExposureSymbol('XYZ:GOLD', hlCoinToDisplay)).toBe('GOLD');
  });

  it('BTC resolves to BTC (identity)', () => {
    expect(resolveExposureSymbol('BTC', hlCoinToDisplay)).toBe('BTC');
  });

  it('remap of XYZ:CL key to WTIOIL matches resolveExposureSymbol result', () => {
    // Both paths — checkBalance (remap at storage) and trade-gate (lookup) —
    // produce the same canonical key for WTIOIL exposure.
    const remapResult = remapKeys({ 'XYZ:CL': 500 }, hlCoinToDisplay);
    const resolveResult = resolveExposureSymbol('XYZ:WTIOIL', hlCoinToDisplay);
    expect(Object.keys(remapResult)[0]).toBe(resolveResult);
  });

  it('bug scenario: without remap, XYZ:CL key is not found via XYZ:WTIOIL lookup', () => {
    // This was the original bug: HL stored as XYZ:CL, cap lookup used XYZ:WTIOIL
    const notionalByPair = { 'XYZ:CL': 500 };  // pre-fix: wrong key
    const lookupKey = resolveExposureSymbol('XYZ:WTIOIL', hlCoinToDisplay);  // → WTIOIL
    const buggedLookup = notionalByPair[lookupKey];  // undefined!
    expect(buggedLookup).toBeUndefined();

    // After fix: both map to WTIOIL
    const fixedByPair = remapKeys(notionalByPair, hlCoinToDisplay);  // XYZ:CL → WTIOIL
    const fixedLookup = fixedByPair[lookupKey];  // WTIOIL → 500
    expect(fixedLookup).toBe(500);
  });
});

// ── End-to-end pipeline consistency ──────────────────────────────────────────

describe('End-to-end pipeline consistency', () => {
  it('HL equity is 0 and validator shows no open positions — consistent empty state', () => {
    const hlEquity = parseFloat(perpsData.crossMarginSummary.accountValue);
    const openPositions = transformed.positions.positions.filter(
      p => !p.is_closed_position && !p.close_ms
    );
    expect(hlEquity).toBe(0);
    expect(openPositions).toHaveLength(0);
  });

  it('hlCoinToDisplay enables both HL and validator sources to use same WTIOIL key', () => {
    // HL stores exposure as XYZ:CL → remapKeys → WTIOIL
    // Validator stores exposure as WTIOIL directly (from trade_pair "WTIOIL/USDC")
    // Both should now use "WTIOIL" as the canonical cap-enforcement key
    const simulatedHlExposure = remapKeys({ 'XYZ:CL': 300, 'BTC': 600 }, hlCoinToDisplay);
    const simulatedValidatorExposure = { 'WTIOIL': 300, 'BTC': 600 };

    expect(simulatedHlExposure['WTIOIL']).toBe(simulatedValidatorExposure['WTIOIL']);
    expect(simulatedHlExposure['BTC']).toBe(simulatedValidatorExposure['BTC']);
  });

  it('challenge mode correctly detected from real validator data', () => {
    const inChallenge = resolveChallengeModeFromValidator(transformed);
    expect(inChallenge).toBe(true);
  });

  it('account_size_data.balance reflects real P&L from trading history', () => {
    const { balance, account_size, total_realized_pnl } = transformed.account_size_data;
    // balance ≈ account_size + total_realized_pnl - fees
    expect(balance).toBeGreaterThan(0);
    expect(balance).toBeLessThan(account_size);
    expect(total_realized_pnl).toBeLessThan(0); // small net loss from history
  });
});
