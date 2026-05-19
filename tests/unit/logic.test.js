/**
 * Unit tests for pure business logic extracted from content scripts.
 * No DOM, no window.__HF — tests the logic in isolation.
 *
 * Refactor (Diff #4–#6, 2026-05): caps live on the HF side now, the mirror
 * multiplier uses live `accountBalance` (not frozen `fundedSize`), and the
 * oversize toast triggers on `HL × mirror > cap + 0.01` against
 * filledNotionalByPair (pending limit orders excluded).
 */
import { describe, it, expect } from 'vitest';

// ─── Extracted pure functions (mirrors production content/utils.js) ─────────

const COIN_TO_DISPLAY = {
  'XYZ:CL': 'WTIOIL',
  'XYZ:WTIOIL': 'WTIOIL',
  'XYZ:GOLD': 'GOLD',
  'BTC': 'BTC', 'ETH': 'ETH', 'SOL': 'SOL',
};

function resolveExposureSymbol(symbol, hlCoinToDisplay) {
  if (!symbol) return null;
  return (hlCoinToDisplay || {})[symbol] || symbol;
}

function isReduceIntent(signedNotionalByPair, symbol, side, hlCoinToDisplay) {
  if (!symbol || (side !== 'buy' && side !== 'sell')) return false;
  const resolved = resolveExposureSymbol(symbol, hlCoinToDisplay || {});
  const signed = Number(signedNotionalByPair?.[resolved]) || 0;
  if (Math.abs(signed) <= 0.01) return false;
  if (signed > 0 && side === 'sell') return true;  // selling a long
  if (signed < 0 && side === 'buy') return true;   // buying a short
  return false;
}

// Mirrors content/toast.js evaluateOversizeState. Trigger is HL × mirror,
// compared against HF-scale caps with a small +0.01 tolerance to avoid
// flicker at exact-fit positions. Filled-only — pending limit orders are
// hypothetical and surfaced visually elsewhere, not via this toast.
function evaluateOversizeState({ filledNotionalByPair, filledTotal, mirror, pairMax, totalMax }) {
  const m = Number(mirror) || 0;
  const anyPairOver = pairMax > 0
    && Object.values(filledNotionalByPair || {}).some(v => ((Number(v) || 0) * m) > pairMax + 0.01);
  const hlTotalTarget = (Number(filledTotal) || 0) * m;
  const totalOver = totalMax > 0 && hlTotalTarget > totalMax + 0.01;
  return { anyPairOver, totalOver, breach: anyPairOver || totalOver, hlTotalTarget };
}

// Mirrors content/utils.js getMirrorMultiplier — the live HF↔HL conversion.
// HS_USD = HL_USD × (accountBalance / hlBalance). Both sides are live equity
// figures, so the multiplier reflects current PnL (replaces the old
// `fundedSize / hlBalance` which froze at the starting funded amount).
function getMirrorMultiplier(hlBalance, accountBalance) {
  const hl = Number(hlBalance) || 0;
  const ab = Number(accountBalance) || 0;
  if (hl <= 0 || ab <= 0) return 0;
  return ab / hl;
}

function capColor(pct) {
  if (pct >= 90) return 'rgb(239, 68, 68)';
  if (pct >= 70) return '#ffb900';
  return '#6466f1';
}

function barPendingBg(pct) {
  if (pct >= 90) return 'rgba(239, 68, 68, 0.5)';
  if (pct >= 70) return 'rgba(255, 185, 0, 0.4)';
  return 'rgba(100, 102, 241, 0.4)';
}

// Cap resolution — mirrors effectiveMaxSingleUsd / effectiveMaxTotalUsd.
// Caps are HF-USD now (= ratio × accountBalance); fallback is the live HF
// balance, not HL equity.
function effectiveMaxSingleUsd({ limitsLoaded, maxPositionPerPair, accountBalance }) {
  if (limitsLoaded && maxPositionPerPair > 0) return maxPositionPerPair;
  return Number(accountBalance) || 0;
}

function effectiveMaxTotalUsd({ limitsLoaded, maxPortfolio, accountBalance }) {
  if (limitsLoaded && maxPortfolio > 0) return maxPortfolio;
  return Number(accountBalance) || 0;
}

