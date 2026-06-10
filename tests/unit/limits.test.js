/**
 * Tests for trader limit scaling (content/api.js fetchTraderLimits).
 *
 * Refactor (Diff #2/#3, 2026-05): caps now live on the HF side. The validator
 * publishes USD caps in starting-account-size scale (e.g. $5,000 / $20,000 on
 * a $10,000 account = 50% / 200%). The extension stores caps as HF-side USD
 * by deriving the static ratio (pair_usd / fundedSize) and applying it to
 * the live HS balance:
 *
 *   ACCOUNT.maxPositionPerPair = (max_position_per_pair_usd / fundedSize) × accountBalance
 *   ACCOUNT.maxPortfolio       = (max_portfolio_usd       / fundedSize) × accountBalance
 *
 * This keeps caps tracking realised PnL: balance grows → cap grows; drawdown
 * shrinks balance → cap shrinks. Comparison is HF-vs-HF (both in HF USD
 * scale) — never the old `pairUsd / scalingRatio` HL-side math.
 *
 * Covers:
 *  - HF-scale cap derivation (pairUsd / fundedSize × accountBalance)
 *  - Guard: skip when fundedSize ≤ 0 or accountBalance ≤ 0
 *  - Cap tracks accountBalance (grows / shrinks with PnL)
 *  - effectiveMax* falls back to accountBalance when limits not loaded
 */

import { describe, it, expect } from 'vitest';

// ─── Inline limit-scaling logic from content/api.js fetchTraderLimits ────────

function applyTraderLimits({ accountBalance, fundedSize, max_position_per_pair_usd, max_portfolio_usd }) {
  if (!(accountBalance > 0)) return null;  // guard: skip if balance not loaded
  if (!(fundedSize > 0)) return null;      // guard: avoid 0/0 ratio

  const maxPositionPerPair = max_position_per_pair_usd != null
    ? (parseFloat(max_position_per_pair_usd) || 0) / fundedSize * accountBalance
    : null;

  const maxPortfolio = max_portfolio_usd != null
    ? (parseFloat(max_portfolio_usd) || 0) / fundedSize * accountBalance
    : null;

  return { maxPositionPerPair, maxPortfolio };
}

// ─── Inline effectiveMaxSingleUsd / effectiveMaxTotalUsd from content/utils.js

function effectiveMaxSingleUsd({ limitsLoaded, maxPositionPerPair, accountBalance }) {
  if (limitsLoaded && maxPositionPerPair > 0) return maxPositionPerPair;
  return Number(accountBalance) || 0;
}

function effectiveMaxTotalUsd({ limitsLoaded, maxPortfolio, accountBalance }) {
  if (limitsLoaded && maxPortfolio > 0) return maxPortfolio;
  return Number(accountBalance) || 0;
}

// ─── Guards ───────────────────────────────────────────────────────────────────

describe('applyTraderLimits — input guards', () => {
  it('returns null when accountBalance is 0 (validator data unavailable)', () => {
    expect(applyTraderLimits({
      accountBalance: 0, fundedSize: 10000,
      max_position_per_pair_usd: 5000, max_portfolio_usd: 20000,
    })).toBeNull();
  });

  it('returns null when accountBalance is negative', () => {
    expect(applyTraderLimits({
      accountBalance: -100, fundedSize: 10000,
      max_position_per_pair_usd: 5000, max_portfolio_usd: 20000,
    })).toBeNull();
  });

  it('returns null when fundedSize is 0 (avoids divide-by-zero)', () => {
    expect(applyTraderLimits({
      accountBalance: 10000, fundedSize: 0,
      max_position_per_pair_usd: 5000, max_portfolio_usd: 20000,
    })).toBeNull();
  });

  it('returns null when fundedSize is negative', () => {
    expect(applyTraderLimits({
      accountBalance: 10000, fundedSize: -1,
      max_position_per_pair_usd: 5000, max_portfolio_usd: 20000,
    })).toBeNull();
  });
});

// ─── Per-pair cap (HF-scale) ──────────────────────────────────────────────────

