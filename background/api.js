import { VALIDATOR_URL, HL_API_URL, FAKE_MONEY } from './config.js';
import { setCachedResponse } from './cache.js';

// Cache for resolved entity endpoint URLs (hl_address -> endpoint_url)
let entityEndpointCache = {};

export function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ── Entity endpoint resolution ───────────────────────────────────────────────

export async function resolveEntityEndpoint(hlAddress) {
  if (entityEndpointCache[hlAddress]) {
    console.log('[Hyperstack BG] Entity endpoint cache hit:', entityEndpointCache[hlAddress]);
    return entityEndpointCache[hlAddress];
  }

  const lookupUrl = `${VALIDATOR_URL}/entity/endpoint?hl_address=${hlAddress}`;
  console.log('[Hyperstack BG] Resolving entity endpoint:', lookupUrl);

  const res = await fetchWithTimeout(lookupUrl);
  console.log('[Hyperstack BG] Entity endpoint response status:', res.status);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[Hyperstack BG] Entity endpoint lookup failed:', res.status, body);
    throw new Error(`Entity endpoint lookup failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  console.log('[Hyperstack BG] Entity endpoint response:', JSON.stringify(data));

  if (!data.endpoint_url) {
    data.endpoint_url = 'https://entity-miner.mainnet.vantatrading.io';
  }

  entityEndpointCache[hlAddress] = data.endpoint_url;
  return data.endpoint_url;
}

// ── Events ───────────────────────────────────────────────────────────────────

export async function fetchEvents(hlAddress, since) {
  console.log('[Hyperstack BG] fetchEvents called for', hlAddress, 'since', since);

  const endpointUrl = await resolveEntityEndpoint(hlAddress);
  let url = `${endpointUrl}/api/hl/${hlAddress}/events`;
  if (since) {
    url += `?since=${since}`;
  }
  console.log('[Hyperstack BG] Fetching events from:', url);

  const res = await fetchWithTimeout(url);
  console.log('[Hyperstack BG] Events response status:', res.status);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[Hyperstack BG] Events fetch failed:', res.status, body);
    throw new Error(`Events API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  console.log('[Hyperstack BG] Events received:', data.count ?? data.events?.length ?? 0, 'events');
  setCachedResponse(`cache_events_${hlAddress.toLowerCase()}`, data);
  return data;
}

// ── Trade pairs ──────────────────────────────────────────────────────────────

export async function fetchTradePairs() {
  const res = await fetch(`${VALIDATOR_URL}/trade-pairs`);
  if (!res.ok) throw new Error(`Trade pairs API error ${res.status}`);
  return res.json();
}

// Cache the list of non-default HL DEX prefixes (e.g. ["xyz"]) so we can fetch
// clearinghouseState for each one. Mirrors the behavior of Vanta's
// hyperliquid_tracker._hl_non_default_dexes() and the SDK's
// _get_non_default_dexes(): without this we'd miss perp equity and positions
// on any HIP-3 dex other than the hardcoded "xyz".
let _nonDefaultDexCache = null;

async function getNonDefaultDexes() {
  if (_nonDefaultDexCache !== null) return _nonDefaultDexCache;
  try {
    const data = await fetchTradePairs();
    const pairs = Array.isArray(data) ? data : (data?.allowed || data?.allowed_trade_pairs || []);
    const dexes = new Set();
    for (const p of pairs) {
      const hlCoin = p?.hl_coin;
      if (typeof hlCoin === 'string' && hlCoin.includes(':')) {
        const dex = hlCoin.split(':')[0].toLowerCase();
        if (dex) dexes.add(dex);
      }
    }
    _nonDefaultDexCache = Array.from(dexes).sort();
    console.log('[Hyperstack BG] Discovered non-default dexes:', _nonDefaultDexCache);
    return _nonDefaultDexCache;
  } catch (e) {
    // Do NOT cache the empty list on failure — that would silently strand
    // dex equity/positions until the next extension reload. Return [] for
    // this call only; the next call retries.
    console.warn('[Hyperstack BG] Trade pairs fetch failed, retrying next call:', e.message);
    return [];
  }
}

// Map friendly coin (validator's `tp` prefix, e.g. "WTIOIL") to the HL
// coin used in clearinghouse / allMids (e.g. "XYZ:CL"). Native pairs map
// to themselves (BTC → BTC). Cached on first success; on failure return
// the empty map for this call only and retry next time.
let _friendlyToHlCoinCache = null;

async function getFriendlyToHlCoin() {
  if (_friendlyToHlCoinCache !== null) return _friendlyToHlCoinCache;
  try {
    const data = await fetchTradePairs();
    const pairs = Array.isArray(data) ? data : (data?.allowed || data?.allowed_trade_pairs || []);
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
    _friendlyToHlCoinCache = map;
    return map;
  } catch (e) {
    console.warn('[Hyperstack BG] Trade pairs fetch failed for coin map, retrying next call:', e.message);
    return {};
  }
}

// Derive per-coin HF position values strictly as size × price:
//   size  = sum of signed `q` (quantity) across the position's filled
//           orders (Vanta emits q on every Order.to_dashboard when set;
//           falls back to v/pr with sign by order_type when q is absent
//           on a fill).
//   price = HL mid price for the coin's hl_coin form.
// Skips closed positions, fills lacking both q and v/pr, pairs without
// a resolvable price, and dust. Result keyed by uppercase friendly coin
// (BTC, ETH, WTIOIL, …) — same form as ACCOUNT.filledNotionalByPair.
function deriveHsPositionsByCoin(positions, midPrices, friendlyToHl) {
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
    const rawSymbol = typeof tp === 'string'
      ? tp.replace(/\/.*$/, '')
      : (tp[0] || '');
    const coin = String(rawSymbol).replace(/USD[CT]?$/, '').toUpperCase();
    if (!coin) continue;

    // Look up HL mid price: native pairs use the coin directly (BTC),
    // HIP-3 dex pairs need the hl_coin form (WTIOIL → XYZ:CL).
    const hlCoinKey = (friendlyToHl && friendlyToHl[coin]) || coin;
    const price = parseFloat(midPrices?.[hlCoinKey]) || parseFloat(midPrices?.[coin]) || 0;
    if (!(price > 0)) continue;

    const value = Math.abs(netQuantity) * price;
    const side = netQuantity > 0 ? 'long' : 'short';
    out[coin] = { quantity: netQuantity, value, side };
  }
  return out;
}