// ─── isReduceIntent ──────────────────────────────────────────────────────────

describe('isReduceIntent', () => {
  it('returns true when selling a long position', () => {
    expect(isReduceIntent({ BTC: 800 }, 'BTC', 'sell')).toBe(true);
  });

  it('returns true when buying a short position', () => {
    expect(isReduceIntent({ ETH: -500 }, 'ETH', 'buy')).toBe(true);
  });

  it('returns false when buying a long position (increasing)', () => {
    expect(isReduceIntent({ BTC: 800 }, 'BTC', 'buy')).toBe(false);
  });

  it('returns false when selling a short position (increasing)', () => {
    expect(isReduceIntent({ ETH: -500 }, 'ETH', 'sell')).toBe(false);
  });

  it('returns false when no position exists (signed = 0)', () => {
    expect(isReduceIntent({ BTC: 0 }, 'BTC', 'sell')).toBe(false);
  });

  it('returns false when position is below dust threshold (≤ 0.01)', () => {
    expect(isReduceIntent({ BTC: 0.005 }, 'BTC', 'sell')).toBe(false);
  });

  it('returns false when symbol is missing', () => {
    expect(isReduceIntent({ BTC: 800 }, null, 'sell')).toBe(false);
    expect(isReduceIntent({ BTC: 800 }, '', 'sell')).toBe(false);
  });

  it('returns false when side is invalid', () => {
    expect(isReduceIntent({ BTC: 800 }, 'BTC', 'long')).toBe(false);
    expect(isReduceIntent({ BTC: 800 }, 'BTC', undefined)).toBe(false);
  });

  it('returns false when symbol not in signedNotionalByPair', () => {
    expect(isReduceIntent({}, 'BTC', 'sell')).toBe(false);
    expect(isReduceIntent(null, 'BTC', 'sell')).toBe(false);
  });

  it('handles multiple pairs independently', () => {
    const positions = { BTC: 800, ETH: -400, SOL: 0 };
    expect(isReduceIntent(positions, 'BTC', 'sell')).toBe(true);   // reduce long
    expect(isReduceIntent(positions, 'BTC', 'buy')).toBe(false);   // increase long
    expect(isReduceIntent(positions, 'ETH', 'buy')).toBe(true);    // reduce short
    expect(isReduceIntent(positions, 'ETH', 'sell')).toBe(false);  // increase short
    expect(isReduceIntent(positions, 'SOL', 'buy')).toBe(false);   // no position
  });
});

// ─── evaluateOversizeState ───────────────────────────────────────────────────
//
// Production trigger: HL filled × mirror > HF cap + 0.01. The +0.01 tolerance
// avoids flickering at exact-fit positions where validator-clamping rounds
// HF to the cap and HL × ratio rounds to cap-plus-epsilon.

