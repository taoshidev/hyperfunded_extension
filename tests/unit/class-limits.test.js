/**
 * Tests for three-layer cap logic (per-pair / per-class / overall portfolio).
 *
 * Mirrors content/api.js fetchTraderLimits (tier + max_asset_class_usd parsing),
 * content/utils.js (effectiveMaxSingleUsd per-pair tier lookup, effectiveMaxClassUsd,
 * classExposureUsd) and the mirror-preview class clamp.
 */

import { describe, it, expect } from 'vitest';

// ─── Inline from content/api.js fetchTraderLimits ────────────────────────────

function applyClassLimits({ accountBalance, fundedSize, tier, in_challenge_period, max_asset_class_usd }) {
  if (!(accountBalance > 0)) return null;
  if (!(fundedSize > 0)) return null;
  // Challenge accounts are tier 1 by definition; funded tiers are not derived
  const parsedTier = Number.isInteger(tier) ? tier
    : in_challenge_period === true ? 1
    : null;
  const byClass = {};
  for (const [cls, usd] of Object.entries(max_asset_class_usd || {})) {
    const v = parseFloat(usd);
    if (Number.isFinite(v) && v > 0) byClass[cls] = (v / fundedSize) * accountBalance;
  }
  return { tier: parsedTier, maxByAssetClass: byClass };
}

// ─── Inline from content/utils.js ─────────────────────────────────────────────

function effectiveMaxSingleUsd(state, symbol) {
  const { limitsLoaded, accountBalance, tier, pairTierLeverage, maxPositionPerPair } = state;
  const bal = Number(accountBalance) || 0;
  const lev = Number(pairTierLeverage?.[symbol]?.[tier]) || 0;
  if (limitsLoaded && lev > 0 && bal > 0) return lev * bal;
  if (limitsLoaded && maxPositionPerPair > 0) return maxPositionPerPair;
  return bal;
}

function effectiveMaxClassUsd(state, symbol) {
  const cls = state.pairCategory?.[symbol] || null;
  const cap = cls ? Number(state.maxByAssetClass?.[cls]) : 0;
  return cap > 0 ? cap : null;
}

function classExposureUsd(state, symbol) {
  const cls = state.pairCategory?.[symbol] || null;
  if (!cls) return 0;
  let sum = 0;
  for (const [coin, pos] of Object.entries(state.hsPositionsByCoin || {})) {
    if (state.pairCategory?.[coin] === cls) sum += Math.abs(Number(pos?.value) || 0);
  }
  return sum;
}

// ─── Inline from content/mirror-preview.js (new/add clamp chain) ─────────────

function projectNewAdd({ targetHs, currentHsPair, pairMax, classNow, classMax, hsTotalNow, maxTotal }) {
  let pairCapBinds = false, classCapBinds = false, portCapBinds = false;
  let proposedAfter = targetHs;
  if (pairMax > 0 && proposedAfter > pairMax + 0.01) { proposedAfter = pairMax; pairCapBinds = true; }
  let proposed = Math.max(0, proposedAfter - currentHsPair);
  const classAfter = classNow + proposed;
  if (classMax != null && classAfter > classMax + 0.01) {
    proposed = Math.max(0, proposed - (classAfter - classMax));
    classCapBinds = true;
  }
  const portAfter = hsTotalNow + proposed;
  if (maxTotal > 0 && portAfter > maxTotal + 0.01) {
    proposed = Math.max(0, proposed - (portAfter - maxTotal));
    portCapBinds = true;
  }
  return { mirrorsTo: proposed, afterHsPair: currentHsPair + proposed, pairCapBinds, classCapBinds, portCapBinds };
}

// Fixtures: tier-1 ($100k challenge) with GOLD base 1.0 vs SILVER base 0.5
const PAIR_TIER_LEVERAGE = {
  GOLD:   { 1: 1.0, 2: 2.0, 3: 3.0, 4: 4.0 },
  SILVER: { 1: 0.5, 2: 1.0, 3: 1.5, 4: 2.0 },
  BTC:    { 1: 0.5, 2: 1.0, 3: 1.5, 4: 2.0 },
};
const PAIR_CATEGORY = { GOLD: 'commodities', SILVER: 'commodities', BTC: 'crypto' };

// ─── tier + max_asset_class_usd parsing ──────────────────────────────────────

describe('applyClassLimits — parsing and scaling', () => {
  it('scales per-class USD caps by accountBalance/fundedSize', () => {
    const r = applyClassLimits({
      accountBalance: 103000, fundedSize: 100000, tier: 1,
      max_asset_class_usd: { crypto: 200000, commodities: 200000 },
    });
    expect(r.maxByAssetClass.crypto).toBe(206000);
    expect(r.maxByAssetClass.commodities).toBe(206000);
    expect(r.tier).toBe(1);
  });

  it('old backend (no new fields) → tier null, empty class map', () => {
    const r = applyClassLimits({ accountBalance: 10000, fundedSize: 10000, tier: undefined, max_asset_class_usd: undefined });
    expect(r.tier).toBeNull();
    expect(r.maxByAssetClass).toEqual({});
  });

  it('non-integer tier is rejected', () => {
    const r = applyClassLimits({ accountBalance: 10000, fundedSize: 10000, tier: '2', max_asset_class_usd: {} });
    expect(r.tier).toBeNull();
  });

  it('no tier but in challenge period → tier 1 derived', () => {
    const r = applyClassLimits({ accountBalance: 10000, fundedSize: 10000, tier: undefined, in_challenge_period: true, max_asset_class_usd: {} });
    expect(r.tier).toBe(1);
  });

  it('no tier and funded → tier stays null (size cutoffs not replicated)', () => {
    const r = applyClassLimits({ accountBalance: 10000, fundedSize: 10000, tier: undefined, in_challenge_period: false, max_asset_class_usd: {} });
    expect(r.tier).toBeNull();
  });

  it('explicit tier wins over challenge derivation', () => {
    const r = applyClassLimits({ accountBalance: 10000, fundedSize: 10000, tier: 2, in_challenge_period: true, max_asset_class_usd: {} });
    expect(r.tier).toBe(2);
  });

  it('non-positive class caps are dropped', () => {
    const r = applyClassLimits({
      accountBalance: 10000, fundedSize: 10000, tier: 1,
      max_asset_class_usd: { crypto: 0, forex: -5, equities: 'abc', commodities: 20000 },
    });
    expect(Object.keys(r.maxByAssetClass)).toEqual(['commodities']);
  });
});

