/**
 * Tests for validator API response transformation (background/api.js) and
 * HF position derivation (deriveHsPositionsByCoin).
 *
 * Covers:
 *  - transformTraderResponse: raw dashboard wire format → normalised shape
 *  - filled_orders quantity (`q`) propagation
 *  - trade_pair coin extraction: string / array / edge cases
 *  - deriveHsPositionsByCoin: strict size × price (fo[].q × HL mid)
 *      • quantity sums signed `q` across fills
 *      • fallback to v/pr × order_type sign when q missing
 *      • skip closed / dust / no-price positions
 *      • HIP-3 friendly→hl_coin mapping (WTIOIL → XYZ:CL)
 *  - Closed position filtering
 *  - Challenge vs funded mode detection
 *
 * Refactor note (2026-05): the validator's `net_leverage × account_size`
 * is no longer used to derive notional or PnL. HF pair value comes
 * exclusively from `|sum of signed q| × HL mid price`. Tests for the
 * old `extractPositionNotional` were removed in this pass.
 */

import { describe, it, expect } from 'vitest';

// ─── Inline transformTraderResponse from background/api.js ───────────────────

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
      total_fees: p.fh ? Object.values(p.fh).reduce((sum, f) => sum + (f.a || 0), 0) : 0,
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
    account_size: accountSize,
    hl_address: info.hl_address,
    challenge_period: cp,
    drawdown,
    elimination: elim,
    account_size_data: acctData,
    positions,
  };
}

// ─── Inline coin extraction from content/api.js fetchValidatorData ───────────

function extractCoinFromTradePair(tradePair) {
  const tp = tradePair || '';
  return (typeof tp === 'string' ? tp : (tp[0] || ''))
    .replace(/\/.*$/, '')
    .replace(/USD[CT]?$/, '')
    .toUpperCase();
}

// ─── Inline deriveHsPositionsByCoin from background/api.js ───────────────────

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

    const hlCoinKey = (friendlyToHl && friendlyToHl[coin]) || coin;
    const price = parseFloat(midPrices?.[hlCoinKey]) || parseFloat(midPrices?.[coin]) || 0;
    if (!(price > 0)) continue;

    const value = Math.abs(netQuantity) * price;
    const side = netQuantity > 0 ? 'long' : 'short';
    out[coin] = { quantity: netQuantity, value, side };
  }
  return out;
}

// ─── Inline resolveChallengeModeFromValidator from content/utils.js ──────────