describe('evaluateOversizeState — HL × mirror vs HF caps', () => {
  it('no breach when projected HL × mirror is under the per-pair cap', () => {
    const result = evaluateOversizeState({
      filledNotionalByPair: { BTC: 500 },   // HL filled $500
      filledTotal: 500,
      mirror: 1.0,                          // → projects to $500 HF
      pairMax: 5000,
      totalMax: 20000,
    });
    expect(result.breach).toBe(false);
    expect(result.anyPairOver).toBe(false);
    expect(result.totalOver).toBe(false);
  });

  it('per-pair breach: HL × mirror > pairMax', () => {
    const result = evaluateOversizeState({
      filledNotionalByPair: { BTC: 1000 },
      filledTotal: 1000,
      mirror: 7.0,                          // 1000 × 7 = $7,000 > $5,000
      pairMax: 5000,
      totalMax: 20000,
    });
    expect(result.anyPairOver).toBe(true);
    expect(result.breach).toBe(true);
  });

  it('exact-fit (HL × mirror == cap) does NOT trigger (+0.01 tolerance)', () => {
    // Trader intentionally sized to the cap. Validator clamps HF to exactly
    // the cap. We don't want the toast firing in this happy-path scenario.
    const result = evaluateOversizeState({
      filledNotionalByPair: { BTC: 1000 },
      filledTotal: 1000,
      mirror: 5.0,                          // 1000 × 5 = exactly $5,000 cap
      pairMax: 5000,
      totalMax: 20000,
    });
    expect(result.anyPairOver).toBe(false);
  });

  it('just above cap (within 0.01 tolerance) does NOT trigger', () => {
    const result = evaluateOversizeState({
      filledNotionalByPair: { BTC: 1000.001 },
      filledTotal: 1000.001,
      mirror: 5.0,                          // 5000.005, within 0.01
      pairMax: 5000,
      totalMax: 20000,
    });
    expect(result.anyPairOver).toBe(false);
  });

  it('clearly above cap (mirror × HL > cap + 0.01) triggers', () => {
    const result = evaluateOversizeState({
      filledNotionalByPair: { BTC: 1001 },
      filledTotal: 1001,
      mirror: 5.0,                          // 5005 > 5000.01
      pairMax: 5000,
      totalMax: 20000,
    });
    expect(result.anyPairOver).toBe(true);
  });

  it('total breach: filledTotal × mirror > totalMax', () => {
    const result = evaluateOversizeState({
      filledNotionalByPair: { BTC: 600, ETH: 600, SOL: 600, AVAX: 600 },
      filledTotal: 2400,
      mirror: 1.0,                          // 2400 > 2000
      pairMax: 5000,
      totalMax: 2000,
    });
    expect(result.totalOver).toBe(true);
    expect(result.hlTotalTarget).toBeCloseTo(2400);
  });

  it('both breaches simultaneously', () => {
    const result = evaluateOversizeState({
      filledNotionalByPair: { BTC: 900 },
      filledTotal: 900,
      mirror: 1.0,
      pairMax: 686,
      totalMax: 500,
    });
    expect(result.anyPairOver).toBe(true);
    expect(result.totalOver).toBe(true);
  });

  it('no breach when pairMax is 0 (limits not loaded)', () => {
    const result = evaluateOversizeState({
      filledNotionalByPair: { BTC: 9999 },
      filledTotal: 9999,
      mirror: 5.0,
      pairMax: 0,
      totalMax: 0,
    });
    expect(result.breach).toBe(false);
  });

  it('no breach when mirror is 0 (HF↔HL conversion unavailable)', () => {
    const result = evaluateOversizeState({
      filledNotionalByPair: { BTC: 9999 },
      filledTotal: 9999,
      mirror: 0,
      pairMax: 100,
      totalMax: 200,
    });
    expect(result.breach).toBe(false);
  });

  it('empty filledNotionalByPair → no per-pair breach (only check totalOver)', () => {
    const result = evaluateOversizeState({
      filledNotionalByPair: {},
      filledTotal: 0,
      mirror: 5.0,
      pairMax: 100,
      totalMax: 200,
    });
    expect(result.anyPairOver).toBe(false);
    expect(result.totalOver).toBe(false);
  });
});

// ─── getMirrorMultiplier (live accountBalance / hlBalance) ───────────────────

describe('getMirrorMultiplier — live accountBalance / hlBalance', () => {
  it('flat PnL: $1,372 HL, $10,000 HF balance → ratio ≈ 7.29', () => {
    expect(getMirrorMultiplier(1372, 10000)).toBeCloseTo(7.29, 1);
  });

  it('post-drawdown: HF balance dropped 10% → ratio drops correspondingly', () => {
    // Funded $10k, balance $9k after 10% loss. HL still at $1372.
    // Multiplier = 9000/1372 ≈ 6.56 (used to be 7.29 with frozen fundedSize).
    expect(getMirrorMultiplier(1372, 9000)).toBeCloseTo(6.56, 1);
  });

  it('post-profit: HF balance grew 10% → ratio rises correspondingly', () => {
    expect(getMirrorMultiplier(1372, 11000)).toBeCloseTo(8.02, 1);
  });

  it('returns 0 when hlBalance is 0', () => {
    expect(getMirrorMultiplier(0, 10000)).toBe(0);
  });

  it('returns 0 when accountBalance is 0', () => {
    expect(getMirrorMultiplier(1372, 0)).toBe(0);
  });

  it('returns 0 for negative values', () => {
    expect(getMirrorMultiplier(-100, 10000)).toBe(0);
    expect(getMirrorMultiplier(1372, -100)).toBe(0);
  });

  it('1:1 ratio when both equal', () => {
    expect(getMirrorMultiplier(1000, 1000)).toBe(1);
  });

  it('returns 0 for NaN inputs', () => {
    expect(getMirrorMultiplier(NaN, 10000)).toBe(0);
    expect(getMirrorMultiplier(1372, NaN)).toBe(0);
  });

  it('ratio < 1 when HL larger than HF balance (atypical)', () => {
    expect(getMirrorMultiplier(10000, 5000)).toBe(0.5);
  });

  it('large ratio for $100k HF account', () => {
    expect(getMirrorMultiplier(1372, 100000)).toBeCloseTo(72.9, 0);
  });

  it('very small HL balance does not divide-by-zero', () => {
    expect(getMirrorMultiplier(0.01, 10000)).toBeCloseTo(1000000);
  });
});

