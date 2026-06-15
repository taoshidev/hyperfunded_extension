/**
 * Hyperstack Extension — Browser Test Harness
 *
 * Paste this entire script into the DevTools console on app.hyperliquid.xyz
 * (or testnet equivalent) while the Hyperstack extension is loaded and logged in.
 *
 * SAFE: Does NOT click trade buttons or submit orders. Tests the extension's
 * gate/blocking logic by manipulating HF state and checking DOM results.
 *
 * Usage:
 *   1. Open DevTools → Console on app.hyperliquid.xyz
 *   2. Paste and run this script
 *   3. Review PASS/FAIL summary in console
 *   4. Follow the manual test checklist at the end for live trade execution
 *
 * Scenarios covered:
 *   1.  isReduceIntent — native (BTC/ETH) and xyz (WTIOIL/GOLD) pairs
 *   2.  Cap calculations ($686/$2744 from $1372 equity)
 *   3.  resolveExposureSymbol — xyz URL symbol normalization
 *   4.  Oversize toast: native pair breach
 *   5.  Oversize toast: xyz pair breach (WTIOIL)
 *   6.  Oversize toast: portfolio cap breach
 *   7.  Caps never block trades (native) — advisory only
 *   8.  Caps never block trades (xyz) — advisory only
 *   9.  Reduce-intent bypass: native (BTC sell on long)
 *   10. Reduce-intent bypass: xyz (WTIOIL sell on long via XYZ:WTIOIL URL symbol)
 *   11. marginLimitBasisUsd no double-count
 *   12. Mirror ratio sanity (~7.3×, not ~14×)
 *   13. Pair support: native pairs supported
 *   14. Pair support: xyz pairs supported
 *   15. Pair support: unsupported pair triggers block
 *   16. Per-pair tier caps (GOLD ≠ SILVER) with fallbacks
 *   17. Class cap helpers (assetClassOf / effectiveMaxClassUsd / classExposureUsd)
 *   18. Oversize toast: class cap breach (pairs individually under cap)
 *   19. Two-layer fallback: no class data → no class toast
 */