describe('per-pair cap — HF-scale derivation', () => {
  it('flat PnL: $10k funded, $10k balance, validator $5k pair → $5k HF cap', () => {
    // Ratio = 5000/10000 = 0.5 → cap = 0.5 × 10000 = 5000
    const { maxPositionPerPair } = applyTraderLimits({
      accountBalance: 10000, fundedSize: 10000,
      max_position_per_pair_usd: 5000, max_portfolio_usd: 20000,
    });
    expect(maxPositionPerPair).toBe(5000);
  });

  it('drawdown: $10k funded, $9k balance after 10% loss → $4,500 cap', () => {
    // Ratio = 0.5 → cap = 0.5 × 9000 = 4500
    const { maxPositionPerPair } = applyTraderLimits({
      accountBalance: 9000, fundedSize: 10000,
      max_position_per_pair_usd: 5000, max_portfolio_usd: 20000,
    });
    expect(maxPositionPerPair).toBe(4500);
  });

  it('profit: $10k funded, $11k balance after 10% gain → $5,500 cap', () => {
    // Ratio = 0.5 → cap = 0.5 × 11000 = 5500
    const { maxPositionPerPair } = applyTraderLimits({
      accountBalance: 11000, fundedSize: 10000,
      max_position_per_pair_usd: 5000, max_portfolio_usd: 20000,
    });
    expect(maxPositionPerPair).toBe(5500);
  });

  it('larger funded account: $25k funded, $25k balance → $12,500 cap', () => {
    const { maxPositionPerPair } = applyTraderLimits({
      accountBalance: 25000, fundedSize: 25000,
      max_position_per_pair_usd: 12500, max_portfolio_usd: 50000,
    });
    expect(maxPositionPerPair).toBe(12500);
  });

  it('null max_position_per_pair_usd → null result', () => {
    const { maxPositionPerPair } = applyTraderLimits({
      accountBalance: 10000, fundedSize: 10000,
      max_position_per_pair_usd: null, max_portfolio_usd: 20000,
    });
    expect(maxPositionPerPair).toBeNull();
  });

  it('different ratio (40%): pair = 0.4 × balance', () => {
    const { maxPositionPerPair } = applyTraderLimits({
      accountBalance: 10000, fundedSize: 10000,
      max_position_per_pair_usd: 4000, max_portfolio_usd: 16000,
    });
    expect(maxPositionPerPair).toBe(4000);
  });
});

// ─── Portfolio cap (HF-scale) ─────────────────────────────────────────────────

describe('portfolio cap — HF-scale derivation', () => {
  it('flat PnL: $10k funded, $10k balance, validator $20k portfolio → $20k HF cap', () => {
    const { maxPortfolio } = applyTraderLimits({
      accountBalance: 10000, fundedSize: 10000,
      max_position_per_pair_usd: 5000, max_portfolio_usd: 20000,
    });
    expect(maxPortfolio).toBe(20000);
  });

  it('portfolio cap shrinks proportionally with drawdown', () => {
    // Ratio = 20000/10000 = 2.0 → cap = 2.0 × 9000 = 18000
    const { maxPortfolio } = applyTraderLimits({
      accountBalance: 9000, fundedSize: 10000,
      max_position_per_pair_usd: 5000, max_portfolio_usd: 20000,
    });
    expect(maxPortfolio).toBe(18000);
  });

  it('portfolio cap = 4× per-pair cap (typical 200% / 50% ratio)', () => {
    const result = applyTraderLimits({
      accountBalance: 10000, fundedSize: 10000,
      max_position_per_pair_usd: 5000, max_portfolio_usd: 20000,
    });
    expect(result.maxPortfolio / result.maxPositionPerPair).toBeCloseTo(4, 5);
  });

  it('portfolio cap ratio preserved across PnL swings', () => {
    // The 4× ratio between portfolio and per-pair stays constant regardless
    // of where the balance is (both scale together with accountBalance).
    const drawdown = applyTraderLimits({
      accountBalance: 8000, fundedSize: 10000,
      max_position_per_pair_usd: 5000, max_portfolio_usd: 20000,
    });
    const profit = applyTraderLimits({
      accountBalance: 12000, fundedSize: 10000,
      max_position_per_pair_usd: 5000, max_portfolio_usd: 20000,
    });
    expect(drawdown.maxPortfolio / drawdown.maxPositionPerPair).toBeCloseTo(4, 5);
    expect(profit.maxPortfolio / profit.maxPositionPerPair).toBeCloseTo(4, 5);
  });
});