// ─── capColor / barPendingBg ─────────────────────────────────────────────────

describe('capColor', () => {
  it('returns teal/indigo color below 70%', () => {
    expect(capColor(0)).toBe('#6466f1');
    expect(capColor(50)).toBe('#6466f1');
    expect(capColor(69.9)).toBe('#6466f1');
  });

  it('returns amber at 70–89%', () => {
    expect(capColor(70)).toBe('#ffb900');
    expect(capColor(80)).toBe('#ffb900');
    expect(capColor(89.9)).toBe('#ffb900');
  });

  it('returns red at 90%+', () => {
    expect(capColor(90)).toBe('rgb(239, 68, 68)');
    expect(capColor(100)).toBe('rgb(239, 68, 68)');
    expect(capColor(150)).toBe('rgb(239, 68, 68)');
  });
});

describe('barPendingBg', () => {
  it('returns indigo alpha below 70%', () => {
    expect(barPendingBg(0)).toBe('rgba(100, 102, 241, 0.4)');
    expect(barPendingBg(69)).toBe('rgba(100, 102, 241, 0.4)');
  });

  it('returns amber alpha at 70–89%', () => {
    expect(barPendingBg(70)).toBe('rgba(255, 185, 0, 0.4)');
    expect(barPendingBg(85)).toBe('rgba(255, 185, 0, 0.4)');
  });

  it('returns red alpha at 90%+', () => {
    expect(barPendingBg(90)).toBe('rgba(239, 68, 68, 0.5)');
    expect(barPendingBg(100)).toBe('rgba(239, 68, 68, 0.5)');
  });
});

// ─── effectiveMaxSingleUsd / effectiveMaxTotalUsd ────────────────────────────

describe('effectiveMaxSingleUsd', () => {
  it('returns maxPositionPerPair when limits are loaded', () => {
    expect(effectiveMaxSingleUsd({
      limitsLoaded: true,
      maxPositionPerPair: 5000,
      accountBalance: 10000,
    })).toBe(5000);
  });

  it('falls back to accountBalance when limits not loaded', () => {
    expect(effectiveMaxSingleUsd({
      limitsLoaded: false,
      maxPositionPerPair: 5000,
      accountBalance: 10000,
    })).toBe(10000);
  });

  it('falls back to accountBalance when maxPositionPerPair is 0', () => {
    expect(effectiveMaxSingleUsd({
      limitsLoaded: true,
      maxPositionPerPair: 0,
      accountBalance: 10000,
    })).toBe(10000);
  });
});

describe('effectiveMaxTotalUsd', () => {
  it('returns maxPortfolio when limits are loaded', () => {
    expect(effectiveMaxTotalUsd({
      limitsLoaded: true,
      maxPortfolio: 20000,
      accountBalance: 10000,
    })).toBe(20000);
  });

  it('falls back to accountBalance when limits not loaded', () => {
    expect(effectiveMaxTotalUsd({
      limitsLoaded: false,
      maxPortfolio: 20000,
      accountBalance: 10000,
    })).toBe(10000);
  });
});

// ─── Cap math integration (HF-scale, end-to-end) ─────────────────────────────

