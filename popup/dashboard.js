import { fmtUsd } from './format.js';
import { showDashboard } from './screens.js';

const CHALLENGE_TARGET = 10;
const DRAWDOWN_MAX = 5;

// DD-aligned severity scale: teal < 70% → amber 70–90% → red ≥ 90% or breached.
// Same colors as banner ddColor() and the injected mirror preview, so capacity
// proximity-to-cap reads consistently across surfaces.
function capColor(pct) {
    if (pct >= 90) return 'rgb(239, 68, 68)';
    if (pct >= 70) return '#ffb900';
    return '#00c6a7';
}

// Pending overlay = resting limit orders. Stripe pattern (hypothetical) with
// the severity color of the after-fill %.
function pendingStripeBg(pct) {
    let strong, weak;
    if (pct >= 90)      { strong = 'rgba(239, 68, 68, 0.55)';  weak = 'rgba(239, 68, 68, 0.18)';  }
    else if (pct >= 70) { strong = 'rgba(255, 185, 0, 0.55)';  weak = 'rgba(255, 185, 0, 0.18)';  }
    else                { strong = 'rgba(0, 198, 167, 0.55)';  weak = 'rgba(0, 198, 167, 0.18)';  }
    return `repeating-linear-gradient(45deg, ${strong}, ${strong} 4px, ${weak} 4px, ${weak} 8px)`;
}

// Reduce overlay (pending closes part of position) — flat teal stripe at a
// lower opacity matching the mirror preview's "fading away" cue.
const REDUCE_STRIPE_POPUP =
    'repeating-linear-gradient(135deg, ' +
    'rgba(0, 198, 167, 0.55), rgba(0, 198, 167, 0.55) 2px, ' +
    'rgba(0, 198, 167, 0.15) 2px, rgba(0, 198, 167, 0.15) 4px)';

// Vanta API pairs are USDC-quoted on HL. Suffix `/USDC` so the trader can
// distinguish from (unmirrored) USDT pairs they may also hold on HL.
function formatPairLabel(coin) {
    return `${coin}/USDC`;
}

// Project one pair's after-fill state, given current SIGNED exposure (long > 0,
// short < 0) and (buy-only) pending notional, both in HF units. Mirrors the
// branch logic in content/mirror-preview.js: add / reduce / flip / new.
//
// Pending feeds in as a positive scalar because background's
// extractPendingBuyNotional only emits buy-side resting orders. Sells aren't
// captured at all — the existing comment there says they "reduce or short
// exposure and signedNotionalByPair handles those directions correctly", but
// for the popup we still get only the buy half. That's why a short + buy
// pending must be treated as REDUCE / FLIP, not as additional exposure.
function projectPairAfterFill(currentSigned, pendingBuy, pairCap, portfolioRoom) {
    const currentMag = Math.abs(currentSigned);
    const deltaSigned = +pendingBuy;            // buy-side
    const signedAfter = currentSigned + deltaSigned;
    const afterMagRaw = Math.abs(signedAfter);

    let branch;
    if (currentMag < 0.01) branch = 'new';
    else if ((currentSigned > 0) === (deltaSigned > 0)) branch = 'add';
    else if (deltaSigned <= currentMag + 0.01) branch = 'reduce';
    else branch = 'flip';

    let afterMag = currentMag;
    let pairCapBinds = false;
    let portCapBinds = false;

    if (branch === 'new' || branch === 'add') {
        let target = afterMagRaw;
        if (pairCap > 0 && target > pairCap + 0.01) {
            target = pairCap;
            pairCapBinds = true;
        }
        let growth = Math.max(0, target - currentMag);
        if (portfolioRoom >= 0 && growth > portfolioRoom + 0.01) {
            growth = portfolioRoom;
            portCapBinds = true;
        }
        afterMag = currentMag + growth;
    } else if (branch === 'reduce') {
        afterMag = afterMagRaw;
    } else { // flip
        let newSize = afterMagRaw;
        if (pairCap > 0 && newSize > pairCap + 0.01) {
            newSize = pairCap;
            pairCapBinds = true;
        }
        const portfolioDelta = -currentMag + newSize;
        if (portfolioDelta > 0 && portfolioRoom >= 0 && portfolioDelta > portfolioRoom + 0.01) {
            newSize = currentMag + portfolioRoom;
            portCapBinds = true;
        }
        afterMag = newSize;
    }

    return { branch, currentMag, afterMag, pairCapBinds, portCapBinds };
}