function resolveChallengeModeFromValidator(result) {
  const bucket = result?.challenge_period?.bucket;
  if (bucket === 'SUBACCOUNT_FUNDED') return false;
  if (bucket) return true;
  return true;  // no bucket = assume challenge
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeRawDashboard({ hl_address = '0xabc', account_size = 10000, positions = {}, challenge_period = null, drawdown = null } = {}) {
  return {
    status: 'success',
    dashboard: {
      subaccount_info: { hl_address, account_size },
      account_size_data: { account_size },
      positions: { positions, positions_time_ms: Date.now() },
      challenge_period,
      drawdown,
    },
  };
}

// `fo` accepts an object map keyed by order id, mirroring the wire format.
// Each fill: { t: 'LONG'|'SHORT', q: signed quantity, v: USD value, pr: price }
function makeRawPosition({ tp, nl = 0, r = 1, c = null, fo = {} } = {}) {
  return { tp, nl, r, c, fo };
}

// Helper: build a single LONG fill with explicit q.
function longFill({ q, v, pr } = {}) {
  return { t: 'LONG', q, v, pr };
}
function shortFill({ q, v, pr } = {}) {
  return { t: 'SHORT', q, v, pr };
}

// ─── transformTraderResponse ──────────────────────────────────────────────────

describe('transformTraderResponse — basic shape', () => {
  it('extracts account_size from account_size_data', () => {
    const raw = makeRawDashboard({ account_size: 10000 });
    const result = transformTraderResponse(raw);
    expect(result.account_size).toBe(10000);
  });

  it('passes through status', () => {
    const raw = makeRawDashboard();
    const result = transformTraderResponse(raw);
    expect(result.status).toBe('success');
  });

  it('extracts hl_address from subaccount_info', () => {
    const raw = makeRawDashboard({ hl_address: '0xdeadbeef' });
    const result = transformTraderResponse(raw);
    expect(result.hl_address).toBe('0xdeadbeef');
  });

  it('returns positions array from map', () => {
    const raw = makeRawDashboard({
      positions: {
        'uuid-1': makeRawPosition({ tp: 'BTC/USDC', nl: 0.5 }),
      },
    });
    const result = transformTraderResponse(raw);
    expect(Array.isArray(result.positions.positions)).toBe(true);
    expect(result.positions.positions).toHaveLength(1);
  });

  it('handles empty positions map', () => {
    const raw = makeRawDashboard({ positions: {} });
    const result = transformTraderResponse(raw);
    expect(result.positions.positions).toHaveLength(0);
  });

  it('handles missing dashboard entirely', () => {
    const result = transformTraderResponse({ status: 'error' });
    expect(result.account_size).toBe(0);
    expect(result.positions).toBeNull();
  });
});

describe('transformTraderResponse — position fields', () => {
  it('maps net_leverage (p.nl) — passed through but not used for value calc', () => {
    const raw = makeRawDashboard({
      positions: { 'u1': makeRawPosition({ tp: 'BTC/USDC', nl: 0.07 }) },
    });
    const pos = transformTraderResponse(raw).positions.positions[0];
    expect(pos.net_leverage).toBeCloseTo(0.07);
  });

  it('maps close_ms (p.c)', () => {
    const raw = makeRawDashboard({
      positions: { 'u1': makeRawPosition({ tp: 'BTC/USDC', nl: 0.07, c: 1714000000 }) },
    });
    const pos = transformTraderResponse(raw).positions.positions[0];
    expect(pos.close_ms).toBe(1714000000);
    expect(pos.is_closed_position).toBe(true);
  });

  it('is_closed_position = false when c is null', () => {
    const raw = makeRawDashboard({
      positions: { 'u1': makeRawPosition({ tp: 'BTC/USDC', nl: 0.07 }) },
    });
    const pos = transformTraderResponse(raw).positions.positions[0];
    expect(pos.is_closed_position).toBe(false);
    expect(pos.close_ms).toBeNull();
  });

  it('negative nl preserved (passthrough — not used for direction in new logic)', () => {
    const raw = makeRawDashboard({
      positions: { 'u1': makeRawPosition({ tp: 'ETH/USDC', nl: -0.05 }) },
    });
    const pos = transformTraderResponse(raw).positions.positions[0];
    expect(pos.net_leverage).toBeCloseTo(-0.05);
  });

  it('filled_orders propagates quantity (fo[].q) — needed for size × price', () => {
    const raw = makeRawDashboard({
      positions: {
        'u1': makeRawPosition({
          tp: 'BTC/USDC',
          fo: {
            'oid-a': { t: 'LONG', q: 0.015, v: 1500, pr: 100000 },
            'oid-b': { t: 'LONG', q: 0.005, v: 500,  pr: 100000 },
          },
        }),
      },
    });
    const pos = transformTraderResponse(raw).positions.positions[0];
    expect(pos.filled_orders).toHaveLength(2);
    expect(pos.filled_orders[0].quantity).toBeCloseTo(0.015);
    expect(pos.filled_orders[0].value).toBe(1500);
    expect(pos.filled_orders[0].price).toBe(100000);
    expect(pos.filled_orders[0].order_type).toBe('LONG');
    expect(pos.filled_orders[1].quantity).toBeCloseTo(0.005);
  });

  it('filled_orders propagates undefined quantity when q is absent on a fill', () => {
    const raw = makeRawDashboard({
      positions: {
        'u1': makeRawPosition({
          tp: 'BTC/USDC',
          fo: { 'oid-a': { t: 'LONG', v: 1500, pr: 100000 } }, // no q
        }),
      },
    });
    const pos = transformTraderResponse(raw).positions.positions[0];
    expect(pos.filled_orders[0].quantity).toBeUndefined();
    expect(pos.filled_orders[0].value).toBe(1500);
    expect(pos.filled_orders[0].price).toBe(100000);
  });

  it('SHORT order_type preserved verbatim', () => {
    const raw = makeRawDashboard({
      positions: {
        'u1': makeRawPosition({
          tp: 'ETH/USDC',
          fo: { 'oid-a': { t: 'SHORT', q: -0.5, v: 1000, pr: 2000 } },
        }),
      },
    });
    const pos = transformTraderResponse(raw).positions.positions[0];
    expect(pos.filled_orders[0].order_type).toBe('SHORT');
    expect(pos.filled_orders[0].quantity).toBeCloseTo(-0.5);
  });
});

// ─── extractCoinFromTradePair ─────────────────────────────────────────────────

describe('extractCoinFromTradePair — native pairs', () => {
  it('BTC/USDC → BTC', () => expect(extractCoinFromTradePair('BTC/USDC')).toBe('BTC'));
  it('ETH/USDC → ETH', () => expect(extractCoinFromTradePair('ETH/USDC')).toBe('ETH'));
  it('SOL/USDC → SOL', () => expect(extractCoinFromTradePair('SOL/USDC')).toBe('SOL'));
  it('BTCUSDC (no slash) → BTC', () => expect(extractCoinFromTradePair('BTCUSDC')).toBe('BTC'));
  it('BTCUSDT → BTC', () => expect(extractCoinFromTradePair('BTCUSDT')).toBe('BTC'));
  it('ETHUSD → ETH', () => expect(extractCoinFromTradePair('ETHUSD')).toBe('ETH'));
  it('plain symbol "BTC" → BTC', () => expect(extractCoinFromTradePair('BTC')).toBe('BTC'));
  it('lowercased input → uppercased output', () => expect(extractCoinFromTradePair('btc/usdc')).toBe('BTC'));
});

describe('extractCoinFromTradePair — xyz DEX pairs', () => {
  it('WTIOIL/USDC → WTIOIL', () => expect(extractCoinFromTradePair('WTIOIL/USDC')).toBe('WTIOIL'));
  it('GOLD/USDC → GOLD', () => expect(extractCoinFromTradePair('GOLD/USDC')).toBe('GOLD'));
  it('NVDA/USDC → NVDA', () => expect(extractCoinFromTradePair('NVDA/USDC')).toBe('NVDA'));
  it('WTIOILUSDC (no slash) → WTIOIL', () => expect(extractCoinFromTradePair('WTIOILUSDC')).toBe('WTIOIL'));
});

describe('extractCoinFromTradePair — array format', () => {
  it('["WTIOIL", "5"] → WTIOIL (uses first element)', () => {
    expect(extractCoinFromTradePair(['WTIOIL', '5'])).toBe('WTIOIL');
  });

  it('["BTC/USDC", ...] → BTC', () => {
    expect(extractCoinFromTradePair(['BTC/USDC', 'extra'])).toBe('BTC');
  });

  it('["GOLD/USDC"] → GOLD', () => {
    expect(extractCoinFromTradePair(['GOLD/USDC'])).toBe('GOLD');
  });

  it('empty array → empty string', () => {
    expect(extractCoinFromTradePair([])).toBe('');
  });
});

describe('extractCoinFromTradePair — edge cases', () => {
  it('null → empty string', () => expect(extractCoinFromTradePair(null)).toBe(''));
  it('undefined → empty string', () => expect(extractCoinFromTradePair(undefined)).toBe(''));
  it('empty string → empty string', () => expect(extractCoinFromTradePair('')).toBe(''));
});

// ─── deriveHsPositionsByCoin — strict size × price ───────────────────────────

describe('deriveHsPositionsByCoin — quantity from fo[].q', () => {
  it('single LONG fill: BTC 0.015 @ midPrice 100000 → value $1500', () => {
    const positions = transformTraderResponse(makeRawDashboard({
      positions: {
        'u1': makeRawPosition({
          tp: 'BTC/USDC',
          fo: { 'oid-a': longFill({ q: 0.015, v: 1500, pr: 100000 }) },
        }),
      },
    })).positions.positions;

    const out = deriveHsPositionsByCoin(positions, { BTC: '100000' }, {});
    expect(out.BTC.quantity).toBeCloseTo(0.015);
    expect(out.BTC.value).toBeCloseTo(1500);
    expect(out.BTC.side).toBe('long');
  });

  it('multiple LONG fills aggregate: 0.015 + 0.005 = 0.020 BTC @ 100000 → $2000', () => {
    const positions = transformTraderResponse(makeRawDashboard({
      positions: {
        'u1': makeRawPosition({
          tp: 'BTC/USDC',
          fo: {
            'a': longFill({ q: 0.015, v: 1500, pr: 100000 }),
            'b': longFill({ q: 0.005, v: 500,  pr: 100000 }),
          },
        }),
      },
    })).positions.positions;

    const out = deriveHsPositionsByCoin(positions, { BTC: '100000' }, {});
    expect(out.BTC.quantity).toBeCloseTo(0.020);
    expect(out.BTC.value).toBeCloseTo(2000);
    expect(out.BTC.side).toBe('long');
  });

  it('SHORT fill (negative q) → side="short", value uses |quantity|', () => {
    const positions = transformTraderResponse(makeRawDashboard({
      positions: {
        'u1': makeRawPosition({
          tp: 'ETH/USDC',
          fo: { 'a': shortFill({ q: -0.5, v: 1000, pr: 2000 }) },
        }),
      },
    })).positions.positions;

    const out = deriveHsPositionsByCoin(positions, { ETH: '2000' }, {});
    expect(out.ETH.quantity).toBeCloseTo(-0.5);
    expect(out.ETH.value).toBeCloseTo(1000);  // |q| × price
    expect(out.ETH.side).toBe('short');
  });

  it('long-then-short fills net to a long when sum > 0', () => {
    const positions = transformTraderResponse(makeRawDashboard({
      positions: {
        'u1': makeRawPosition({
          tp: 'BTC/USDC',
          fo: {
            'a': longFill({ q: 0.020, v: 2000, pr: 100000 }),
            'b': shortFill({ q: -0.005, v: 500, pr: 100000 }),
          },
        }),
      },
    })).positions.positions;

    const out = deriveHsPositionsByCoin(positions, { BTC: '100000' }, {});
    expect(out.BTC.quantity).toBeCloseTo(0.015);
    expect(out.BTC.value).toBeCloseTo(1500);
    expect(out.BTC.side).toBe('long');
  });
});

describe('deriveHsPositionsByCoin — fallback when q is absent', () => {
  it('LONG fill without q: signed quantity = +|v|/pr', () => {
    const positions = transformTraderResponse(makeRawDashboard({
      positions: {
        'u1': makeRawPosition({
          tp: 'BTC/USDC',
          fo: { 'a': { t: 'LONG', v: 1500, pr: 100000 } },  // no q
        }),
      },
    })).positions.positions;

    const out = deriveHsPositionsByCoin(positions, { BTC: '100000' }, {});
    expect(out.BTC.quantity).toBeCloseTo(0.015);   // 1500/100000
    expect(out.BTC.value).toBeCloseTo(1500);
    expect(out.BTC.side).toBe('long');
  });

  it('SHORT fill without q: signed quantity = -|v|/pr', () => {
    const positions = transformTraderResponse(makeRawDashboard({
      positions: {
        'u1': makeRawPosition({
          tp: 'ETH/USDC',
          fo: { 'a': { t: 'SHORT', v: 1000, pr: 2000 } },  // no q
        }),
      },
    })).positions.positions;

    const out = deriveHsPositionsByCoin(positions, { ETH: '2000' }, {});
    expect(out.ETH.quantity).toBeCloseTo(-0.5);   // -1000/2000
    expect(out.ETH.side).toBe('short');
  });

  it('mixed fills: q present on one, absent on another', () => {
    const positions = transformTraderResponse(makeRawDashboard({
      positions: {
        'u1': makeRawPosition({
          tp: 'BTC/USDC',
          fo: {
            'a': longFill({ q: 0.010, v: 1000, pr: 100000 }),
            'b': { t: 'LONG', v: 500, pr: 100000 },     // q absent → derives 0.005
          },
        }),
      },
    })).positions.positions;

    const out = deriveHsPositionsByCoin(positions, { BTC: '100000' }, {});
    expect(out.BTC.quantity).toBeCloseTo(0.015);
    expect(out.BTC.value).toBeCloseTo(1500);
  });

  it('fill with neither q nor v/pr → contributes 0 (skipped silently)', () => {
    const positions = transformTraderResponse(makeRawDashboard({
      positions: {
        'u1': makeRawPosition({
          tp: 'BTC/USDC',
          fo: {
            'a': longFill({ q: 0.010, v: 1000, pr: 100000 }),
            'b': { t: 'LONG' },  // no q, no v/pr
          },
        }),
      },
    })).positions.positions;

    const out = deriveHsPositionsByCoin(positions, { BTC: '100000' }, {});
    expect(out.BTC.quantity).toBeCloseTo(0.010);
  });

  it('fallback uses pr=0 → fill ignored (avoid div by zero)', () => {
    const positions = transformTraderResponse(makeRawDashboard({
      positions: {
        'u1': makeRawPosition({
          tp: 'BTC/USDC',
          fo: {
            'a': longFill({ q: 0.010, v: 1000, pr: 100000 }),
            'b': { t: 'LONG', v: 500, pr: 0 },
          },
        }),
      },
    })).positions.positions;

    const out = deriveHsPositionsByCoin(positions, { BTC: '100000' }, {});
    expect(out.BTC.quantity).toBeCloseTo(0.010);
  });
});

describe('deriveHsPositionsByCoin — closed / dust / missing-price filters', () => {
  it('closed position (c set) skipped', () => {
    const positions = transformTraderResponse(makeRawDashboard({
      positions: {
        'u1': makeRawPosition({
          tp: 'BTC/USDC',
          c: 1714000000,                        // closed
          fo: { 'a': longFill({ q: 0.015, v: 1500, pr: 100000 }) },
        }),
      },
    })).positions.positions;

    const out = deriveHsPositionsByCoin(positions, { BTC: '100000' }, {});
    expect(out.BTC).toBeUndefined();
  });

  it('dust position (|sum q| < 1e-12) skipped', () => {
    const positions = transformTraderResponse(makeRawDashboard({
      positions: {
        'u1': makeRawPosition({
          tp: 'BTC/USDC',
          fo: {
            'a': longFill({ q: 1e-15, v: 1e-10, pr: 100000 }),
          },
        }),
      },
    })).positions.positions;

    const out = deriveHsPositionsByCoin(positions, { BTC: '100000' }, {});
    expect(out.BTC).toBeUndefined();
  });

  it('long+short fills that net exactly to zero → skipped (no residual key)', () => {
    const positions = transformTraderResponse(makeRawDashboard({
      positions: {
        'u1': makeRawPosition({
          tp: 'BTC/USDC',
          fo: {
            'a': longFill({ q: 0.010, v: 1000, pr: 100000 }),
            'b': shortFill({ q: -0.010, v: 1000, pr: 100000 }),
          },
        }),
      },
    })).positions.positions;

    const out = deriveHsPositionsByCoin(positions, { BTC: '100000' }, {});
    expect(out.BTC).toBeUndefined();
  });

  it('missing mid price → position skipped (no fabricated value)', () => {
    const positions = transformTraderResponse(makeRawDashboard({
      positions: {
        'u1': makeRawPosition({
          tp: 'BTC/USDC',
          fo: { 'a': longFill({ q: 0.015, v: 1500, pr: 100000 }) },
        }),
      },
    })).positions.positions;

    // midPrices empty → no price for BTC → position skipped
    const out = deriveHsPositionsByCoin(positions, {}, {});
    expect(out.BTC).toBeUndefined();
  });

  it('zero mid price → position skipped (treated as missing)', () => {
    const positions = transformTraderResponse(makeRawDashboard({
      positions: {
        'u1': makeRawPosition({
          tp: 'BTC/USDC',
          fo: { 'a': longFill({ q: 0.015, v: 1500, pr: 100000 }) },
        }),
      },
    })).positions.positions;

    const out = deriveHsPositionsByCoin(positions, { BTC: '0' }, {});
    expect(out.BTC).toBeUndefined();
  });

  it('non-array positions input → empty object', () => {
    expect(deriveHsPositionsByCoin(null, { BTC: '100000' }, {})).toEqual({});
    expect(deriveHsPositionsByCoin(undefined, {}, {})).toEqual({});
    expect(deriveHsPositionsByCoin('not-array', {}, {})).toEqual({});
  });
});

describe('deriveHsPositionsByCoin — HIP-3 friendly→hl_coin mapping', () => {
  it('WTIOIL position resolves price via friendlyToHl["WTIOIL"] = "XYZ:CL"', () => {
    const positions = transformTraderResponse(makeRawDashboard({
      positions: {
        'u1': makeRawPosition({
          tp: 'WTIOIL/USDC',
          fo: { 'a': longFill({ q: 10, v: 700, pr: 70 }) },
        }),
      },
    })).positions.positions;

    const friendlyToHl = { WTIOIL: 'XYZ:CL' };
    const midPrices = { 'XYZ:CL': '72' };  // current mark
    const out = deriveHsPositionsByCoin(positions, midPrices, friendlyToHl);
    expect(out.WTIOIL.quantity).toBeCloseTo(10);
    expect(out.WTIOIL.value).toBeCloseTo(720);  // 10 × 72 (NOT entry × q)
    expect(out.WTIOIL.side).toBe('long');
  });

  it('falls back to coin key when friendlyToHl lacks an entry', () => {
    const positions = transformTraderResponse(makeRawDashboard({
      positions: {
        'u1': makeRawPosition({
          tp: 'BTC/USDC',
          fo: { 'a': longFill({ q: 0.015, v: 1500, pr: 100000 }) },
        }),
      },
    })).positions.positions;

    // friendlyToHl is empty; midPrices keyed by "BTC" should still resolve
    const out = deriveHsPositionsByCoin(positions, { BTC: '101000' }, {});
    expect(out.BTC.value).toBeCloseTo(1515);  // 0.015 × 101000
  });

  it('GOLD via friendly→XYZ:GOLD mapping', () => {
    const positions = transformTraderResponse(makeRawDashboard({
      positions: {
        'u1': makeRawPosition({
          tp: 'GOLD/USDC',
          fo: { 'a': longFill({ q: 2, v: 5300, pr: 2650 }) },
        }),
      },
    })).positions.positions;

    const friendlyToHl = { GOLD: 'XYZ:GOLD' };
    const out = deriveHsPositionsByCoin(positions, { 'XYZ:GOLD': '2700' }, friendlyToHl);
    expect(out.GOLD.value).toBeCloseTo(5400);  // 2 × 2700 (current mark, not entry)
  });
});

describe('deriveHsPositionsByCoin — multi-position aggregation', () => {
  it('multiple coins: BTC + WTIOIL each derived independently', () => {
    const positions = transformTraderResponse(makeRawDashboard({
      positions: {
        'btc-1': makeRawPosition({
          tp: 'BTC/USDC',
          fo: { 'a': longFill({ q: 0.015, v: 1500, pr: 100000 }) },
        }),
        'wti-1': makeRawPosition({
          tp: 'WTIOIL/USDC',
          fo: { 'a': longFill({ q: 10, v: 700, pr: 70 }) },
        }),
      },
    })).positions.positions;

    const friendlyToHl = { WTIOIL: 'XYZ:CL' };
    const midPrices = { BTC: '100000', 'XYZ:CL': '72' };
    const out = deriveHsPositionsByCoin(positions, midPrices, friendlyToHl);

    expect(out.BTC.value).toBeCloseTo(1500);
    expect(out.WTIOIL.value).toBeCloseTo(720);
  });

  it('BTC long + ETH short: each gets correct side', () => {
    const positions = transformTraderResponse(makeRawDashboard({
      positions: {
        'btc-1': makeRawPosition({
          tp: 'BTC/USDC',
          fo: { 'a': longFill({ q: 0.015, v: 1500, pr: 100000 }) },
        }),
        'eth-1': makeRawPosition({
          tp: 'ETH/USDC',
          fo: { 'a': shortFill({ q: -0.5, v: 1000, pr: 2000 }) },
        }),
      },
    })).positions.positions;

    const out = deriveHsPositionsByCoin(positions, { BTC: '100000', ETH: '2000' }, {});
    expect(out.BTC.side).toBe('long');
    expect(out.ETH.side).toBe('short');
    expect(out.BTC.value).toBeCloseTo(1500);
    expect(out.ETH.value).toBeCloseTo(1000);  // abs
  });

  it('open + closed for same coin: only open contributes', () => {
    const positions = transformTraderResponse(makeRawDashboard({
      positions: {
        'open-btc': makeRawPosition({
          tp: 'BTC/USDC',
          fo: { 'a': longFill({ q: 0.015, v: 1500, pr: 100000 }) },
        }),
        'closed-btc': makeRawPosition({
          tp: 'BTC/USDC',
          c: 1714000000,
          fo: { 'a': longFill({ q: 0.5, v: 50000, pr: 100000 }) },
        }),
      },
    })).positions.positions;

    const out = deriveHsPositionsByCoin(positions, { BTC: '100000' }, {});
    expect(out.BTC.value).toBeCloseTo(1500);  // closed position ignored
  });

  it('value uses current mid price, not entry price', () => {
    // Entry was at $100k, but current mid is $110k. Value should reflect current.
    const positions = transformTraderResponse(makeRawDashboard({
      positions: {
        'btc-1': makeRawPosition({
          tp: 'BTC/USDC',
          fo: { 'a': longFill({ q: 0.015, v: 1500, pr: 100000 }) },
        }),
      },
    })).positions.positions;

    const out = deriveHsPositionsByCoin(positions, { BTC: '110000' }, {});
    expect(out.BTC.value).toBeCloseTo(1650);  // 0.015 × 110000
  });
});

// ─── Validator key normalization ─────────────────────────────────────────────

describe('coin key consistency (validator vs HL after remap)', () => {
  it('validator WTIOIL key matches HL remapped key (both resolve to WTIOIL)', () => {
    // Validator stores key "WTIOIL" (from trade_pair "WTIOIL/USDC")
    // HL data stores key "XYZ:CL", remapped to "WTIOIL" via hlCoinToDisplay
    // Both should produce the same key for cap lookups
    const validatorKey = extractCoinFromTradePair('WTIOIL/USDC');  // → "WTIOIL"
    const hlKey = 'XYZ:CL';
    const hlCoinToDisplay = { 'XYZ:CL': 'WTIOIL' };
    const remappedHlKey = hlCoinToDisplay[hlKey] || hlKey;         // → "WTIOIL"

    expect(validatorKey).toBe('WTIOIL');
    expect(remappedHlKey).toBe('WTIOIL');
    expect(validatorKey).toBe(remappedHlKey);
  });
});

// ─── resolveChallengeModeFromValidator ───────────────────────────────────────

describe('resolveChallengeModeFromValidator', () => {
  it('SUBACCOUNT_FUNDED bucket → funded (false)', () => {
    expect(resolveChallengeModeFromValidator({ challenge_period: { bucket: 'SUBACCOUNT_FUNDED' } })).toBe(false);
  });

  it('SUBACCOUNT_CHALLENGE bucket → challenge (true)', () => {
    expect(resolveChallengeModeFromValidator({ challenge_period: { bucket: 'SUBACCOUNT_CHALLENGE' } })).toBe(true);
  });

  it('SUBACCOUNT_EVAL bucket → challenge (true)', () => {
    expect(resolveChallengeModeFromValidator({ challenge_period: { bucket: 'SUBACCOUNT_EVAL' } })).toBe(true);
  });

  it('no bucket (new trader, status "active") → challenge assumed (true)', () => {
    expect(resolveChallengeModeFromValidator({ challenge_period: null })).toBe(true);
    expect(resolveChallengeModeFromValidator({})).toBe(true);
  });
});

// ─── drawdown transformation ──────────────────────────────────────────────────

describe('transformTraderResponse — drawdown', () => {
  it('converts decimal thresholds to percentages', () => {
    const raw = makeRawDashboard();
    raw.dashboard.drawdown = {
      intraday_drawdown_threshold: 0.05,
      eod_drawdown_threshold: 0.05,
      intraday_drawdown_pct: 2.5,
      eod_drawdown_pct: 1.0,
    };
    const { drawdown } = transformTraderResponse(raw);
    expect(drawdown.intraday_threshold_pct).toBeCloseTo(5);
    expect(drawdown.eod_threshold_pct).toBeCloseTo(5);
  });

  it('calculates usage pct from drawdown/threshold', () => {
    const raw = makeRawDashboard();
    raw.dashboard.drawdown = {
      intraday_drawdown_threshold: 0.05,
      eod_drawdown_threshold: 0.05,
      intraday_drawdown_pct: 2.5,
      eod_drawdown_pct: 1.0,
    };
    const { drawdown } = transformTraderResponse(raw);
    // 2.5 / 5 * 100 = 50%
    expect(drawdown.intraday_usage_pct).toBeCloseTo(50);
    // 1.0 / 5 * 100 = 20%
    expect(drawdown.eod_usage_pct).toBeCloseTo(20);
  });

  it('usage pct = 0 when threshold is 0 (avoid divide-by-zero)', () => {
    const raw = makeRawDashboard();
    raw.dashboard.drawdown = {
      intraday_drawdown_threshold: 0,
      eod_drawdown_threshold: 0,
      intraday_drawdown_pct: 2.5,
      eod_drawdown_pct: 1.0,
    };
    const { drawdown } = transformTraderResponse(raw);
    expect(drawdown.intraday_usage_pct).toBe(0);
    expect(drawdown.eod_usage_pct).toBe(0);
  });

  it('null drawdown → null in result', () => {
    const raw = makeRawDashboard();
    const { drawdown } = transformTraderResponse(raw);
    expect(drawdown).toBeNull();
  });
});