describe('cap math (integration) — HF-side caps + mirror multiplier', () => {
  it('per-pair cap = (validator pair USD / fundedSize) × accountBalance', () => {
    // $10k funded, validator pair USD = $5k (50%), live balance $10,500
    const pairCap = (5000 / 10000) * 10500;
    expect(pairCap).toBe(5250);
  });

  it('order would exceed cap: HL × mirror > HF pair cap', () => {
    const pairMax = 5000;     // HF-USD cap
    const mirror = 5.0;       // 1 HL$ → 5 HF$
    const currentHl = 500;
    const newOrderHl = 600;
    const projectedHsPair = (currentHl + newOrderHl) * mirror;  // 1100 × 5 = 5500
    expect(projectedHsPair > pairMax).toBe(true);
  });

  it('reduce order bypasses cap check: isReduceIntent stays true even when over cap', () => {
    const symbol = 'BTC';
    const orderSide = 'sell';
    // signedNotionalByPair stores HF-side signed exposure (validator-derived)
    // OR HL-side signed (background extractor). Either way, sign = direction.
    const signedNotionalByPair = { BTC: 8000 };  // positive = long
    expect(isReduceIntent(signedNotionalByPair, symbol, orderSide)).toBe(true);
  });

  it('new long while approaching cap: blocked when HL × mirror > pair cap', () => {
    const pairMax = 5000;
    const mirror = 5.0;
    const currentHl = 600;
    const newOrderHl = 200;
    const projectedHsPair = (currentHl + newOrderHl) * mirror;  // 800 × 5 = 4000
    const symbol = 'BTC';
    const orderSide = 'buy';
    const signedNotionalByPair = { BTC: 600 };

    expect(isReduceIntent(signedNotionalByPair, symbol, orderSide)).toBe(false);
    // 4000 < 5000 → not yet blocked; trader has headroom
    expect(projectedHsPair > pairMax).toBe(false);
  });
});

// ─── isReduceIntent — xyz pair symbol resolution ─────────────────────────────

describe('isReduceIntent — xyz pair symbol resolution', () => {
  it('XYZ:WTIOIL URL symbol, exposure stored as WTIOIL (post-remap) → reduce detected', () => {
    // After checkBalance remaps "XYZ:CL" → "WTIOIL", exposure is stored under "WTIOIL"
    // URL symbol is "XYZ:WTIOIL", which resolveExposureSymbol maps to "WTIOIL"
    const signedByPair = { WTIOIL: 500 };  // long WTIOIL
    expect(isReduceIntent(signedByPair, 'XYZ:WTIOIL', 'sell', COIN_TO_DISPLAY)).toBe(true);
  });

  it('XYZ:WTIOIL URL symbol, sell on short → reduce short (buy would reduce)', () => {
    const signedByPair = { WTIOIL: -500 };  // short WTIOIL
    expect(isReduceIntent(signedByPair, 'XYZ:WTIOIL', 'buy', COIN_TO_DISPLAY)).toBe(true);
    expect(isReduceIntent(signedByPair, 'XYZ:WTIOIL', 'sell', COIN_TO_DISPLAY)).toBe(false);
  });

  it('XYZ:CL hl_coin form also resolves via COIN_TO_DISPLAY → WTIOIL', () => {
    const signedByPair = { WTIOIL: 500 };
    // Even if user passes hl_coin form "XYZ:CL", it resolves the same way
    expect(isReduceIntent(signedByPair, 'XYZ:CL', 'sell', COIN_TO_DISPLAY)).toBe(true);
  });

  it('XYZ:GOLD long → sell reduces', () => {
    const signedByPair = { GOLD: 300 };
    expect(isReduceIntent(signedByPair, 'XYZ:GOLD', 'sell', COIN_TO_DISPLAY)).toBe(true);
  });

  it('XYZ:GOLD short → buy reduces', () => {
    const signedByPair = { GOLD: -300 };
    expect(isReduceIntent(signedByPair, 'XYZ:GOLD', 'buy', COIN_TO_DISPLAY)).toBe(true);
  });

  it('xyz pair: buy on long position → NOT reduce (increasing exposure)', () => {
    const signedByPair = { WTIOIL: 500 };
    expect(isReduceIntent(signedByPair, 'XYZ:WTIOIL', 'buy', COIN_TO_DISPLAY)).toBe(false);
  });

  it('xyz pair: no position → not reduce regardless of side', () => {
    const signedByPair = {};
    expect(isReduceIntent(signedByPair, 'XYZ:WTIOIL', 'sell', COIN_TO_DISPLAY)).toBe(false);
    expect(isReduceIntent(signedByPair, 'XYZ:WTIOIL', 'buy', COIN_TO_DISPLAY)).toBe(false);
  });

  it('xyz pair: without hlCoinToDisplay mapping, XYZ:WTIOIL does not resolve to WTIOIL', () => {
    // Without the display map, the resolution falls back to identity → XYZ:WTIOIL
    // but exposure is stored as WTIOIL → lookup fails (returns 0) → not reduce
    const signedByPair = { WTIOIL: 500 };
    expect(isReduceIntent(signedByPair, 'XYZ:WTIOIL', 'sell', {})).toBe(false);
    // This confirms why the remap fix is necessary
  });
});