// ── Trader limits ────────────────────────────────────────────────────────────

export async function fetchTraderLimits(address) {
  const cacheKey = `cache_limits_${address.toLowerCase()}`;
  const res = await fetchWithTimeout(`${VALIDATOR_URL}/hl-traders/${address}/limits`);
  if (!res.ok) throw new Error(`Validator limits API error ${res.status}`);
  const data = await res.json();
  setCachedResponse(cacheKey, data);
  return data;
}

// ── Data transformation ──────────────────────────────────────────────────────

function transformTraderResponse(raw) {
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
            order_uuid: oid,
            order_type: o.t,
            value: o.v,
            // Signed per-fill quantity. Validator's Order.to_dashboard emits
            // `q` whenever quantity is non-null (Vanta order.py:203). Sum across
            // a position's fills equals Vanta's internal `net_quantity` — the
            // canonical signed coin count. We use this × current mark price
            // for a strict size × price position value, never `nl × *`.
            quantity: o.q,
            execution_type: o.e,
            processed_ms: o.p,
            leverage: o.l,
            price: o.pr,
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

// ── Validator data ───────────────────────────────────────────────────────────

export async function fetchValidatorData(address) {
  const normalizedAddress = address.toLowerCase();
  const cacheKey = `cache_validator_${normalizedAddress}`;

  // Fetch validator dashboard + HL mid prices in parallel. Mid prices are
  // needed to derive HF position values as size × price. A failed mid
  // prices call is non-fatal — hsPositionsByCoin will be empty for that
  // refresh and downstream UI shows "--" rather than fabricated values.
  const [valRes, midsRes] = await Promise.all([
    fetchWithTimeout(`${VALIDATOR_URL}/hl-traders/${normalizedAddress}`),
    fetchWithTimeout(HL_API_URL + '/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'allMids' })
    })
  ]);
  if (!valRes.ok) throw new Error(`Validator API error ${valRes.status}`);
  const raw = await valRes.json();
  const result = transformTraderResponse(raw);

  if (result.hl_address && result.hl_address.toLowerCase() !== normalizedAddress) {
    console.warn('[Hyperstack BG] Address mismatch — queried:', normalizedAddress, 'got:', result.hl_address);
    return { status: 'not_registered' };
  }

  let midPrices = {};
  if (midsRes.ok) {
    try { midPrices = await midsRes.json(); } catch {}
  }
  const friendlyToHl = await getFriendlyToHlCoin();
  const positionsList = Array.isArray(result.positions)
    ? result.positions
    : (result.positions?.positions || []);
  result.hfPositionsByCoin = deriveHsPositionsByCoin(positionsList, midPrices, friendlyToHl);

  setCachedResponse(cacheKey, result);
  return result;
}