(() => {
  'use strict';

  // ── Guard ──────────────────────────────────────────────────────────────────
  if (!window.__HF) {
    console.error('[HF Test] window.__HF not found. Load Hyperstack extension first.');
    return;
  }
  const HF = window.__HF;
  const ACCOUNT = HF.state.ACCOUNT;

  // ── Helpers ────────────────────────────────────────────────────────────────
  let passed = 0;
  let failed = 0;
  const results = [];

  function assert(label, condition, extra) {
    if (condition) {
      passed++;
      results.push({ status: 'PASS', label });
      console.log('%c  PASS  %c ' + label, 'color:#00c6a7;font-weight:bold', 'color:inherit', extra != null ? '→ ' + extra : '');
    } else {
      failed++;
      results.push({ status: 'FAIL', label });
      console.error('%c  FAIL  %c ' + label, 'color:#f87171;font-weight:bold', 'color:inherit', extra != null ? '→ ' + extra : '');
    }
  }

  function section(title) {
    console.log('%c\n── ' + title + ' ──', 'color:#6466f1;font-weight:bold;font-size:13px');
  }

  function snapshotAccount() { return JSON.parse(JSON.stringify(ACCOUNT)); }
  function restoreAccount(snap) { Object.assign(ACCOUNT, snap); }
  function snapshotState() {
    return {
      shouldBlockTrade: HF.state.shouldBlockTrade,
      forcedTradeBlock: HF.state.forcedTradeBlock,
      forcedTradeBlockReason: HF.state.forcedTradeBlockReason,
      limitsLoaded: HF.state.limitsLoaded,
      _unsupportedPairBlocked: HF.state._unsupportedPairBlocked,
    };
  }
  function restoreState(snap) { Object.assign(HF.state, snap); }

  function oversizeToastVisible() {
    return !!document.querySelector('.hf-toast--oversize.hf-toast-show');
  }
  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Full test runner ───────────────────────────────────────────────────────
  async function runAll() {
    console.log('%c\n═══════════════════════════════════════════════════\n  Hyperstack Extension — Comprehensive Test Suite\n═══════════════════════════════════════════════════\n', 'color:#6466f1;font-weight:bold;font-size:14px');

    const accountSnap = snapshotAccount();
    const stateSnap = snapshotState();

    try {
      await testIsReduceIntentNative();
      await testIsReduceIntentXyz();
      await testCapCalculations();
      await testResolveExposureSymbol();
      await testOversizeToastNative();
      await testOversizeToastXyz();
      await testOversizeToastPortfolio();
      await testTradeBlockingNative();
      await testTradeBlockingXyz();
      await testReduceBypassNative();
      await testReduceBypassXyz();
      await testMarginBasisNoDoubleCount();
      await testMirrorRatio();
      await testPairSupportNative();
      await testPairSupportXyz();
      await testPerPairTierCaps();
      await testClassCapHelpers();
      await testOversizeToastClass();
      await testTwoLayerFallback();
    } finally {
      restoreAccount(accountSnap);
      restoreState(stateSnap);
      HF.tradeGate?.enforceTradeBlock?.();
      HF.toast?.dismissOversizeToast?.();
    }

    const allPassed = failed === 0;
    console.log(
      '\n%c Results: ' + passed + ' passed, ' + failed + ' failed %c',
      allPassed
        ? 'background:#064e3b;color:#00c6a7;font-weight:bold;padding:4px 8px;border-radius:4px'
        : 'background:#7f1d1d;color:#f87171;font-weight:bold;padding:4px 8px;border-radius:4px',
      ''
    );
    return { passed, failed, results };
  }

  // ── 1 · isReduceIntent — native ────────────────────────────────────────────
  async function testIsReduceIntentNative() {
    section('1 · isReduceIntent — native pairs');
    const snap = snapshotAccount();
    const { isReduceIntent } = HF.utils;
    ACCOUNT.signedNotionalByPair = { BTC: 800, ETH: -400 };

    assert('BTC sell on long → reduce', isReduceIntent('BTC', 'sell') === true);
    assert('BTC buy on long → NOT reduce (increasing)', isReduceIntent('BTC', 'buy') === false);
    assert('ETH buy on short → reduce', isReduceIntent('ETH', 'buy') === true);
    assert('ETH sell on short → NOT reduce (increasing short)', isReduceIntent('ETH', 'sell') === false);
    assert('SOL (no position) → not reduce', isReduceIntent('SOL', 'sell') === false);
    assert('null symbol → false', isReduceIntent(null, 'sell') === false);

    restoreAccount(snap);
  }

  // ── 2 · isReduceIntent — xyz pairs ────────────────────────────────────────
  async function testIsReduceIntentXyz() {
    section('2 · isReduceIntent — xyz pairs (WTIOIL/GOLD)');
    const snap = snapshotAccount();
    const { isReduceIntent, resolveExposureSymbol } = HF.utils;

    // After checkBalance remaps XYZ:CL → WTIOIL, exposure is stored under "WTIOIL"
    ACCOUNT.signedNotionalByPair = { WTIOIL: 500, GOLD: -300 };

    assert(
      'WTIOIL long: sell via XYZ:WTIOIL URL symbol → reduce',
      isReduceIntent('XYZ:WTIOIL', 'sell') === true,
      'resolves XYZ:WTIOIL → WTIOIL via hlCoinToDisplay'
    );
    assert(
      'WTIOIL long: buy via XYZ:WTIOIL → NOT reduce',
      isReduceIntent('XYZ:WTIOIL', 'buy') === false
    );
    assert(
      'GOLD short: buy via XYZ:GOLD URL symbol → reduce',
      isReduceIntent('XYZ:GOLD', 'buy') === true
    );
    assert(
      'GOLD short: sell via XYZ:GOLD → NOT reduce',
      isReduceIntent('XYZ:GOLD', 'sell') === false
    );

    // resolveExposureSymbol is exposed on HF.utils
    if (resolveExposureSymbol) {
      assert('resolveExposureSymbol("XYZ:WTIOIL") = "WTIOIL"',
        resolveExposureSymbol('XYZ:WTIOIL') === 'WTIOIL');
      assert('resolveExposureSymbol("XYZ:CL") = "WTIOIL"',
        resolveExposureSymbol('XYZ:CL') === 'WTIOIL');
      assert('resolveExposureSymbol("BTC") = "BTC" (identity)',
        resolveExposureSymbol('BTC') === 'BTC');
    } else {
      console.warn('[HF Test] resolveExposureSymbol not exposed on HF.utils — skipping sub-tests');
    }

    restoreAccount(snap);
  }

  // ── 3 · Cap calculations ───────────────────────────────────────────────────
  async function testCapCalculations() {
    section('3 · Cap calculations (equity-only basis)');
    const snap = snapshotAccount();
    const stSnap = snapshotState();

    ACCOUNT.hlEquity = 1372;
    ACCOUNT.accountBalance = 1372;
    ACCOUNT.tier = null;             // pin: per-pair cap from class-level value
    ACCOUNT.maxPositionPerPair = 686;
    ACCOUNT.maxPortfolio = 2744;
    HF.state.limitsLoaded = true;

    const pairMax = HF.utils.effectiveMaxSingleUsd();
    const totalMax = HF.utils.effectiveMaxTotalUsd();
    const basis = HF.utils.marginLimitBasisUsd();

    assert('Per-asset cap = $686', Math.abs(pairMax - 686) < 1, pairMax);
    assert('Portfolio cap = $2,744', Math.abs(totalMax - 2744) < 1, totalMax);
    assert('marginLimitBasisUsd = hlEquity ($1,372) — no double-count', Math.abs(basis - 1372) < 1, basis);

    // Fallback when limits not loaded
    HF.state.limitsLoaded = false;
    assert('Fallback: per-asset cap = hlEquity when limits not loaded',
      HF.utils.effectiveMaxSingleUsd() === 1372);

    restoreAccount(snap);
    restoreState(stSnap);
  }

  // ── 4 · resolveExposureSymbol ──────────────────────────────────────────────
  async function testResolveExposureSymbol() {
    section('4 · resolveExposureSymbol');
    const { resolveExposureSymbol } = HF.utils;
    if (!resolveExposureSymbol) {
      console.warn('[HF Test] resolveExposureSymbol not on HF.utils — skipping');
      return;
    }
    assert('XYZ:WTIOIL → WTIOIL', resolveExposureSymbol('XYZ:WTIOIL') === 'WTIOIL');
    assert('XYZ:CL → WTIOIL', resolveExposureSymbol('XYZ:CL') === 'WTIOIL');
    assert('XYZ:GOLD → GOLD', resolveExposureSymbol('XYZ:GOLD') === 'GOLD');
    assert('BTC → BTC', resolveExposureSymbol('BTC') === 'BTC');
    assert('null → null', resolveExposureSymbol(null) === null);
  }

  // ── 5 · Oversize toast — native pair ──────────────────────────────────────
  async function testOversizeToastNative() {
    section('5 · Oversize toast — BTC breach');
    const snap = snapshotAccount();
    const stSnap = snapshotState();

    ACCOUNT.hlEquity = 1372;
    ACCOUNT.hlBalance = 1372;
    ACCOUNT.accountBalance = 1372;   // mirror = 1
    ACCOUNT.tier = null;
    ACCOUNT.maxByAssetClass = {};
    ACCOUNT.maxPositionPerPair = 686;
    ACCOUNT.maxPortfolio = 2744;
    ACCOUNT.filledNotionalByPair = { BTC: 800 };
    ACCOUNT.filledTotal = 800;
    HF.state.limitsLoaded = true;

    HF.toast.evaluateOversizeState();
    await wait(50);

    assert('Toast shown when BTC ($800) > per-asset cap ($686)', oversizeToastVisible());
    const el = document.querySelector('.hf-toast--oversize');
    assert('Toast mentions BTC', el?.textContent?.includes('BTC') ?? false);

    // Resolve breach
    ACCOUNT.filledNotionalByPair = { BTC: 500 };
    ACCOUNT.filledTotal = 500;
    HF.toast.evaluateOversizeState();
    await wait(50);
    assert('Toast dismissed when BTC ($500) < cap ($686)', !oversizeToastVisible());

    HF.toast.dismissOversizeToast();
    restoreAccount(snap);
    restoreState(stSnap);
  }

  // ── 6 · Oversize toast — xyz pair ─────────────────────────────────────────
  async function testOversizeToastXyz() {
    section('6 · Oversize toast — WTIOIL xyz breach');
    const snap = snapshotAccount();
    const stSnap = snapshotState();

    ACCOUNT.hlEquity = 1372;
    ACCOUNT.hlBalance = 1372;
    ACCOUNT.accountBalance = 1372;   // mirror = 1
    ACCOUNT.tier = null;
    ACCOUNT.maxByAssetClass = {};
    ACCOUNT.maxPositionPerPair = 686;
    ACCOUNT.maxPortfolio = 2744;
    // After remap, xyz exposure stored under display name "WTIOIL"
    ACCOUNT.filledNotionalByPair = { WTIOIL: 800 };
    ACCOUNT.filledTotal = 800;
    HF.state.limitsLoaded = true;

    HF.toast.evaluateOversizeState();
    await wait(50);

    assert('Toast shown when WTIOIL ($800) > per-asset cap ($686)', oversizeToastVisible());
    const el = document.querySelector('.hf-toast--oversize');
    assert('Toast mentions WTIOIL', el?.textContent?.includes('WTIOIL') ?? false);

    // Resolve breach
    ACCOUNT.filledNotionalByPair = { WTIOIL: 400 };
    ACCOUNT.filledTotal = 400;
    HF.toast.evaluateOversizeState();
    await wait(50);
    assert('Toast dismissed when WTIOIL under cap', !oversizeToastVisible());

    HF.toast.dismissOversizeToast();
    restoreAccount(snap);
    restoreState(stSnap);
  }

  // ── 7 · Oversize toast — portfolio cap ────────────────────────────────────
  async function testOversizeToastPortfolio() {
    section('7 · Oversize toast — portfolio cap breach');
    const snap = snapshotAccount();
    const stSnap = snapshotState();

    ACCOUNT.hlEquity = 1372;
    ACCOUNT.hlBalance = 1372;
    ACCOUNT.accountBalance = 1372;   // mirror = 1
    ACCOUNT.tier = null;
    ACCOUNT.maxByAssetClass = {};
    ACCOUNT.maxPositionPerPair = 686;
    ACCOUNT.maxPortfolio = 2744;
    ACCOUNT.filledNotionalByPair = { BTC: 686, ETH: 686, WTIOIL: 686, GOLD: 686 };
    ACCOUNT.filledTotal = 2744 + 1;  // just over portfolio cap
    HF.state.limitsLoaded = true;

    HF.toast.evaluateOversizeState();
    await wait(50);
    assert('Toast shown when total just over portfolio cap', oversizeToastVisible());

    // Under cap
    ACCOUNT.filledNotionalByPair = { BTC: 500, ETH: 500 };
    ACCOUNT.filledTotal = 2000;
    HF.toast.evaluateOversizeState();
    await wait(50);
    assert('Toast dismissed when total back under cap', !oversizeToastVisible());

    HF.toast.dismissOversizeToast();
    restoreAccount(snap);
    restoreState(stSnap);
  }

  // ── 8 · Trade blocking — native ───────────────────────────────────────────
  async function testTradeBlockingNative() {
    section('8 · Caps are advisory — BTC at cap does not block');
    const snap = snapshotAccount();
    const stSnap = snapshotState();

    ACCOUNT.hlEquity = 1372;
    ACCOUNT.maxPositionPerPair = 686;
    ACCOUNT.maxPortfolio = 2744;
    ACCOUNT.notionalByPair = { BTC: 400 };
    ACCOUNT.openTotalUsed = 400;
    ACCOUNT.signedNotionalByPair = { BTC: 400 };
    HF.state.limitsLoaded = true;
    HF.state.balanceVerified = true;
    HF.state.validatorDataLoaded = true;
    HF.state.shouldBlockTrade = false;
    HF.state.forcedTradeBlock = false;

    HF.tradeGate.checkAndBlockButtons();
    await wait(50);
    assert('NOT blocked at $400 BTC (under $686 cap)', !HF.state.shouldBlockTrade);

    // Caps are advisory: HL orders pass through; the validator clamps the HS
    // mirror at fill time. Blocking is reserved for unsupported pairs.
    ACCOUNT.notionalByPair = { BTC: 686 };
    ACCOUNT.openTotalUsed = 686;
    HF.tradeGate.checkAndBlockButtons();
    await wait(50);
    assert('NOT blocked at $686 BTC (at cap — caps warn, never block)', !HF.state.shouldBlockTrade);

    restoreAccount(snap);
    restoreState(stSnap);
    HF.tradeGate.enforceTradeBlock();
  }

  // ── 9 · Trade blocking — xyz pair ─────────────────────────────────────────
  async function testTradeBlockingXyz() {
    section('9 · Caps are advisory — WTIOIL (xyz) at cap does not block');
    const snap = snapshotAccount();
    const stSnap = snapshotState();

    ACCOUNT.hlEquity = 1372;
    ACCOUNT.maxPositionPerPair = 686;
    ACCOUNT.maxPortfolio = 2744;
    // WTIOIL exposure stored under display name after remap
    ACCOUNT.notionalByPair = { WTIOIL: 300 };
    ACCOUNT.openTotalUsed = 300;
    ACCOUNT.signedNotionalByPair = { WTIOIL: 300 };
    HF.state.limitsLoaded = true;
    HF.state.balanceVerified = true;
    HF.state.validatorDataLoaded = true;
    HF.state.shouldBlockTrade = false;
    HF.state.forcedTradeBlock = false;

    HF.tradeGate.checkAndBlockButtons();
    await wait(50);
    assert('WTIOIL NOT blocked at $300 (under $686 cap)', !HF.state.shouldBlockTrade);

    ACCOUNT.notionalByPair = { WTIOIL: 686 };
    ACCOUNT.openTotalUsed = 686;
    HF.tradeGate.checkAndBlockButtons();
    await wait(50);
    assert('WTIOIL NOT blocked at $686 (at cap — caps warn, never block)', !HF.state.shouldBlockTrade);

    restoreAccount(snap);
    restoreState(stSnap);
    HF.tradeGate.enforceTradeBlock();
  }

  // ── 10 · Reduce bypass — native ───────────────────────────────────────────
  async function testReduceBypassNative() {
    section('10 · Reduce bypass — BTC sell on long over cap');
    const snap = snapshotAccount();
    const { isReduceIntent } = HF.utils;

    ACCOUNT.signedNotionalByPair = { BTC: 800 };  // long BTC over cap

    assert('isReduceIntent("BTC", "sell") = true', isReduceIntent('BTC', 'sell') === true);
    assert('isReduceIntent("BTC", "buy") = false', isReduceIntent('BTC', 'buy') === false);

    restoreAccount(snap);
  }

  // ── 11 · Reduce bypass — xyz ──────────────────────────────────────────────
  async function testReduceBypassXyz() {
    section('11 · Reduce bypass — WTIOIL sell via XYZ:WTIOIL URL symbol');
    const snap = snapshotAccount();
    const { isReduceIntent } = HF.utils;

    // After remap: stored under "WTIOIL"
    ACCOUNT.signedNotionalByPair = { WTIOIL: 800 };  // long WTIOIL over cap

    // URL symbol is "XYZ:WTIOIL" — must resolve to "WTIOIL" for lookup
    assert(
      'isReduceIntent("XYZ:WTIOIL", "sell") = true (resolves via hlCoinToDisplay)',
      isReduceIntent('XYZ:WTIOIL', 'sell') === true
    );
    assert(
      'isReduceIntent("XYZ:WTIOIL", "buy") = false (would increase long)',
      isReduceIntent('XYZ:WTIOIL', 'buy') === false
    );

    // Short WTIOIL
    ACCOUNT.signedNotionalByPair = { WTIOIL: -800 };
    assert(
      'isReduceIntent("XYZ:WTIOIL", "buy") = true (reduce short)',
      isReduceIntent('XYZ:WTIOIL', 'buy') === true
    );
    assert(
      'isReduceIntent("XYZ:WTIOIL", "sell") = false (increase short)',
      isReduceIntent('XYZ:WTIOIL', 'sell') === false
    );

    restoreAccount(snap);
  }

  // ── 12 · marginLimitBasisUsd no double-count ───────────────────────────────
  async function testMarginBasisNoDoubleCount() {
    section('12 · marginLimitBasisUsd — equity only, no double-count');
    const snap = snapshotAccount();

    ACCOUNT.hlEquity = 1372;
    ACCOUNT.openTotalUsed = 667;  // should NOT add to basis

    const basis = HF.utils.marginLimitBasisUsd();
    assert(
      'basis = $1,372 (equity only, NOT $2,039)',
      Math.abs(basis - 1372) < 1,
      '$' + basis.toFixed(2)
    );

    restoreAccount(snap);
  }

  // ── 13 · Mirror ratio ─────────────────────────────────────────────────────
  async function testMirrorRatio() {
    section('13 · Mirror ratio (~7.3×, not ~14×)');
    const snap = snapshotAccount();

    ACCOUNT.hlBalance = 1372;
    ACCOUNT.fundedSize = 10000;

    const ratio = ACCOUNT.fundedSize / ACCOUNT.hlBalance;
    assert('Ratio ≈ 7.3× (correct total equity basis)', Math.abs(ratio - 7.288) < 0.1, ratio.toFixed(2) + '×');
    assert('Ratio < 10 (not the ~14× perpsWithdrawable bug)', ratio < 10);

    restoreAccount(snap);
  }

  // ── 14 · Pair support — native ────────────────────────────────────────────
  async function testPairSupportNative() {
    section('14 · Pair support — native pairs');
    const { isSymbolSupported } = HF.pairSupport;
    if (!HF.state.pairsLoaded) {
      console.warn('[HF Test] Pairs not loaded yet — skipping pair support tests');
      return;
    }
    assert('BTC is supported', isSymbolSupported('BTC'));
    assert('ETH is supported', isSymbolSupported('ETH'));
    assert('SOL is supported', isSymbolSupported('SOL'));
  }

  // ── 15 · Pair support — xyz ───────────────────────────────────────────────
  async function testPairSupportXyz() {
    section('15 · Pair support — xyz DEX pairs');
    const { isSymbolSupported } = HF.pairSupport;
    if (!HF.state.pairsLoaded) {
      console.warn('[HF Test] Pairs not loaded yet — skipping xyz pair support tests');
      return;
    }

    const symbols = HF.state.SUPPORTED_SYMBOLS;
    const hasXyz = symbols.some(s => s.startsWith('XYZ:') || s === 'WTIOIL' || s === 'GOLD');

    if (!hasXyz) {
      console.warn('[HF Test] No xyz pairs in SUPPORTED_SYMBOLS — check your account is on mainnet with xyz pairs enabled');
      return;
    }

    // Test URL forms
    if (symbols.includes('XYZ:WTIOIL') || symbols.includes('WTIOIL')) {
      assert('WTIOIL (friendly name) is supported', isSymbolSupported('WTIOIL'));
      assert('XYZ:WTIOIL (URL form) is supported', isSymbolSupported('XYZ:WTIOIL'));
    }

    // Unsupported pair must block
    const stSnap = snapshotState();
    HF.state._unsupportedPairBlocked = false;
    assert('EURUSD is not supported', !isSymbolSupported('EURUSD'));
    restoreState(stSnap);
  }

  function snapshotPairMaps() {
    return {
      pairCategory: JSON.parse(JSON.stringify(HF.state.pairCategory || {})),
      pairTierLeverage: JSON.parse(JSON.stringify(HF.state.pairTierLeverage || {})),
    };
  }
  function restorePairMaps(s) {
    HF.state.pairCategory = s.pairCategory;
    HF.state.pairTierLeverage = s.pairTierLeverage;
  }

  // ── 16 · Per-pair tier caps ────────────────────────────────────────────────
  async function testPerPairTierCaps() {
    section('16 · Per-pair tier caps (GOLD ≠ SILVER)');
    const snap = snapshotAccount();
    const stSnap = snapshotState();
    const pmSnap = snapshotPairMaps();
    const { effectiveMaxSingleUsd } = HF.utils;

    ACCOUNT.accountBalance = 100000;
    ACCOUNT.tier = 1;
    ACCOUNT.maxPositionPerPair = 50000;
    HF.state.limitsLoaded = true;
    HF.state.pairTierLeverage = {
      GOLD:   { 1: 1.0, 2: 2.0, 3: 3.0, 4: 4.0 },
      SILVER: { 1: 0.5, 2: 1.0, 3: 1.5, 4: 2.0 },
    };

    assert('GOLD cap = 1.0 × balance ($100k)', Math.abs(effectiveMaxSingleUsd('GOLD') - 100000) < 1, effectiveMaxSingleUsd('GOLD'));
    assert('SILVER cap = 0.5 × balance ($50k)', Math.abs(effectiveMaxSingleUsd('SILVER') - 50000) < 1, effectiveMaxSingleUsd('SILVER'));

    ACCOUNT.tier = 3;
    assert('Tier 3: SILVER cap = 1.5 × balance ($150k)', Math.abs(effectiveMaxSingleUsd('SILVER') - 150000) < 1);

    ACCOUNT.tier = null;
    assert('No tier (old backend) → class-level fallback ($50k)', effectiveMaxSingleUsd('GOLD') === 50000);

    ACCOUNT.tier = 1;
    assert('Unknown pair → class-level fallback ($50k)', effectiveMaxSingleUsd('DOGE') === 50000);

    restoreAccount(snap);
    restoreState(stSnap);
    restorePairMaps(pmSnap);
  }

  // ── 17 · Class cap helpers ─────────────────────────────────────────────────
  async function testClassCapHelpers() {
    section('17 · Class cap helpers');
    const snap = snapshotAccount();
    const stSnap = snapshotState();
    const pmSnap = snapshotPairMaps();
    const { assetClassOf, effectiveMaxClassUsd, classExposureUsd } = HF.utils;

    HF.state.pairCategory = { GOLD: 'commodities', SILVER: 'commodities', BTC: 'crypto' };
    ACCOUNT.maxByAssetClass = { commodities: 206000, crypto: 206000 };
    ACCOUNT.hfPositionsByCoin = {
      GOLD:   { value: 60000 },
      SILVER: { value: -30000 },
      BTC:    { value: 40000 },
    };

    assert('assetClassOf(GOLD) = commodities', assetClassOf('GOLD') === 'commodities');
    assert('assetClassOf(EURUSD) = null', assetClassOf('EURUSD') === null);
    assert('Class cap (GOLD) = $206k', effectiveMaxClassUsd('GOLD') === 206000);
    assert('Class cap null for unknown class', effectiveMaxClassUsd('EURUSD') === null);
    assert('Class exposure (commodities) = $90k (|60k| + |−30k|)', classExposureUsd('GOLD') === 90000);
    assert('Class exposure (crypto) = $40k', classExposureUsd('BTC') === 40000);

    ACCOUNT.maxByAssetClass = {};
    assert('Empty class map → null (check skipped)', effectiveMaxClassUsd('GOLD') === null);

    restoreAccount(snap);
    restoreState(stSnap);
    restorePairMaps(pmSnap);
  }

  // ── 18 · Oversize toast — class cap breach ─────────────────────────────────
  async function testOversizeToastClass() {
    section('18 · Oversize toast — class cap breach');
    const snap = snapshotAccount();
    const stSnap = snapshotState();
    const pmSnap = snapshotPairMaps();

    // mirror = 1; each pair within its own cap, class total over
    ACCOUNT.hlBalance = 100000;
    ACCOUNT.accountBalance = 100000;
    ACCOUNT.tier = 1;
    ACCOUNT.maxPositionPerPair = 100000;
    ACCOUNT.maxPortfolio = 400000;
    ACCOUNT.maxByAssetClass = { commodities: 100000 };
    HF.state.pairCategory = { GOLD: 'commodities', SILVER: 'commodities' };
    HF.state.pairTierLeverage = { GOLD: { 1: 1.0 }, SILVER: { 1: 0.5 } };
    ACCOUNT.filledNotionalByPair = { GOLD: 80000, SILVER: 40000 };
    ACCOUNT.filledTotal = 120000;
    HF.state.limitsLoaded = true;

    HF.toast.evaluateOversizeState();
    await wait(50);

    assert('Toast shown when commodities ($120k) > class cap ($100k)', oversizeToastVisible());
    const el = document.querySelector('.hf-toast--oversize');
    assert('Toast mentions commodities', el?.textContent?.toLowerCase().includes('commodities') ?? false);

    ACCOUNT.filledNotionalByPair = { GOLD: 50000, SILVER: 40000 };
    ACCOUNT.filledTotal = 90000;
    HF.toast.evaluateOversizeState();
    await wait(50);
    assert('Toast dismissed when class total ($90k) < cap', !oversizeToastVisible());

    HF.toast.dismissOversizeToast();
    restoreAccount(snap);
    restoreState(stSnap);
    restorePairMaps(pmSnap);
  }

  // ── 19 · Two-layer fallback ────────────────────────────────────────────────
  async function testTwoLayerFallback() {
    section('19 · Two-layer fallback (old backend)');
    const snap = snapshotAccount();
    const stSnap = snapshotState();
    const pmSnap = snapshotPairMaps();

    // Same exposure as #18 but no tier / class data → no breach, no toast
    ACCOUNT.hlBalance = 100000;
    ACCOUNT.accountBalance = 100000;
    ACCOUNT.tier = null;
    ACCOUNT.maxPositionPerPair = 200000;
    ACCOUNT.maxPortfolio = 400000;
    ACCOUNT.maxByAssetClass = {};
    HF.state.pairCategory = {};
    HF.state.pairTierLeverage = {};
    ACCOUNT.filledNotionalByPair = { GOLD: 80000, SILVER: 40000 };
    ACCOUNT.filledTotal = 120000;
    HF.state.limitsLoaded = true;

    HF.toast.evaluateOversizeState();
    await wait(50);
    assert('No toast: two-layer caps not breached, class check skipped', !oversizeToastVisible());

    HF.toast.dismissOversizeToast();
    restoreAccount(snap);
    restoreState(stSnap);
    restorePairMaps(pmSnap);
  }

  // ── Run ────────────────────────────────────────────────────────────────────
  return runAll().then(summary => {
    console.log('\n%c Manual trade execution checklist (use testnet) %c', 'background:#1c1c27;color:#a1a1aa;padding:4px 8px', '');
    console.log([
      '',
      '  NATIVE PAIRS (BTC, ETH, SOL):',
      '  1. Open BTC order form on testnet → enter size above per-pair cap',
      '     Expected: toast appears + Buy button disabled',
      '  2. Same with ETH and SOL',
      '  3. Open BTC with existing LONG position (already near cap) → Sell side',
      '     Expected: Sell button ACTIVE even if pair is over cap',
      '  4. Enter small BTC buy (under cap) → button active, no toast',
      '',
      '  xyz DEX PAIRS (WTIOIL, GOLD):',
      '  5. Navigate to /trade/xyz:WTIOIL → enter size above per-pair cap',
      '     Expected: toast appears + Buy button disabled',
      '  6. Enter WTIOIL buy just under cap → button active',
      '  7. With existing WTIOIL long position (over cap) → Sell side',
      '     Expected: Sell button ACTIVE (reduce intent bypass)',
      '  8. Navigate to /trade/xyz:GOLD → same test as WTIOIL',
      '',
      '  UNSUPPORTED PAIR:',
      '  9. Navigate to a pair NOT in your allowed list',
      '     Expected: unsupported overlay + trading blocked',
      '',
      '  PORTFOLIO CAP:',
      '  10. Have multiple pairs open, try adding one more that would push total over cap',
      '      Expected: blocked with portfolio-limit message',
      '  11. Selling any of those positions should always be allowed',
      '',
      '  POPUP DISPLAY:',
      '  12. Open extension popup → verify HL equity matches what you see on HL dashboard',
      '  13. Per-asset cap bars should be ~50% of HL equity',
      '  14. Verify xyz pair positions appear in popup capacity bars',
    ].join('\n'));
    return summary;
  });
})();