// ─── effectiveMaxSingleUsd / effectiveMaxTotalUsd ────────────────────────────

describe('effectiveMaxSingleUsd', () => {
  it('returns maxPositionPerPair when limits loaded and > 0', () => {
    expect(effectiveMaxSingleUsd({ limitsLoaded: true, maxPositionPerPair: 5000, accountBalance: 10000 })).toBe(5000);
  });

  it('falls back to accountBalance when limits NOT loaded', () => {
    expect(effectiveMaxSingleUsd({ limitsLoaded: false, maxPositionPerPair: 5000, accountBalance: 10000 })).toBe(10000);
  });

  it('falls back to accountBalance when maxPositionPerPair = 0', () => {
    expect(effectiveMaxSingleUsd({ limitsLoaded: true, maxPositionPerPair: 0, accountBalance: 10000 })).toBe(10000);
  });

  it('returns 0 when accountBalance is 0 and limits not loaded', () => {
    expect(effectiveMaxSingleUsd({ limitsLoaded: false, maxPositionPerPair: 0, accountBalance: 0 })).toBe(0);
  });
});

describe('effectiveMaxTotalUsd', () => {
  it('returns maxPortfolio when limits loaded', () => {
    expect(effectiveMaxTotalUsd({ limitsLoaded: true, maxPortfolio: 20000, accountBalance: 10000 })).toBe(20000);
  });

  it('falls back to accountBalance when limits NOT loaded', () => {
    expect(effectiveMaxTotalUsd({ limitsLoaded: false, maxPortfolio: 20000, accountBalance: 10000 })).toBe(10000);
  });
});

// ─── Integration: typical $10k funded trader ─────────────────────────────────

describe('limits integration — typical scenarios', () => {
  it('$10k funded with 50% / 200% validator caps maps cleanly to HF USD', () => {
    const validatorLimits = { max_position_per_pair_usd: 5000, max_portfolio_usd: 20000 };

    // Flat PnL
    const flat = applyTraderLimits({
      accountBalance: 10000, fundedSize: 10000, ...validatorLimits,
    });
    expect(flat.maxPositionPerPair).toBe(5000);
    expect(flat.maxPortfolio).toBe(20000);

    // 5% drawdown
    const dd = applyTraderLimits({
      accountBalance: 9500, fundedSize: 10000, ...validatorLimits,
    });
    expect(dd.maxPositionPerPair).toBe(4750);
    expect(dd.maxPortfolio).toBe(19000);

    // 5% profit
    const profit = applyTraderLimits({
      accountBalance: 10500, fundedSize: 10000, ...validatorLimits,
    });
    expect(profit.maxPositionPerPair).toBe(5250);
    expect(profit.maxPortfolio).toBe(21000);
  });

  it('cap moves with accountBalance — never frozen at fundedSize', () => {
    // Critical: pre-refactor behaviour froze the cap at the static USD figure
    // from the validator. Now the cap is a fraction of live HS balance, so
    // it tracks PnL.
    const limits = { max_position_per_pair_usd: 5000, max_portfolio_usd: 20000 };
    const r1 = applyTraderLimits({ accountBalance: 9000,  fundedSize: 10000, ...limits });
    const r2 = applyTraderLimits({ accountBalance: 11000, fundedSize: 10000, ...limits });
    expect(r1.maxPositionPerPair).not.toBe(r2.maxPositionPerPair);
    expect(r2.maxPositionPerPair).toBeGreaterThan(r1.maxPositionPerPair);
  });

  it('null when accountBalance not yet loaded (avoids inflated default caps)', () => {
    // Pre-Diff-#1 the default fallback could leave $100k caps stuck around;
    // now applyTraderLimits returns null and downstream content/api.js
    // simply doesn't update ACCOUNT.maxPositionPerPair until balance is real.
    const result = applyTraderLimits({
      accountBalance: 0, fundedSize: 10000,
      max_position_per_pair_usd: 5000, max_portfolio_usd: 20000,
    });
    expect(result).toBeNull();
  });
});