// ─── per-pair cap via tier multiplier ────────────────────────────────────────

describe('effectiveMaxSingleUsd — per-pair tier lookup', () => {
  const base = {
    limitsLoaded: true, accountBalance: 100000, tier: 1,
    pairTierLeverage: PAIR_TIER_LEVERAGE, maxPositionPerPair: 50000,
  };

  it('GOLD and SILVER get different caps within the same class', () => {
    expect(effectiveMaxSingleUsd(base, 'GOLD')).toBe(100000);   // 1.0 × balance
    expect(effectiveMaxSingleUsd(base, 'SILVER')).toBe(50000);  // 0.5 × balance
  });

  it('cap tracks live balance', () => {
    expect(effectiveMaxSingleUsd({ ...base, accountBalance: 103000 }, 'GOLD')).toBe(103000);
  });

  it('tier indexes the multiplier table', () => {
    expect(effectiveMaxSingleUsd({ ...base, tier: 3 }, 'SILVER')).toBe(150000); // 1.5 × balance
  });

  it('unknown pair falls back to class-level /limits figure', () => {
    expect(effectiveMaxSingleUsd(base, 'DOGE')).toBe(50000);
  });

  it('tier null (old backend) falls back to class-level figure', () => {
    expect(effectiveMaxSingleUsd({ ...base, tier: null }, 'GOLD')).toBe(50000);
  });

  it('limits not loaded falls back to balance', () => {
    expect(effectiveMaxSingleUsd({ ...base, limitsLoaded: false, maxPositionPerPair: 0 }, 'GOLD')).toBe(100000);
  });
});

// ─── per-class cap and exposure ──────────────────────────────────────────────

describe('effectiveMaxClassUsd / classExposureUsd', () => {
  const state = {
    pairCategory: PAIR_CATEGORY,
    maxByAssetClass: { commodities: 206000, crypto: 206000 },
    hsPositionsByCoin: {
      GOLD:   { value: 60000 },
      SILVER: { value: -30000 },
      BTC:    { value: 40000 },
    },
  };

  it('returns the cap for the symbol class', () => {
    expect(effectiveMaxClassUsd(state, 'GOLD')).toBe(206000);
    expect(effectiveMaxClassUsd(state, 'BTC')).toBe(206000);
  });

  it('null when class unknown or cap missing — check is skipped', () => {
    expect(effectiveMaxClassUsd(state, 'EURUSD')).toBeNull();
    expect(effectiveMaxClassUsd({ ...state, maxByAssetClass: {} }, 'GOLD')).toBeNull();
  });

  it('sums |value| across same-class positions only', () => {
    expect(classExposureUsd(state, 'GOLD')).toBe(90000);   // GOLD + |SILVER|
    expect(classExposureUsd(state, 'BTC')).toBe(40000);
  });

  it('zero when symbol class unknown', () => {
    expect(classExposureUsd(state, 'EURUSD')).toBe(0);
  });
});

// ─── class clamp in mirror projection ────────────────────────────────────────

describe('projectNewAdd — class cap clamp', () => {
  const base = {
    currentHsPair: 60000, pairMax: 103000,
    classNow: 90000, classMax: 206000,
    hsTotalNow: 130000, maxTotal: 412000,
  };

  it('order within all three caps mirrors fully', () => {
    const r = projectNewAdd({ ...base, targetHs: 90000 }); // +30k GOLD
    expect(r.mirrorsTo).toBe(30000);
    expect(r.pairCapBinds).toBe(false);
    expect(r.classCapBinds).toBe(false);
    expect(r.portCapBinds).toBe(false);
  });

  it('class cap binds when class room is smaller than pair room', () => {
    const r = projectNewAdd({ ...base, classNow: 190000, targetHs: 100000 }); // class room 16k
    expect(r.mirrorsTo).toBe(16000);
    expect(r.classCapBinds).toBe(true);
    expect(r.pairCapBinds).toBe(false);
  });

  it('pair cap clamps before class cap is consulted', () => {
    const r = projectNewAdd({ ...base, targetHs: 150000 }); // pair caps at 103k
    expect(r.afterHsPair).toBe(103000);
    expect(r.pairCapBinds).toBe(true);
    expect(r.classCapBinds).toBe(false);
  });

  it('classMax null (single-class backend) skips the class check', () => {
    const r = projectNewAdd({ ...base, classMax: null, classNow: 0, targetHs: 100000 });
    expect(r.mirrorsTo).toBe(40000);
    expect(r.classCapBinds).toBe(false);
  });

  it('class at cap → nothing mirrors', () => {
    const r = projectNewAdd({ ...base, classNow: 206000, targetHs: 90000 });
    expect(r.mirrorsTo).toBe(0);
    expect(r.classCapBinds).toBe(true);
  });

  it('portfolio cap still applies after class clamp', () => {
    const r = projectNewAdd({ ...base, hsTotalNow: 400000, targetHs: 90000 }); // port room 12k
    expect(r.mirrorsTo).toBe(12000);
    expect(r.portCapBinds).toBe(true);
  });
});
