/**
 * Shared integration test helpers.
 *
 * All transformation functions are inlined from their production sources so
 * integration tests exercise the exact same logic against real API responses.
 * When production code changes, these must stay in sync.
 *
 * Sources:
 *   normalizePerpSymbol, extractExposureFromAssetPositions  → background/api.js
 *   transformTraderResponse                                 → background/api.js
 *   deriveHsPositionsByCoin, buildFriendlyToHlCoin           → background/api.js
 *   buildHlCoinToDisplay                                    → content/api.js (fetchTradePairs)
 *   applyTraderLimits                                       → content/api.js (fetchTraderLimits)
 *   remapKeys                                               → content/api.js (checkBalance)
 *   resolveExposureSymbol, resolveChallengeModeFromValidator → content/utils.js
 */

// ── API call helpers ──────────────────────────────────────────────────────────

export async function hlPost(hlUrl, body) {
  const res = await fetch(`${hlUrl}/info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HL API error ${res.status} for type=${body.type}`);
  return res.json();
}

export async function validatorGet(validatorUrl, path) {
  const res = await fetch(`${validatorUrl}${path}`);
  if (!res.ok) throw new Error(`Validator API ${res.status} at ${path}`);
  return res.json();
}

// ── background/api.js — normalizePerpSymbol ───────────────────────────────────

export function normalizePerpSymbol(raw) {
  if (!raw) return '';
  return String(raw)
    .toUpperCase()
    .replace(/[-_]?PERP$/i, '')
    .replace(/\/.*$/, '')
    .replace(/USD[CT]?$/, '')
    .trim();
}

// ── background/api.js — extractExposureFromAssetPositions ────────────────────

export function extractExposureFromAssetPositions(perpsData) {
  const perAsset = {};
  const perAssetSigned = {};
  let total = 0;
  let totalUnrealizedPnl = 0;
  let openCount = 0;
  const assetPositions = Array.isArray(perpsData?.assetPositions) ? perpsData.assetPositions : [];

  for (const row of assetPositions) {
    const pos = row?.position || row || {};
    const size = parseFloat(pos?.szi ?? pos?.size ?? pos?.sz ?? 0) || 0;
    if (Math.abs(size) <= 1e-12) continue;

    const directNotional =
      parseFloat(pos?.positionValue ?? pos?.notionalValue ?? pos?.usdValue ?? pos?.value ?? row?.positionValue);
    const markPx = parseFloat(pos?.markPx ?? pos?.mark_price ?? pos?.px ?? 0) || 0;
    const fallbackNotional = Math.abs(size * markPx);
    const notional = Math.abs(Number.isFinite(directNotional) ? directNotional : fallbackNotional);
    if (!(notional > 0)) continue;

    const upnl = parseFloat(pos?.unrealizedPnl ?? pos?.unrealized_pnl ?? row?.unrealizedPnl);
    if (Number.isFinite(upnl)) totalUnrealizedPnl += upnl;

    const symbol = normalizePerpSymbol(pos?.coin ?? pos?.asset ?? pos?.name ?? row?.coin ?? row?.asset);
    if (symbol) {
      perAsset[symbol] = (perAsset[symbol] || 0) + notional;
      const signed = size > 0 ? notional : -notional;
      perAssetSigned[symbol] = (perAssetSigned[symbol] || 0) + signed;
    }

    total += notional;
    openCount += 1;
  }

  const maxSingle = Object.values(perAsset).reduce((m, v) => Math.max(m, Number(v) || 0), 0);
  return {
    openTotalUsed: total,
    openSingleUsed: maxSingle,
    notionalByPair: perAsset,
    signedNotionalByPair: perAssetSigned,
    totalUnrealizedPnl,
    openPositionCount: openCount,
  };
}

// ── background/api.js — transformTraderResponse ──────────────────────────────

