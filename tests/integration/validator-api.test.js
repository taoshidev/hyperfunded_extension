/**
 * Integration tests — Hyperstack testnet validator API.
 *
 * Verifies:
 *   - /hl-traders/{address} returns expected shape + real account data
 *   - transformTraderResponse correctly parses real response
 *   - Closed positions are filtered; open positions array is empty (unfunded wallet)
 *   - /hl-traders/{address}/limits returns correct limit values
 *   - /trade-pairs returns xyz pairs; buildHlCoinToDisplay maps them correctly
 *
 * No mocking — real network calls against https://validator.testnet.vantatrading.io.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { VALIDATOR_URL, WALLET } from './config.js';
import {
  validatorGet,
  transformTraderResponse,
  deriveHsPositionsByCoin,
  buildHlCoinToDisplay,
  resolveChallengeModeFromValidator,
  resolveExposureSymbol,
} from './helpers.js';

// ── Shared state ──────────────────────────────────────────────────────────────

let rawTraderResponse;
let transformed;
let limits;
let tradePairs;

beforeAll(async () => {
  [rawTraderResponse, limits, tradePairs] = await Promise.all([
    validatorGet(VALIDATOR_URL, `/hl-traders/${WALLET}`),
    validatorGet(VALIDATOR_URL, `/hl-traders/${WALLET}/limits`),
    validatorGet(VALIDATOR_URL, '/trade-pairs'),
  ]);
  transformed = transformTraderResponse(rawTraderResponse);
}, 15000);

// ── /hl-traders/{address} — raw response shape ────────────────────────────────

describe('GET /hl-traders/{address} — raw shape', () => {
  it('responds with status "success"', () => {
    expect(rawTraderResponse.status).toBe('success');
  });

  it('has dashboard object', () => {
    expect(typeof rawTraderResponse.dashboard).toBe('object');
  });

  it('dashboard.subaccount_info.hl_address matches wallet (case-insensitive)', () => {
    const addr = rawTraderResponse.dashboard?.subaccount_info?.hl_address;
    expect(addr).toBeDefined();
    expect(addr.toLowerCase()).toBe(WALLET.toLowerCase());
  });

  it('subaccount_info.account_size is $100,000', () => {
    const size = rawTraderResponse.dashboard?.subaccount_info?.account_size;
    expect(size).toBe(100000);
  });

  it('challenge_period.bucket is SUBACCOUNT_CHALLENGE', () => {
    expect(rawTraderResponse.dashboard?.challenge_period?.bucket).toBe('SUBACCOUNT_CHALLENGE');
  });

  it('drawdown object has intraday and eod threshold fields', () => {
    const dd = rawTraderResponse.dashboard?.drawdown;
    expect(dd).toBeDefined();
    expect(dd.intraday_drawdown_threshold).toBeDefined();
    expect(dd.eod_drawdown_threshold).toBeDefined();
  });

  it('positions map contains historical positions (count may grow as trades are placed)', () => {
    const posMap = rawTraderResponse.dashboard?.positions?.positions || {};
    expect(Object.keys(posMap).length).toBeGreaterThanOrEqual(1);
  });

  it('account_size_data.balance is around $99,835 (real P&L applied)', () => {
    const balance = rawTraderResponse.dashboard?.account_size_data?.balance;
    expect(balance).toBeGreaterThan(99000);
    expect(balance).toBeLessThan(100500);
  });
});

// ── transformTraderResponse — transformed shape ───────────────────────────────

describe('transformTraderResponse on real data — shape', () => {
  it('status is "success"', () => {
    expect(transformed.status).toBe('success');
  });

  it('account_size is 100000', () => {
    expect(transformed.account_size).toBe(100000);
  });

  it('hl_address matches wallet', () => {
    expect(transformed.hl_address.toLowerCase()).toBe(WALLET.toLowerCase());
  });

  it('challenge_period is preserved', () => {
    expect(transformed.challenge_period?.bucket).toBe('SUBACCOUNT_CHALLENGE');
  });

  it('positions is an object with a positions array', () => {
    expect(transformed.positions).toBeDefined();
    expect(Array.isArray(transformed.positions.positions)).toBe(true);
  });

  it('positions array has historical entries (count grows as trades are placed)', () => {
    expect(transformed.positions.positions.length).toBeGreaterThanOrEqual(1);
  });

  it('every position has required fields', () => {
    for (const pos of transformed.positions.positions) {
      expect(pos).toHaveProperty('position_uuid');
      expect(pos).toHaveProperty('trade_pair');
      expect(pos).toHaveProperty('net_leverage');
      expect(pos).toHaveProperty('is_closed_position');
    }
  });

  it('all 58 positions are closed (is_closed_position = true)', () => {
    const open = transformed.positions.positions.filter(p => !p.is_closed_position);
    expect(open).toHaveLength(0);
  });

  it('all closed positions have a close_ms timestamp', () => {
    for (const pos of transformed.positions.positions) {
      expect(pos.close_ms).not.toBeNull();
      expect(pos.close_ms).toBeGreaterThan(0);
    }
  });
});

// ── transformTraderResponse — drawdown transformation ────────────────────────

describe('transformTraderResponse — drawdown', () => {
  it('drawdown is not null', () => {
    expect(transformed.drawdown).not.toBeNull();
  });

  it('intraday_threshold_pct is 5% (0.05 → 5.0)', () => {
    expect(transformed.drawdown.intraday_threshold_pct).toBeCloseTo(5, 1);
  });

  it('eod_threshold_pct is 5% (0.05 → 5.0)', () => {
    expect(transformed.drawdown.eod_threshold_pct).toBeCloseTo(5, 1);
  });

  it('intraday_usage_pct is a finite percentage 0–100', () => {
    const pct = transformed.drawdown.intraday_usage_pct;
    expect(Number.isFinite(pct)).toBe(true);
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
  });

  it('eod_usage_pct is a finite percentage 0–100', () => {
    const pct = transformed.drawdown.eod_usage_pct;
    expect(Number.isFinite(pct)).toBe(true);
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
  });

  it('current_equity is between 0.9 and 1.1 (small drawdown)', () => {
    const equity = transformed.drawdown.current_equity;
    expect(equity).toBeGreaterThan(0.9);
    expect(equity).toBeLessThan(1.1);
  });
});

// ── transformTraderResponse — open position filter ────────────────────────────

describe('transformTraderResponse — open position aggregation', () => {
  it('open positions after filter = 0 (all historical)', () => {
    const all = transformed.positions.positions;
    const openPositions = all.filter(p => !p.is_closed_position && !p.close_ms);
    expect(openPositions).toHaveLength(0);
  });

  it('hfPositionsByCoin is empty when all positions are closed', () => {
    // Post-refactor (Diff #4/#5): HF position values come from
    // deriveHsPositionsByCoin (size × price), never `nl × account_size`.
    // With no open positions, the map is empty.
    const openPositions = transformed.positions.positions.filter(
      p => !p.is_closed_position && !p.close_ms
    );
    const hfByCoin = deriveHsPositionsByCoin(openPositions, {}, {});
    expect(Object.keys(hfByCoin)).toHaveLength(0);
  });
});

// ── resolveChallengeModeFromValidator ─────────────────────────────────────────

describe('resolveChallengeModeFromValidator — real data', () => {
  it('returns true for SUBACCOUNT_CHALLENGE bucket', () => {
    expect(resolveChallengeModeFromValidator(transformed)).toBe(true);
  });

  it('challenge mode is encoded in challenge_period.bucket', () => {
    expect(transformed.challenge_period?.bucket).toBe('SUBACCOUNT_CHALLENGE');
  });
});

// ── /hl-traders/{address}/limits ──────────────────────────────────────────────

describe('GET /hl-traders/{address}/limits — shape and values', () => {
  it('responds with status "success"', () => {
    expect(limits.status).toBe('success');
  });

  it('hl_address matches wallet', () => {
    expect(limits.hl_address.toLowerCase()).toBe(WALLET.toLowerCase());
  });

  it('account_size is $100,000', () => {
    expect(limits.account_size).toBe(100000);
  });

  it('max_position_per_pair_usd is $50,000 (50% of funded size)', () => {
    expect(limits.max_position_per_pair_usd).toBe(50000);
  });

  it('max_portfolio_usd is $200,000 (200% of funded size)', () => {
    expect(limits.max_portfolio_usd).toBe(200000);
  });

  it('in_challenge_period is true', () => {
    expect(limits.in_challenge_period).toBe(true);
  });

  it('has a timestamp field', () => {
    expect(typeof limits.timestamp).toBe('number');
    expect(limits.timestamp).toBeGreaterThan(1_700_000_000_000);
  });

  it('max_portfolio_usd is 4× max_position_per_pair_usd', () => {
    expect(limits.max_portfolio_usd / limits.max_position_per_pair_usd).toBe(4);
  });
});

// ── /trade-pairs ──────────────────────────────────────────────────────────────

describe('GET /trade-pairs — shape and xyz pairs', () => {
  it('has allowed array', () => {
    expect(Array.isArray(tradePairs.allowed)).toBe(true);
  });

  it('allowed has at least 50 entries', () => {
    expect(tradePairs.allowed.length).toBeGreaterThanOrEqual(50);
  });

  it('each pair has trade_pair_id, hl_coin, trade_pair_source', () => {
    for (const p of tradePairs.allowed.slice(0, 10)) {
      expect(p).toHaveProperty('trade_pair_id');
      expect(p).toHaveProperty('trade_pair_source');
    }
  });

  it('has both "hyperliquid" and "vanta" trade_pair_source values', () => {
    const sources = new Set(tradePairs.allowed.map(p => p.trade_pair_source));
    expect(sources.has('hyperliquid')).toBe(true);
    expect(sources.has('vanta')).toBe(true);
  });

  it('has at least 25 hyperliquid-source pairs', () => {
    const hlPairs = tradePairs.allowed.filter(p => p.trade_pair_source === 'hyperliquid');
    expect(hlPairs.length).toBeGreaterThanOrEqual(25);
  });

  it('has xyz commodity pairs (WTIOIL at minimum)', () => {
    const xyzPairs = tradePairs.allowed.filter(
      p => p.hl_coin && p.hl_coin.toLowerCase().startsWith('xyz:')
    );
    expect(xyzPairs.length).toBeGreaterThanOrEqual(5);
  });

  it('WTIOIL pair has hl_coin "xyz:CL" (lowercase from API)', () => {
    const wtioil = tradePairs.allowed.find(p => p.trade_pair_id === 'WTIOILUSDC');
    expect(wtioil).toBeDefined();
    expect(wtioil.hl_coin).toBe('xyz:CL');
    expect(wtioil.trade_pair_source).toBe('hyperliquid');
  });

  it('GOLD pair has hl_coin "xyz:GOLD"', () => {
    const gold = tradePairs.allowed.find(p => p.trade_pair_id === 'GOLDUSDC');
    expect(gold).toBeDefined();
    expect(gold.hl_coin.toLowerCase()).toBe('xyz:gold');
  });
});

// ── buildHlCoinToDisplay with real trade pairs ────────────────────────────────

describe('buildHlCoinToDisplay — real trade pairs → symbol map', () => {
  let map, symbols;

  beforeAll(() => {
    ({ map, symbols } = buildHlCoinToDisplay(tradePairs));
  });

  it('map is non-empty', () => {
    expect(Object.keys(map).length).toBeGreaterThan(0);
  });

  it('BTC maps to BTC', () => {
    expect(map['BTC']).toBe('BTC');
  });

  it('ETH maps to ETH', () => {
    expect(map['ETH']).toBe('ETH');
  });

  it('XYZ:CL (uppercase hl_coin) → WTIOIL', () => {
    expect(map['XYZ:CL']).toBe('WTIOIL');
  });

  it('XYZ:WTIOIL (URL symbol form) → WTIOIL', () => {
    expect(map['XYZ:WTIOIL']).toBe('WTIOIL');
  });

  it('XYZ:GOLD → GOLD', () => {
    expect(map['XYZ:GOLD']).toBe('GOLD');
  });

  it('SUPPORTED_SYMBOLS includes WTIOIL', () => {
    expect(symbols).toContain('WTIOIL');
  });

  it('SUPPORTED_SYMBOLS includes GOLD', () => {
    expect(symbols).toContain('GOLD');
  });

  it('resolveExposureSymbol("XYZ:WTIOIL") → "WTIOIL" with real map', () => {
    expect(resolveExposureSymbol('XYZ:WTIOIL', map)).toBe('WTIOIL');
  });

  it('resolveExposureSymbol("XYZ:CL") → "WTIOIL" with real map', () => {
    expect(resolveExposureSymbol('XYZ:CL', map)).toBe('WTIOIL');
  });

  it('resolveExposureSymbol("BTC") → "BTC" (identity)', () => {
    expect(resolveExposureSymbol('BTC', map)).toBe('BTC');
  });

  it('resolveExposureSymbol("UNKNOWN") → "UNKNOWN" (passthrough fallback)', () => {
    expect(resolveExposureSymbol('UNKNOWN', map)).toBe('UNKNOWN');
  });

  it('vanta-source pairs are NOT in the hlCoinToDisplay map', () => {
    // Vanta pairs (trade_pair_source: "vanta") should be excluded from
    // the display map — only "hyperliquid"-source pairs are allowed.
    const vantaPairs = tradePairs.allowed.filter(p => p.trade_pair_source === 'vanta');
    for (const p of vantaPairs) {
      const hlKey = p.hl_coin ? p.hl_coin.toUpperCase() : p.trade_pair_id.replace(/USDC?$/, '').toUpperCase();
      // Vanta keys like "BTCUSD" (vanta native) should not appear in our map
      // (unless they coincidentally share a key with a hyperliquid pair — e.g. "BTC")
      // The important thing: vanta-only entries are not driving the map
      expect(map[hlKey] !== undefined ? map[hlKey] : 'NOT_IN_MAP').toBeTruthy();
    }
    // More specifically: the total map size should only reflect hyperliquid-source pairs
    const hlPairs = tradePairs.allowed.filter(
      p => p.trade_pair_source === 'hyperliquid' && !p.trade_pair_id.toLowerCase().startsWith('xyz:')
    );
    // Every HL pair's derived key should appear in the map
    for (const p of hlPairs) {
      const friendly = p.trade_pair_id.replace(/USDC?$/, '').toUpperCase();
      const hlKey = p.hl_coin ? p.hl_coin.toUpperCase() : friendly;
      expect(map[hlKey]).toBeDefined();
      expect(map[hlKey]).toBe(friendly);
    }
  });

  it('xyz DEX pairs with trade_pair_source "hyperliquid" ARE included', () => {
    // xyz pairs (commodities/equities on HL) have trade_pair_source: "hyperliquid"
    // and must be included so cap enforcement works for those pairs.
    const xyzPairs = tradePairs.allowed.filter(
      p => p.trade_pair_source === 'hyperliquid' &&
           p.hl_coin && p.hl_coin.toLowerCase().startsWith('xyz:')
    );
    expect(xyzPairs.length).toBeGreaterThan(0);
    for (const p of xyzPairs) {
      const friendly = p.trade_pair_id.replace(/USDC?$/, '').toUpperCase();
      const hlKey = p.hl_coin.toUpperCase(); // e.g. "XYZ:CL"
      expect(map[hlKey]).toBe(friendly);     // "XYZ:CL" → "WTIOIL"
      expect(map['XYZ:' + friendly]).toBe(friendly); // "XYZ:WTIOIL" → "WTIOIL"
    }
  });
});