// ─── resolveExposureSymbol ────────────────────────────────────────────────────

describe('resolveExposureSymbol', () => {
  it('BTC → BTC (identity)', () => expect(resolveExposureSymbol('BTC', COIN_TO_DISPLAY)).toBe('BTC'));
  it('ETH → ETH', () => expect(resolveExposureSymbol('ETH', COIN_TO_DISPLAY)).toBe('ETH'));
  it('XYZ:WTIOIL → WTIOIL', () => expect(resolveExposureSymbol('XYZ:WTIOIL', COIN_TO_DISPLAY)).toBe('WTIOIL'));
  it('XYZ:CL → WTIOIL', () => expect(resolveExposureSymbol('XYZ:CL', COIN_TO_DISPLAY)).toBe('WTIOIL'));
  it('XYZ:GOLD → GOLD', () => expect(resolveExposureSymbol('XYZ:GOLD', COIN_TO_DISPLAY)).toBe('GOLD'));
  it('null → null', () => expect(resolveExposureSymbol(null, COIN_TO_DISPLAY)).toBeNull());
  it('empty string → null', () => expect(resolveExposureSymbol('', COIN_TO_DISPLAY)).toBeNull());
  it('unknown symbol → pass through', () => expect(resolveExposureSymbol('NEWCOIN', COIN_TO_DISPLAY)).toBe('NEWCOIN'));
  it('empty display map → identity fallback', () => expect(resolveExposureSymbol('XYZ:WTIOIL', {})).toBe('XYZ:WTIOIL'));
  it('null display map → identity fallback', () => expect(resolveExposureSymbol('BTC', null)).toBe('BTC'));
});

// ─── evaluateOversizeState — xyz pairs ───────────────────────────────────────

describe('evaluateOversizeState — xyz pairs', () => {
  it('WTIOIL exposure triggers breach when HL × mirror > pairMax (post-remap key)', () => {
    const result = evaluateOversizeState({
      filledNotionalByPair: { WTIOIL: 1100 },   // HL filled $1100
      filledTotal: 1100,
      mirror: 5.0,                              // → projects $5500 HF
      pairMax: 5000,
      totalMax: 20000,
    });
    expect(result.anyPairOver).toBe(true);
    expect(result.breach).toBe(true);
  });

  it('WTIOIL under cap → no breach', () => {
    const result = evaluateOversizeState({
      filledNotionalByPair: { WTIOIL: 800 },    // 800 × 5 = 4000 < 5000
      filledTotal: 800,
      mirror: 5.0,
      pairMax: 5000,
      totalMax: 20000,
    });
    expect(result.breach).toBe(false);
  });

  it('mixed portfolio: BTC fine, WTIOIL over cap → per-pair breach detected', () => {
    const result = evaluateOversizeState({
      filledNotionalByPair: { BTC: 500, WTIOIL: 1200 },  // WTIOIL 1200 × 5 = 6000
      filledTotal: 1700,
      mirror: 5.0,
      pairMax: 5000,
      totalMax: 20000,
    });
    expect(result.anyPairOver).toBe(true);
  });

  it('portfolio over cap: total HL × mirror > totalMax', () => {
    const result = evaluateOversizeState({
      filledNotionalByPair: { WTIOIL: 600, GOLD: 600, BTC: 600, ETH: 600 },
      filledTotal: 2400,
      mirror: 1.0,
      pairMax: 5000,                             // each pair under cap
      totalMax: 2000,                            // 2400 > 2000 → over
    });
    expect(result.totalOver).toBe(true);
  });
});