export function transformTraderResponse(raw) {
  const d = raw.dashboard || {};
  const info = d.subaccount_info || {};
  const acctData = d.account_size_data || null;
  const dd = d.drawdown || null;
  const cp = d.challenge_period || null;
  const elim = d.elimination || null;
  const accountSize = acctData?.account_size ?? info.account_size ?? 0;

  let positions = null;
  if (d.positions) {
    const posMap = d.positions.positions || {};
    const posArray = Object.entries(posMap).map(([uuid, p]) => ({
      position_uuid: uuid,
      trade_pair: p.tp,
      position_type: p.t,
      open_ms: p.o,
      current_return: p.r,
      average_entry_price: p.ap,
      realized_pnl: p.rp,
      net_leverage: p.nl || 0,
      close_ms: p.c || null,
      return_at_close: p.rc || null,
      is_closed_position: !!p.c,
      total_fees: p.fh
        ? Object.values(p.fh).reduce((sum, f) => sum + (f.a || 0), 0)
        : 0,
      filled_orders: p.fo
        ? Object.entries(p.fo).map(([oid, o]) => ({
            order_uuid: oid, order_type: o.t, value: o.v,
            quantity: o.q,
            execution_type: o.e, processed_ms: o.p, leverage: o.l, price: o.pr,
          }))
        : [],
    }));
    positions = {
      positions: posArray,
      positions_time_ms: d.positions.positions_time_ms,
      all_time_returns: d.positions.all_time_returns,
      total_leverage: d.positions.total_leverage,
    };
  }

  let drawdown = null;
  if (dd) {
    const intradayThresholdPct = (dd.intraday_drawdown_threshold || 0) * 100;
    const eodThresholdPct = (dd.eod_drawdown_threshold || 0) * 100;
    drawdown = {
      ...dd,
      intraday_threshold_pct: intradayThresholdPct,
      eod_threshold_pct: eodThresholdPct,
      intraday_usage_pct: intradayThresholdPct > 0 ? (dd.intraday_drawdown_pct / intradayThresholdPct) * 100 : 0,
      eod_usage_pct: eodThresholdPct > 0 ? (dd.eod_drawdown_pct / eodThresholdPct) * 100 : 0,
    };
  }

  return {
    status: raw.status,
    timestamp: raw.timestamp,
    synthetic_hotkey: info.synthetic_hotkey,
    account_size: accountSize,
    hl_address: info.hl_address,
    payout_address: info.payout_address,
    subaccount_status: info.status,
    challenge_period: cp,
    drawdown,
    elimination: elim,
    account_size_data: acctData,
    positions,
  };
}

// ── content/api.js — buildHlCoinToDisplay (from fetchTradePairs) ──────────────

export function buildHlCoinToDisplay(tradePairsResponse) {
  const map = {};
  const symbols = new Set();
  const pairs = (tradePairsResponse.allowed || []).filter(
    p => p.trade_pair_source === 'hyperliquid' &&
         !p.trade_pair_id.toLowerCase().startsWith('xyz:')
  );
  for (const p of pairs) {
    const friendly = p.trade_pair_id.replace(/USDC?$/, '').toUpperCase();
    symbols.add(friendly);
    const hlKey = p.hl_coin ? p.hl_coin.toUpperCase() : friendly;
    symbols.add(hlKey);
    map[hlKey] = friendly;
    if (hlKey.startsWith('XYZ:')) {
      const xyzFriendly = 'XYZ:' + friendly;
      symbols.add(xyzFriendly);
      map[xyzFriendly] = friendly;
    }
  }
  return { map, symbols: [...symbols] };
}

// ── content/api.js — applyTraderLimits (from fetchTraderLimits) ───────────────
//
// Diff #2/#3 (2026-05): caps moved to the HF side. The validator returns
// USD figures in starting-account-size scale (e.g. $5,000 / $20,000 on a
// $10,000 funded account). We derive the static ratio (pair_usd / fundedSize)
// and apply it to the live HS balance, so caps track realised PnL.
//
//   maxPositionPerPair = (pair_usd       / fundedSize) × accountBalance
//   maxPortfolio       = (portfolio_usd  / fundedSize) × accountBalance