export function applyValidatorData(result, state) {
    const accountSize = result.account_size || 0;

    const accountSizeData = result.account_size_data;

    // Live HF balance (drawdown-adjusted) — base for limits and mirror sizing.
    // When the validator hasn't returned it we show "--" downstream rather
    // than fall back to accountSize, which is frozen at the funded amount and
    // would silently produce wrong limit/PnL numbers after any P&L.
    const balanceField = parseFloat(accountSizeData?.balance);
    const accountBalance = Number.isFinite(balanceField) && balanceField > 0 ? balanceField : null;

    // Total unrealized PnL is sourced from HL's clearinghouseState (sum of
    // each position's `unrealizedPnl`, plumbed through state.totalUnrealizedPnl).
    // null until HL has returned — top-of-popup PnL row then shows "--".
    // We deliberately do NOT derive this from the validator's
    // `current_return × account_size` — `account_size` is the frozen funded
    // amount, not the trader's current equity, so any non-trivial P&L makes
    // the result wrong.
    const upnlField = parseFloat(state.totalUnrealizedPnl);
    const totalUnrealizedPnl = Number.isFinite(upnlField) ? upnlField : null;

    // HF per-coin position values come pre-computed from background as
    // strict size × price (sum of signed `q` × current HL mid price).
    // Used below for the HF row (actual capped values), not HL × ratio.
    state.hfPositionsByCoin = (result.hfPositionsByCoin && typeof result.hfPositionsByCoin === 'object')
      ? result.hfPositionsByCoin : {};

    const cp = result.challenge_period || {};
    const dd = result.drawdown || {};
    const currentEquity = parseFloat(dd.current_equity) || 1;
    // HF Account balance must come from account_size_data.balance — that is
    // realized PnL only (per the validator's transform: balance ≈ account_size
    // + total_realized_pnl − fees). Falling back to accountSize × currentEquity
    // mixes in unrealized PnL via current_equity's ratio, producing a wrong
    // number labelled "balance". Show "--" instead when the field is missing.
    const validatorEquity = accountBalance;
    const returnsPct = (currentEquity - 1) * 100;
    const targetPct = CHALLENGE_TARGET;
    const challengeCompletionPct = targetPct > 0 ? Math.min((returnsPct / targetPct) * 100, 100) : 0;
    const inChallenge = cp.bucket !== 'SUBACCOUNT_FUNDED';

    const drawdownPct = parseFloat(dd.intraday_drawdown_pct) || 0;
    const drawdownLimitPct = parseFloat(dd.intraday_threshold_pct) || DRAWDOWN_MAX;
    const drawdownUsagePct = parseFloat(dd.intraday_usage_pct) || 0;
    const trailingDrawdownPct = parseFloat(dd.eod_drawdown_pct) || 0;
    const trailingDrawdownLimitPct = parseFloat(dd.eod_threshold_pct) || DRAWDOWN_MAX;
    const trailingDrawdownUsagePct = parseFloat(dd.eod_usage_pct) || 0;

    const fundedBalanceEl = document.getElementById('fundedBalance');
    if (fundedBalanceEl) fundedBalanceEl.textContent = validatorEquity == null ? '--' : fmtUsd(validatorEquity);
    const hlBalanceHeaderEl = document.getElementById('hlBalanceHeader');
    if (hlBalanceHeaderEl) hlBalanceHeaderEl.textContent = validatorEquity == null ? '--' : fmtUsd(validatorEquity);

    const fundedChangeEl = document.getElementById('fundedChange');
    if (fundedChangeEl) {
        if (totalUnrealizedPnl == null) {
            fundedChangeEl.textContent = '-- (--%)';
            const changeParent = fundedChangeEl.closest('.balance-change');
            if (changeParent) changeParent.className = 'balance-change';
        } else {
            const sign = totalUnrealizedPnl >= 0 ? '+' : '';
            const pnlPct = accountBalance != null ? (totalUnrealizedPnl / accountBalance) * 100 : null;
            const pctText = pnlPct == null ? '--' : `${sign}${pnlPct.toFixed(2)}%`;
            fundedChangeEl.textContent = `${sign}${fmtUsd(totalUnrealizedPnl)} (${pctText})`;
            const changeParent = fundedChangeEl.closest('.balance-change');
            if (changeParent) {
                changeParent.className = 'balance-change ' + (totalUnrealizedPnl >= 0 ? 'positive' : 'negative');
            }
        }
    }

    const statusBadge = document.querySelector('.status-badge');
    if (statusBadge) {
        statusBadge.textContent = inChallenge ? 'In Challenge' : 'Funded';
    }

    const challengeValueEl = document.getElementById('challengeValue');
    const challengeFillEl = document.getElementById('challengeFill');
    const challengeLabelEl = document.getElementById('challengeLabel');
    if (challengeValueEl) challengeValueEl.textContent = `${returnsPct.toFixed(2)}% / ${targetPct}%`;
    if (challengeFillEl) {
        challengeFillEl.style.width = Math.min(challengeCompletionPct, 100) + '%';
    }
    if (challengeLabelEl) {
        const remainingPct = targetPct - returnsPct;
        const remainingDollar = accountSize * (remainingPct / 100);
        challengeLabelEl.textContent = remainingPct > 0
            ? `${fmtUsd(remainingDollar)} to target (${targetPct}% goal)`
            : 'Target reached!';
    }

    const dailyDrawdownValueEl = document.getElementById('dailyDrawdownValue');
    const trailingDrawdownValueEl = document.getElementById('trailingDrawdownValue');
    const dailyDrawdownFillEl = document.getElementById('dailyDrawdownFill');
    const trailingDrawdownFillEl = document.getElementById('trailingDrawdownFill');
    const drawdownLabelEl = document.getElementById('drawdownLabel');
    if (dailyDrawdownValueEl) {
        dailyDrawdownValueEl.textContent = `${drawdownPct.toFixed(3)}% / ${drawdownLimitPct.toFixed(0)}%`;
    }
    if (trailingDrawdownValueEl) {
        trailingDrawdownValueEl.textContent = `${trailingDrawdownPct.toFixed(3)}% / ${trailingDrawdownLimitPct.toFixed(0)}%`;
    }
    if (dailyDrawdownFillEl) {
        dailyDrawdownFillEl.style.width = Math.min(drawdownUsagePct, 100) + '%';
        dailyDrawdownFillEl.style.background =
            drawdownUsagePct > 80 ? 'var(--red)' : drawdownUsagePct > 50 ? 'var(--amber)' : '';
    }
    if (trailingDrawdownFillEl) {
        trailingDrawdownFillEl.style.width = Math.min(trailingDrawdownUsagePct, 100) + '%';
        trailingDrawdownFillEl.style.background =
            trailingDrawdownUsagePct > 80 ? 'var(--red)' : trailingDrawdownUsagePct > 50 ? 'var(--amber)' : '';
    }
    if (drawdownLabelEl) {
        // The drawdown rules are checked against day-open equity (Rule 1) and
        // EOD high-water mark (Rule 2), not the starting funded size. The
        // validator publishes both as ratios on the starting size; multiply
        // through to get $.
        const dayOpenRatio = parseFloat(dd.daily_open_equity);
        const hwmRatio = parseFloat(dd.eod_hwm);
        const dayOpenUsd = (accountSize > 0 && Number.isFinite(dayOpenRatio) && dayOpenRatio > 0)
            ? accountSize * dayOpenRatio : null;
        const hwmUsd = (accountSize > 0 && Number.isFinite(hwmRatio) && hwmRatio > 0)
            ? accountSize * hwmRatio : null;
        const dailyBufferPct = drawdownLimitPct - drawdownPct;
        const trailingBufferPct = trailingDrawdownLimitPct - trailingDrawdownPct;
        const dailyBufferText = dayOpenUsd == null
            ? '--'
            : fmtUsd(Math.max(dayOpenUsd * (dailyBufferPct / 100), 0));
        const trailingBufferText = hwmUsd == null
            ? '--'
            : fmtUsd(Math.max(hwmUsd * (trailingBufferPct / 100), 0));
        drawdownLabelEl.textContent =
            `Intraday ${dailyBufferText} (${dailyBufferPct.toFixed(2)}%) · ` +
            `EOD trailing ${trailingBufferText} (${trailingBufferPct.toFixed(2)}%) buffer`;
    }

    // ── Mirror ratio (used by HF capacity block) ───────────────────────────────
    // Numerator is live HF balance (drawdown-adjusted), not starting size, so
    // the ratio reflects the trader's current equity rather than what they
    // originally funded. Falls to 0 when accountBalance is unavailable —
    // downstream HF-column UI shows "--" via the existing `r > 0` checks.
    const hlBal = Number(state.hlBalance) || 0;
    const mirrorRatio = (hlBal > 0 && accountBalance != null) ? accountBalance / hlBal : 0;

    // HL pending orders are still needed: validator records pending only at
    // fill time, so projecting "what would HF look like if all HL pending
    // fills" requires the HL resting-order notional × ratio.
    const pendingByPairHl = state.pendingNotionalByPair || {};
    const pendingTotalHl  = Number(state.pendingTotal) || 0;

    // The "HL" capacity block was removed — HL has no caps post-faca41c, and
    // a bar with no real cap was misleading. Anything HL-related the trader
    // needs is on HL's own UI (or the injected mirror preview at order entry).
    // The HF section below is the only capacity surface that maps to a real
    // validator-enforced limit.

    // ── Trading Capacity (HyperFunded) — validator-enforced caps ────────────
    // Every $ figure in this section depends on mirrorRatio. When it is 0
    // (accountBalance unavailable) we cannot compute honest HF values, so
    // render "--" rather than a misleading $0.00.
    const r = mirrorRatio;
    const hfAvailable = r > 0;
    // HF-side caps track live accountBalance. The validator's static USD
    // figures (max_*_usd = ratio × starting account_size) are converted to
    // the equivalent leverage ratio and re-applied to live accountBalance.
    let hfMaxPerPair = 0;
    let hfMaxTotal   = 0;
    if (hfAvailable && state.traderLimits) {
        const backendPair = parseFloat(state.traderLimits.max_position_per_pair_usd) || 0;
        const backendTotal = parseFloat(state.traderLimits.max_portfolio_usd) || 0;
        const backendSize = parseFloat(state.traderLimits.account_size) || accountSize || 0;
        if (backendSize > 0 && backendPair > 0)  hfMaxPerPair = (backendPair  / backendSize) * accountBalance;
        if (backendSize > 0 && backendTotal > 0) hfMaxTotal   = (backendTotal / backendSize) * accountBalance;
    }
    // ── HF row per-pair entries: filled from validator (actual size × price,
    // already capped by validator at fill time), pending projected from HL
    // resting orders × ratio (since HL pending hasn't filled, validator has
    // no record of it yet). Union the keysets so a coin that's open on the
    // validator but momentarily missing on the HL pending list still shows.
    const hfPositionsMap = state.hfPositionsByCoin || {};
    const hfPerAssetSyms = new Set([
        ...Object.keys(hfPositionsMap),
        ...Object.keys(pendingByPairHl),
    ]);
    const hfPerAssetEntries = Array.from(hfPerAssetSyms)
        .map((sym) => {
            const pos = hfPositionsMap[sym];
            const mag = Math.abs(Number(pos?.value) || 0);
            const qty = Number(pos?.quantity) || 0;
            const sideSign = qty >= 0 ? 1 : -1;
            return {
                sym: String(sym).toUpperCase(),
                hfFilled: mag,
                hfSignedFilled: sideSign * mag,
                hfPending: hfAvailable ? (Number(pendingByPairHl[sym]) || 0) * r : 0,
            };
        })
        .filter(({ hfFilled, hfPending }) => hfFilled + hfPending > 0)
        .sort((a, b) => (b.hfFilled + b.hfPending) - (a.hfFilled + a.hfPending));

    const hfLargestPairNotional = hfPerAssetEntries.length > 0
        ? Math.max(...hfPerAssetEntries.map(e => e.hfFilled))
        : 0;
    const hfFilledTotal = Object.values(hfPositionsMap).reduce(
        (s, e) => s + Math.abs(Number(e?.value) || 0), 0);
    const hfPendingTotal = hfAvailable ? pendingTotalHl * r : 0;

    const hfBasisRatioEl = document.getElementById('hfBasisRatio');
    const hfBasisValueEl = document.getElementById('hfBasisValue');
    const hfBasisHlEquityEl = document.getElementById('hfBasisHlEquity');
    if (hfBasisRatioEl) hfBasisRatioEl.textContent = hfAvailable ? r.toFixed(1) + 'x' : '--';
    if (hfBasisValueEl) hfBasisValueEl.textContent = accountBalance == null ? '--' : fmtUsd(accountBalance);
    if (hfBasisHlEquityEl) hfBasisHlEquityEl.textContent = hlBal > 0 ? fmtUsd(hlBal) : '--';

    const hfPerPairRemainingEl = document.getElementById('hfPerPairRemaining');
    if (hfPerPairRemainingEl) hfPerPairRemainingEl.textContent = hfAvailable
        ? fmtUsd(Math.max(hfMaxPerPair - hfLargestPairNotional, 0))
        : '--';

    // Portfolio-level room — passed to per-pair projection so each pair's
    // growth respects the shared portfolio cap. The per-pair branch logic
    // (add / reduce / flip) handles pending direction vs current position
    // direction so a buy pending against a short doesn't double-count as
    // additional exposure — it offsets first.
    const portfolioRoom = hfAvailable ? Math.max(0, hfMaxTotal - hfFilledTotal) : 0;

    // Project once per pair so per-asset and total rows stay consistent.
    const hfProjections = hfAvailable
        ? hfPerAssetEntries.map((e) => ({
            ...e,
            ...projectPairAfterFill(e.hfSignedFilled, e.hfPending, hfMaxPerPair, portfolioRoom),
        }))
        : [];

    const hfPerPairSubBarsEl = document.getElementById('hfPerPairSubBars');
    if (hfPerPairSubBarsEl) {
        if (hfProjections.length === 0) {
            hfPerPairSubBarsEl.innerHTML = '';
        } else {
            hfPerPairSubBarsEl.innerHTML = hfProjections.map(({ sym, hfFilled, branch, currentMag, afterMag, pairCapBinds, portCapBinds }) => {
                const filledPct = hfMaxPerPair > 0 ? Math.min((currentMag / hfMaxPerPair) * 100, 100) : 0;
                const afterPct  = hfMaxPerPair > 0 ? Math.min((afterMag   / hfMaxPerPair) * 100, 100) : 0;

                // Bar segments (mirror-preview branch logic):
                //   add/new : solid = current,   overlay = after − current  (growth)
                //   reduce  : solid = after,     overlay = current − after  (closing tail, striped)
                //   flip    : solid = after,     overlay = 0                (jumps to new side)
                let solidPct, overlayPct, isReduce;
                if (branch === 'reduce') {
                    solidPct = afterPct;
                    overlayPct = Math.max(0, filledPct - afterPct);
                    isReduce = true;
                } else if (branch === 'flip') {
                    solidPct = afterPct;
                    overlayPct = 0;
                    isReduce = false;
                } else {
                    solidPct = filledPct;
                    overlayPct = Math.max(0, afterPct - filledPct);
                    isReduce = false;
                }

                const safeSymbol = sym.replace(/[^A-Z0-9._-]/g, '');
                const display    = formatPairLabel(safeSymbol);
                const isOver     = hfMaxPerPair > 0 && currentMag > hfMaxPerPair;

                const fillBg     = isOver ? 'rgb(239, 68, 68)' : capColor(solidPct);
                const pendingBg  = isReduce ? REDUCE_STRIPE_POPUP : pendingStripeBg(isOver ? 100 : afterPct);
                const pendingTextColor = capColor(isOver ? 100 : afterPct);

                const trackCls = isOver ? 'capacity-asset-track capacity-asset-track--over' : 'capacity-asset-track';
                const valueCls = isOver ? 'capacity-asset-value capacity-asset-value--over' : 'capacity-asset-value';

                // Pending text shows the net change in magnitude — what the
                // bar visually represents. Sign indicates direction: + for
                // adds/flips that grow exposure, − for reduces. Inserted
                // between filled and `/ cap` so the format reads as a math
                // expression: `$filled + $pending pending / $cap`.
                const magDelta = afterMag - currentMag;
                const wasCapped = pairCapBinds || portCapBinds;
                const cappedTag = wasCapped ? ' (capped)' : '';
                let pendingMid = '';
                if (Math.abs(magDelta) > 0.01) {
                    const sign = magDelta >= 0 ? '+' : '−';
                    pendingMid = ` <span class="capacity-asset-pending" style="color:${pendingTextColor}">${sign} ${fmtUsd(Math.abs(magDelta))} pending${cappedTag}</span>`;
                }

                return `
                    <div class="capacity-asset-row">
                        <span class="capacity-asset-symbol">${display}</span>
                        <div class="${trackCls}">
                            <div class="capacity-asset-fill" style="width: ${solidPct.toFixed(1)}%; background: ${fillBg};"></div>
                            <div class="capacity-asset-fill capacity-asset-fill--pending" style="width: ${overlayPct.toFixed(1)}%; left: ${solidPct.toFixed(1)}%; background: ${pendingBg};"></div>
                        </div>
                        <span class="${valueCls}">${fmtUsd(currentMag)}${pendingMid} / ${fmtUsd(hfMaxPerPair)}</span>
                    </div>
                `;
            }).join('');
        }
    }

    const hfPerPairBreakdownEl = document.getElementById('hfPerPairBreakdown');
    if (hfPerPairBreakdownEl) {
        if (!hfAvailable) {
            hfPerPairBreakdownEl.textContent = '--';
        } else if (hfPerAssetEntries.length === 0) {
            hfPerPairBreakdownEl.textContent = 'No open positions';
        } else {
            hfPerPairBreakdownEl.textContent = `${hfPerAssetEntries.length} asset${hfPerAssetEntries.length > 1 ? 's' : ''} with open exposure`;
        }
    }

    const hfCapacityUsedEl = document.getElementById('hfCapacityUsed');
    const hfCapacityMaxEl = document.getElementById('hfCapacityMax');
    const hfCapacityFillEl = document.getElementById('hfCapacityFill');
    const hfCapacityRemainingEl = document.getElementById('hfCapacityRemaining');
    const hfTotalOver = hfAvailable && hfMaxTotal > 0 && hfFilledTotal > hfMaxTotal;

    // Aggregate per-pair projections for the total row so reduce/flip pairs
    // don't inflate the bar by adding raw buy notional on top of the short.
    const hfAfterTotalRaw = hfProjections.reduce((s, p) => s + p.afterMag, 0);
    const hfAfterTotal = hfAvailable && hfMaxTotal > 0 ? Math.min(hfAfterTotalRaw, hfMaxTotal) : hfAfterTotalRaw;
    const totalDelta = hfAfterTotal - hfFilledTotal;
    const totalShrinks = totalDelta < -0.01;
    const totalGrows = totalDelta > 0.01;
    const totalCapped = hfProjections.some((p) => p.pairCapBinds || p.portCapBinds);

    const totalFilledPct = hfAvailable && hfMaxTotal > 0 ? Math.min((hfFilledTotal / hfMaxTotal) * 100, 100) : 0;
    const totalAfterPct  = hfAvailable && hfMaxTotal > 0 ? Math.min((hfAfterTotal  / hfMaxTotal) * 100, 100) : 0;

    let totalSolidPct, totalOverlayPct, totalIsReduce;
    if (totalShrinks) {
        totalSolidPct = totalAfterPct;
        totalOverlayPct = Math.max(0, totalFilledPct - totalAfterPct);
        totalIsReduce = true;
    } else {
        totalSolidPct = totalFilledPct;
        totalOverlayPct = Math.max(0, totalAfterPct - totalFilledPct);
        totalIsReduce = false;
    }

    if (hfCapacityUsedEl) {
        if (!hfAvailable) {
            hfCapacityUsedEl.textContent = '--';
        } else {
            const pendingTextColor = capColor(hfTotalOver ? 100 : totalAfterPct);
            const cappedTag = totalCapped ? ' (capped)' : '';
            let pendingMid = '';
            if (Math.abs(totalDelta) > 0.01) {
                const sign = totalDelta >= 0 ? '+' : '−';
                pendingMid = ` <span class="capacity-asset-pending" style="color:${pendingTextColor}">${sign} ${fmtUsd(Math.abs(totalDelta))} pending${cappedTag}</span>`;
            }
            hfCapacityUsedEl.innerHTML = `${fmtUsd(hfFilledTotal)}${pendingMid}`;
        }
    }
    if (hfCapacityMaxEl) hfCapacityMaxEl.textContent = hfAvailable ? fmtUsd(hfMaxTotal) : '--';
    if (hfCapacityFillEl) {
        hfCapacityFillEl.style.width = totalSolidPct + '%';
        hfCapacityFillEl.style.background = hfTotalOver ? 'rgb(239, 68, 68)' : capColor(totalSolidPct);
        hfCapacityFillEl.classList.toggle('capacity-fill--over', hfTotalOver);
        const hfTrackEl = hfCapacityFillEl.parentElement;
        if (hfTrackEl) hfTrackEl.classList.toggle('capacity-bar--over', hfTotalOver);
        let pendingEl = hfCapacityFillEl.parentElement?.querySelector('.capacity-fill--pending');
        if (hfCapacityFillEl.parentElement) {
            if (!pendingEl) {
                pendingEl = document.createElement('div');
                pendingEl.className = 'capacity-fill capacity-fill--pending';
                hfCapacityFillEl.parentElement.appendChild(pendingEl);
            }
            pendingEl.style.width = totalOverlayPct + '%';
            pendingEl.style.left = totalSolidPct + '%';
            pendingEl.style.background = totalIsReduce
                ? REDUCE_STRIPE_POPUP
                : pendingStripeBg(hfTotalOver ? 100 : totalAfterPct);
        }
    }
    if (hfCapacityRemainingEl) hfCapacityRemainingEl.textContent = hfAvailable
        ? fmtUsd(Math.max(hfMaxTotal - hfAfterTotal, 0))
        : '--';

    showDashboard();
    state.dashboardShown = true;
}