// ── Exposure helpers ─────────────────────────────────────────────────────────

function normalizePerpSymbol(raw) {
  if (!raw) return '';
  return String(raw)
    .toUpperCase()
    .replace(/[-_]?PERP$/i, '')
    .replace(/\/.*$/, '')
    .replace(/USD[CT]?$/, '')
    .trim();
}

function extractExposureFromAssetPositions(perpsData) {
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

    // True position value = size × current price. HL pre-computes this as
    // `positionValue`; we fall back to `size × markPx` when it's missing.
    // Never derive notional from `net_leverage × account_size` — that mixes
    // an HF-side ratio with a frozen funded amount and only approximates
    // truth when current equity == account_size and HL/validator are in sync.
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
      // Preserve direction so reduce-intent gating can distinguish long vs short.
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

// Compute pending notional from open (unfilled) limit orders.
// Only buy-side non-TP/SL non-trigger orders are counted — these represent
// positions that will be opened when price reaches the limit, so they count
// against the per-pair cap the same way filled positions do.
// Sell-side orders are excluded: they reduce (or short) exposure and the cap
// math handles those directions correctly through signedNotionalByPair.
function extractPendingBuyNotional(openOrders) {
  const pending = {};
  for (const order of (Array.isArray(openOrders) ? openOrders : [])) {
    if (order.isPositionTpsl) continue;
    if (order.isTrigger) continue;
    if (order.side !== 'B') continue;
    const sz = parseFloat(order.sz || 0) || 0;
    const px = parseFloat(order.limitPx || 0) || 0;
    if (sz <= 0 || px <= 0) continue;
    const symbol = normalizePerpSymbol(order.coin);
    if (symbol) {
      pending[symbol] = (pending[symbol] || 0) + sz * px;
    }
  }
  return pending;
}

function toNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function readSpotUsdValue(balance, mids) {
  const coin = String(balance?.coin || '').toUpperCase();
  const token = balance?.token;
  const total = toNum(balance?.total);
  const hold = toNum(balance?.hold);
  const freeAmount = Math.max(0, total - hold);
  if (!(freeAmount > 0)) return { usd: 0, coin, freeAmount: 0 };

  if (coin === 'USDC' || token === 0 || token === '0') {
    return { usd: freeAmount, coin: 'USDC', freeAmount };
  }

  // Match Vanta tracker: non-USDC value = freeAmount × mid price. We do not
  // read balance.usdValue / .notionalUsd / .valueUsd — those aren't part
  // of HL's spotClearinghouseState schema.
  const midPx = toNum(mids?.[coin]);
  if (midPx > 0) {
    return { usd: freeAmount * midPx, coin, freeAmount };
  }

  return { usd: 0, coin, freeAmount };
}

// ── HL Balance ───────────────────────────────────────────────────────────────

export async function fetchHLBalance(address) {
  console.log('[Hyperstack BG] fetchHLBalance called for', address);

  const nonDefaultDexes = await getNonDefaultDexes();
  const headers = { 'Content-Type': 'application/json' };
  const post = (body) => fetchWithTimeout(HL_API_URL + '/info', { method: 'POST', headers, body: JSON.stringify(body) });

  // Fetch native + each non-default dex perp/openOrders in parallel, plus
  // spot + mids. Order: [native_perp, ...dex_perps, spot, mids,
  // native_openOrders, ...dex_openOrders].
  const [perpsRes, ...rest] = await Promise.all([
    post({ type: 'clearinghouseState', user: address }),
    ...nonDefaultDexes.map(dex => post({ type: 'clearinghouseState', user: address, dex })),
    post({ type: 'spotClearinghouseState', user: address }),
    post({ type: 'allMids' }),
    post({ type: 'openOrders', user: address }),
    ...nonDefaultDexes.map(dex => post({ type: 'openOrders', user: address, dex })),
  ]);
  const dexPerpResponses = rest.slice(0, nonDefaultDexes.length);
  const spotRes = rest[nonDefaultDexes.length];
  const midsRes = rest[nonDefaultDexes.length + 1];
  const nativeOpenOrdersRes = rest[nonDefaultDexes.length + 2];
  const dexOpenOrdersResponses = rest.slice(nonDefaultDexes.length + 3);

  if (!perpsRes.ok) throw new Error(`Perps API error ${perpsRes.status}`);
  const perpsData = await perpsRes.json();

  // Match Vanta tracker / SDK: prefer marginSummary (cross + isolated), fall
  // back to crossMarginSummary. Using only crossMarginSummary understates
  // accountValue when the trader has any isolated-margin positions.
  const readMargin = (d) => d?.marginSummary || d?.crossMarginSummary || {};
  const num = (v) => parseFloat(v ?? 0) || 0;

  // Each non-default HIP-3 dex (e.g. xyz) is a separate HL sub-account: USDC
  // moves into the dex when a position is opened. Their equity and positions
  // must be fetched and summed separately or HL totals are understated.
  let dexAccountValue = 0;
  let dexMarginUsed = 0;
  let dexNtlPos = 0;
  for (let i = 0; i < dexPerpResponses.length; i++) {
    const dex = nonDefaultDexes[i];
    const res = dexPerpResponses[i];
    try {
      if (res.ok) {
        const data = await res.json();
        perpsData.assetPositions = [
          ...(perpsData.assetPositions || []),
          ...(data.assetPositions || []),
        ];
        const m = readMargin(data);
        dexAccountValue += num(m.accountValue);
        dexMarginUsed += num(m.totalMarginUsed);
        dexNtlPos += num(m.totalNtlPos);
      }
    } catch (e) {
      console.warn(`[Hyperstack BG] Dex "${dex}" fetch failed, excluded from totals:`, e.message);
    }
  }
  const nativeMargin = readMargin(perpsData);
  const perpAccountValue = num(nativeMargin.accountValue) + dexAccountValue;
  const perpMarginUsed = num(nativeMargin.totalMarginUsed) + dexMarginUsed;
  const perpNtlPos = num(nativeMargin.totalNtlPos) + dexNtlPos;
  const perpsWithdrawable = Math.max(0, perpAccountValue - perpMarginUsed);
  console.log('[Hyperstack BG] perpAccountValue:', perpAccountValue, '(dex contrib:', dexAccountValue, ') perpMarginUsed:', perpMarginUsed, 'perpAvailable:', perpsWithdrawable);

  let spotUSDC = 0;
  let spotAssetsUsd = 0;
  let spotValueByCoin = {};
  try {
    if (spotRes.ok) {
      const spotData = await spotRes.json();
      const mids = midsRes.ok ? await midsRes.json() : {};
      const balances = spotData?.balances || [];
      for (const b of balances) {
        const { usd, coin } = readSpotUsdValue(b, mids);
        if (coin === 'USDC') {
          spotUSDC += usd;
        } else if (coin && usd > 0) {
          spotValueByCoin[coin] = (spotValueByCoin[coin] || 0) + usd;
        }
      }
      spotAssetsUsd = Object.values(spotValueByCoin).reduce((s, v) => s + (Number(v) || 0), 0);
    }
  } catch (e) {
    console.warn('[Hyperstack BG] Spot fetch failed, using perps only:', e.message);
  }
  console.log(
    '[Hyperstack BG] spot valuation:',
    JSON.stringify({
      spotUSDC,
      spotAssetsUsd,
      spotTotalUsd: spotUSDC + spotAssetsUsd,
      spotValueByCoin,
    })
  );

  // Total HL equity = perp account value (margin used + free + unrealized PnL)
  // + spot. Withdrawable would exclude margin in open positions, which would
  // halve the basis when the trader has a leveraged position open and break
  // mirrorRatio / per-asset cap math downstream.
  let accountValue = perpAccountValue + spotUSDC + spotAssetsUsd;
  let perpsValue = perpAccountValue;

  if (FAKE_MONEY) {
    accountValue = 1000;
    perpsValue = 1000;
    spotUSDC = 0;
  }

  console.log('[Hyperstack BG] total accountValue:', accountValue);
  const exposure = extractExposureFromAssetPositions(perpsData);

  // Pending buy limit orders are tracked separately from filled positions.
  // They contribute to "what would be exposed if all resting orders fill" —
  // displayed visually in the popup as a striped overlay so the trader
  // sees them without the alarm color of real exposure. Filled positions
  // still drive cap-breach toasts.
  let pendingNotionalByPair = {};
  try {
    const allOpenOrders = [];
    if (nativeOpenOrdersRes.ok) allOpenOrders.push(...await nativeOpenOrdersRes.json());
    for (const res of dexOpenOrdersResponses) {
      if (res.ok) {
        try { allOpenOrders.push(...await res.json()); } catch {}
      }
    }
    pendingNotionalByPair = extractPendingBuyNotional(allOpenOrders);
  } catch (e) {
    console.warn('[Hyperstack BG] Open orders fetch failed, pending orders excluded:', e.message);
  }

  // Remap HL coin keys (e.g. "XYZ:CL") to validator-friendly names (e.g.
  // "WTIOIL") so popup and content script consumers see consistent labels
  // matching the validator's `trade_pair` form. Native pairs pass through
  // (BTC → BTC). Without this, the popup unions hfPositionsByCoin
  // (friendly-keyed) with pendingNotionalByPair (HL-keyed), and the same
  // pair shows up under two labels (e.g. "WTIOIL" and "XYZCL").
  const friendlyToHlMap = await getFriendlyToHlCoin();
  const hlToFriendly = {};
  for (const [friendly, hlCoin] of Object.entries(friendlyToHlMap)) {
    if (hlCoin) hlToFriendly[String(hlCoin).toUpperCase()] = friendly;
  }
  const remapHlKeys = (obj) => {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
      const friendly = hlToFriendly[String(k).toUpperCase()] || k;
      out[friendly] = (out[friendly] || 0) + (Number(v) || 0);
    }
    return out;
  };
  pendingNotionalByPair = remapHlKeys(pendingNotionalByPair);
  exposure.notionalByPair = remapHlKeys(exposure.notionalByPair);
  exposure.signedNotionalByPair = remapHlKeys(exposure.signedNotionalByPair);

  const filledNotionalByPair = { ...exposure.notionalByPair };
  const filledTotal = exposure.openTotalUsed;

  // Combined map kept for callers that want filled+pending in one place
  // (mirror-preview's "after this order" check needs to see resting orders
  // so chaining new orders into over-cap still warns).
  const notionalByPair = { ...filledNotionalByPair };
  let pendingTotal = 0;
  for (const [sym, val] of Object.entries(pendingNotionalByPair)) {
    notionalByPair[sym] = (notionalByPair[sym] || 0) + val;
    pendingTotal += val;
  }
  const openTotalUsed = filledTotal + pendingTotal;
  const openSingleUsed = Object.values(notionalByPair).reduce((m, v) => Math.max(m, Number(v) || 0), 0);

  console.log(
    '[Hyperstack BG] HL exposure (filled vs pending):',
    JSON.stringify({
      openPositionCount: exposure.openPositionCount,
      filledTotal,
      pendingTotal,
      openTotalUsed,
      filledNotionalByPair,
      pendingNotionalByPair,
    })
  );

  const balanceData = {
    accountValue,
    perpAccountValue,
    perpsValue,
    spotUSDC,
    spotAssetsUsd,
    spotValueByCoin,
    totalMarginUsed: perpMarginUsed,
    totalNtlPos: perpNtlPos,
    openTotalUsed,
    openSingleUsed,
    notionalByPair,
    filledNotionalByPair,
    pendingNotionalByPair,
    filledTotal,
    pendingTotal,
    signedNotionalByPair: exposure.signedNotionalByPair,
    totalUnrealizedPnl: exposure.totalUnrealizedPnl,
    openPositionCount: exposure.openPositionCount,
    exposureSource: 'hyperliquid-assetPositions',
  };
  setCachedResponse(`cache_balance_${address.toLowerCase()}`, balanceData);
  return balanceData;
}

// ── Mid prices ───────────────────────────────────────────────────────────────

export async function fetchMidPrices() {
  const res = await fetch(HL_API_URL + '/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'allMids' })
  });
  if (!res.ok) throw new Error(`Mid prices API error ${res.status}`);
  return res.json();
}