export function applyTraderLimits({ accountBalance, fundedSize, max_position_per_pair_usd, max_portfolio_usd }) {
  if (!(accountBalance > 0)) return null;
  if (!(fundedSize > 0)) return null;
  const maxPositionPerPair = max_position_per_pair_usd != null
    ? (parseFloat(max_position_per_pair_usd) || 0) / fundedSize * accountBalance
    : null;
  const maxPortfolio = max_portfolio_usd != null
    ? (parseFloat(max_portfolio_usd) || 0) / fundedSize * accountBalance
    : null;
  return { maxPositionPerPair, maxPortfolio };
}

// ── background/api.js — deriveHsPositionsByCoin ──────────────────────────────
//
// Strict size × price for the HF-side per-coin actuals. Mirror of
// background/api.js deriveHsPositionsByCoin (Diff #5).

export function deriveHsPositionsByCoin(positions, midPrices, friendlyToHl) {
  const out = {};
  if (!Array.isArray(positions)) return out;
  for (const pos of positions) {
    if (!pos || pos.is_closed_position || pos.close_ms) continue;
    let netQuantity = 0;
    for (const fill of (pos.filled_orders || [])) {
      const q = parseFloat(fill?.quantity);
      if (Number.isFinite(q)) {
        netQuantity += q;
        continue;
      }
      const v = parseFloat(fill?.value);
      const pr = parseFloat(fill?.price);
      if (Number.isFinite(v) && Number.isFinite(pr) && pr > 0) {
        const sideSign = String(fill?.order_type || '').toUpperCase() === 'LONG' ? 1 : -1;
        netQuantity += sideSign * (Math.abs(v) / pr);
      }
    }
    if (!Number.isFinite(netQuantity) || Math.abs(netQuantity) < 1e-12) continue;

    const tp = pos.trade_pair || '';
    const rawSymbol = typeof tp === 'string' ? tp.replace(/\/.*$/, '') : (tp[0] || '');
    const coin = String(rawSymbol).replace(/USD[CT]?$/, '').toUpperCase();
    if (!coin) continue;

    const hlCoinKey = (friendlyToHl && friendlyToHl[coin]) || coin;
    const price = parseFloat(midPrices?.[hlCoinKey]) || parseFloat(midPrices?.[coin]) || 0;
    if (!(price > 0)) continue;

    const value = Math.abs(netQuantity) * price;
    const side = netQuantity > 0 ? 'long' : 'short';
    out[coin] = { quantity: netQuantity, value, side };
  }
  return out;
}

// ── background/api.js — getFriendlyToHlCoin (from /trade-pairs) ──────────────

export function buildFriendlyToHlCoin(tradePairsResponse) {
  const pairs = Array.isArray(tradePairsResponse)
    ? tradePairsResponse
    : (tradePairsResponse?.allowed || tradePairsResponse?.allowed_trade_pairs || []);
  const map = {};
  for (const p of pairs) {
    const tp = p?.trade_pair;
    let friendly;
    if (typeof tp === 'string') friendly = tp.split('/')[0].toUpperCase();
    else if (Array.isArray(tp)) friendly = String(tp[0] || '').toUpperCase();
    else continue;
    if (!friendly) continue;
    const hlCoin = (p?.hl_coin || friendly).toString().toUpperCase();
    map[friendly] = hlCoin;
  }
  return map;
}

// ── content/api.js — remapKeys (from checkBalance) ───────────────────────────

export function remapKeys(raw, hlCoinToDisplay) {
  const display = hlCoinToDisplay || {};
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    const key = display[k] || k;
    out[key] = (out[key] || 0) + (Number(v) || 0);
  }
  return out;
}

// ── content/utils.js — resolveExposureSymbol ─────────────────────────────────

export function resolveExposureSymbol(symbol, hlCoinToDisplay) {
  if (!symbol) return null;
  return (hlCoinToDisplay || {})[symbol] || symbol;
}

// ── content/utils.js — resolveChallengeModeFromValidator ─────────────────────

export function resolveChallengeModeFromValidator(result) {
  const bucket = result?.challenge_period?.bucket;
  if (bucket === 'SUBACCOUNT_FUNDED') return false;
  if (bucket) return true;
  return true;
}
