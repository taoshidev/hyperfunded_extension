import { fmtUsd } from './format.js';
import { showDashboard } from './screens.js';

const CHALLENGE_TARGET = 10;

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

    // Live HS balance (drawdown-adjusted) — base for limits and mirror sizing.
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
    state.hsPositionsByCoin = (result.hsPositionsByCoin && typeof result.hsPositionsByCoin === 'object')
      ? result.hsPositionsByCoin : {};

    const cp = result.challenge_period || {};
    const dd = result.drawdown || {};
    // HS Account balance must come from account_size_data.balance — that is
    // realized PnL only (per the validator's transform: balance ≈ account_size
    // + total_realized_pnl − fees). Falling back to accountSize × current_equity
    // mixes in unrealized PnL via current_equity's ratio, producing a wrong
    // number labelled "balance". Show "--" instead when the field is missing.
    const validatorEquity = accountBalance;
    // Realized return on starting capital drives both the challenge progress
    // and the funded "Realized Return" readout. null when balance/size
    // unavailable → render "--", never a wrong number.
    const realizedReturnPct = (accountBalance != null && accountSize > 0)
        ? (accountBalance / accountSize - 1) * 100 : null;
    const targetPct = CHALLENGE_TARGET;
    const challengeCompletionPct = (realizedReturnPct != null && targetPct > 0)
        ? Math.min((realizedReturnPct / targetPct) * 100, 100) : 0;
    const inChallenge = cp.bucket !== 'SUBACCOUNT_FUNDED';

    const drawdownPct = parseFloat(dd.intraday_drawdown_pct) || 0;
    const trailingDrawdownPct = parseFloat(dd.eod_drawdown_pct) || 0;
    const drawdownUsagePct = parseFloat(dd.intraday_usage_pct) || 0;
    const trailingDrawdownUsagePct = parseFloat(dd.eod_usage_pct) || 0;
    // Thresholds come from the validator only — null when absent, rendered as
    // "--". Never fall back to a fixed number (funded EOD is 8%, not 5%).
    const intradayThr = parseFloat(dd.intraday_threshold_pct);
    const eodThr = parseFloat(dd.eod_threshold_pct);
    const drawdownLimitPct = Number.isFinite(intradayThr) && intradayThr > 0 ? intradayThr : null;
    const trailingDrawdownLimitPct = Number.isFinite(eodThr) && eodThr > 0 ? eodThr : null;

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

    // Funded accounts have no profit target: relabel the section, drop the
    // progress bar and goal label, and show plain realized return.
    const challengeTitleEl = document.getElementById('challengeSectionTitle');
    if (challengeTitleEl) challengeTitleEl.textContent = inChallenge ? 'Challenge Progress' : 'Realized Return';

    // Funded accounts have no target — the help text must not talk about
    // passing a challenge. Set both branches so an address switch re-renders it.
    const challengeInfoEl = document.getElementById('info-challengeProgress');
    if (challengeInfoEl) {
        challengeInfoEl.textContent = inChallenge
            ? "Shows how close you are to hitting your profit target. You need to reach a 10% return on your challenge account starting capital to pass the challenge. The bar fills as your return approaches the target. Once it reaches 100%, you've passed and move to a funded account."
            : "Your realized return on the funded account's starting capital — closed-trade P&L minus fees, as a percentage of your starting size. Funded accounts have no profit target.";
    }

    const challengeValueEl = document.getElementById('challengeValue');
    const challengeFillEl = document.getElementById('challengeFill');
    const challengeLabelEl = document.getElementById('challengeLabel');
    const returnText = realizedReturnPct == null ? '--' : `${realizedReturnPct.toFixed(2)}%`;
    if (challengeValueEl) {
        challengeValueEl.textContent = (inChallenge && realizedReturnPct != null)
            ? `${realizedReturnPct.toFixed(2)}% / ${targetPct}%`
            : returnText;
    }
    const challengeBarEl = challengeFillEl ? challengeFillEl.closest('.progress-bar') : null;
    const challengeLabelWrapEl = challengeLabelEl ? challengeLabelEl.closest('.progress-label') : null;
    if (challengeBarEl) challengeBarEl.style.display = inChallenge ? '' : 'none';
    if (challengeLabelWrapEl) challengeLabelWrapEl.style.display = inChallenge ? '' : 'none';
    if (challengeFillEl) {
        challengeFillEl.style.width = Math.min(challengeCompletionPct, 100) + '%';
    }
    if (challengeLabelEl && inChallenge) {
        if (realizedReturnPct == null) {
            challengeLabelEl.textContent = '--';
        } else {
            const remainingPct = targetPct - realizedReturnPct;
            const remainingDollar = accountSize * (remainingPct / 100);
            challengeLabelEl.textContent = remainingPct > 0
                ? `${fmtUsd(remainingDollar)} to target (${targetPct}% goal)`
                : 'Target reached!';
        }
    }

    const dailyDrawdownValueEl = document.getElementById('dailyDrawdownValue');
    const trailingDrawdownValueEl = document.getElementById('trailingDrawdownValue');
    const dailyDrawdownFillEl = document.getElementById('dailyDrawdownFill');
    const trailingDrawdownFillEl = document.getElementById('trailingDrawdownFill');
    const drawdownLabelEl = document.getElementById('drawdownLabel');
    if (dailyDrawdownValueEl) {
        dailyDrawdownValueEl.textContent = `${drawdownPct.toFixed(3)}% / ${drawdownLimitPct == null ? '--' : drawdownLimitPct.toFixed(0) + '%'}`;
    }
    if (trailingDrawdownValueEl) {
        trailingDrawdownValueEl.textContent = `${trailingDrawdownPct.toFixed(3)}% / ${trailingDrawdownLimitPct == null ? '--' : trailingDrawdownLimitPct.toFixed(0) + '%'}`;
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
        // Buffer needs the threshold; null threshold → "--", never a wrong figure.
        const dailyBufferPct = drawdownLimitPct == null ? null : drawdownLimitPct - drawdownPct;
        const trailingBufferPct = trailingDrawdownLimitPct == null ? null : trailingDrawdownLimitPct - trailingDrawdownPct;
        const dailyBufferText = (dayOpenUsd == null || dailyBufferPct == null)
            ? '--'
            : fmtUsd(Math.max(dayOpenUsd * (dailyBufferPct / 100), 0));
        const trailingBufferText = (hwmUsd == null || trailingBufferPct == null)
            ? '--'
            : fmtUsd(Math.max(hwmUsd * (trailingBufferPct / 100), 0));
        drawdownLabelEl.textContent =
            `Intraday ${dailyBufferText} (${dailyBufferPct == null ? '--' : dailyBufferPct.toFixed(2) + '%'}) · ` +
            `EOD trailing ${trailingBufferText} (${trailingBufferPct == null ? '--' : trailingBufferPct.toFixed(2) + '%'}) buffer`;
    }

    // ── Mirror ratio (used by HF capacity block) ───────────────────────────────
    // Numerator is live HS balance (drawdown-adjusted), not starting size, so
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

    // ── Trading Capacity (Hyperstack) — validator-enforced caps ────────────
    // Every $ figure in this section depends on mirrorRatio. When it is 0
    // (accountBalance unavailable) we cannot compute honest HF values, so
    // render "--" rather than a misleading $0.00.
    const r = mirrorRatio;
    const hsAvailable = r > 0;
    const capsAvailable = Number(accountBalance) > 0;
    // HS-side caps track live accountBalance. The validator's static USD
    // figures (max_*_usd = ratio × starting account_size) are converted to
    // the equivalent leverage ratio and re-applied to live accountBalance.
    let hsMaxPerPair = 0;
    let hsMaxTotal   = 0;
    let hsTier = null;
    const hsMaxByClass = {};
    if (capsAvailable && state.traderLimits) {
        const backendPair = parseFloat(state.traderLimits.max_position_per_pair_usd) || 0;
        const backendTotal = parseFloat(state.traderLimits.max_portfolio_usd) || 0;
        const backendSize = parseFloat(state.traderLimits.account_size) || accountSize || 0;
        if (backendSize > 0 && backendPair > 0)  hsMaxPerPair = (backendPair  / backendSize) * accountBalance;
        if (backendSize > 0 && backendTotal > 0) hsMaxTotal   = (backendTotal / backendSize) * accountBalance;
        // Challenge accounts are tier 1 by definition — derive when the
        // backend predates the tier field; funded tiers are not derived
        hsTier = Number.isInteger(state.traderLimits.tier) ? state.traderLimits.tier
            : state.traderLimits.in_challenge_period === true ? 1
            : null;
        for (const [cls, usd] of Object.entries(state.traderLimits.max_asset_class_usd || {})) {
            const v = parseFloat(usd);
            if (backendSize > 0 && Number.isFinite(v) && v > 0) hsMaxByClass[cls] = (v / backendSize) * accountBalance;
        }
    }
    // Per-pair cap from the pair's own tier multiplier; class-level figure as fallback
    const hsPairCapFor = (sym) => {
        const lev = Number(state.pairTierLeverage?.[sym]?.[hsTier]) || 0;
        return (lev > 0 && capsAvailable) ? lev * accountBalance : hsMaxPerPair;
    };
    // ── HS row per-pair entries: filled from validator (actual size × price,
    // already capped by validator at fill time), pending projected from HL
    // resting orders × ratio (since HL pending hasn't filled, validator has
    // no record of it yet). Union the keysets so a coin that's open on the
    // validator but momentarily missing on the HL pending list still shows.
    const hfPositionsMap = state.hsPositionsByCoin || {};
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

    const hsFilledTotal = Object.values(hsPositionsMap).reduce(
        (s, e) => s + Math.abs(Number(e?.value) || 0), 0);
    const hfPendingTotal = hfAvailable ? pendingTotalHl * r : 0;

    const hsBasisRatioEl = document.getElementById('hsBasisRatio');
    const hsBasisValueEl = document.getElementById('hsBasisValue');
    const hsBasisHlEquityEl = document.getElementById('hsBasisHlEquity');
    if (hsBasisRatioEl) hsBasisRatioEl.textContent = hsAvailable ? r.toFixed(1) + 'x' : '--';
    if (hsBasisValueEl) hsBasisValueEl.textContent = accountBalance == null ? '--' : fmtUsd(accountBalance);
    if (hsBasisHlEquityEl) hsBasisHlEquityEl.textContent = fmtUsd(Number(hlBal) || 0);

    // Portfolio-level room — passed to per-pair projection so each pair's
    // growth respects the shared portfolio cap. The per-pair branch logic
    // (add / reduce / flip) handles pending direction vs current position
    // direction so a buy pending against a short doesn't double-count as
    // additional exposure — it offsets first.
    const portfolioRoom = capsAvailable ? Math.max(0, hsMaxTotal - hsFilledTotal) : 0;

    // Class room shares the same budget semantics as portfolioRoom; Infinity = no class cap
    const hsClassCurrent = {};
    hsPerAssetEntries.forEach((e) => {
        const cls = state.pairCategory?.[e.sym];
        if (cls && hsMaxByClass[cls] != null) hsClassCurrent[cls] = (hsClassCurrent[cls] || 0) + e.hsFilled;
    });
    const hsClassRoomFor = (sym) => {
        const cls = state.pairCategory?.[sym];
        const cap = cls != null ? hsMaxByClass[cls] : null;
        return cap != null ? Math.max(0, cap - (hsClassCurrent[cls] || 0)) : Infinity;
    };

    // Project once per pair so per-asset and total rows stay consistent.
    const hsProjections = capsAvailable
        ? hsPerAssetEntries.map((e) => {
            const cap = hsPairCapFor(e.sym);
            return {
                ...e,
                cap,
                ...projectPairAfterFill(e.hsSignedFilled, e.hsPending, cap,
                    Math.min(portfolioRoom, hsClassRoomFor(e.sym))),
            };
        })
        : [];

    // ── Asset class sub-caps — shown only when /limits provides them ────────
    const hsClassRowEl = document.getElementById('hsClassRow');
    const hsClassSubBarsEl = document.getElementById('hsClassSubBars');
    if (hsClassRowEl && hsClassSubBarsEl) {
        const byClass = {};
        // One row per capped class that has at least one tradeable pair
        // (drops e.g. forex while no HL forex pairs exist), zero-usage included
        const tradeableClasses = new Set(Object.values(state.pairCategory || {}));
        for (const cls of Object.keys(hsMaxByClass)) {
            if (tradeableClasses.size > 0 && !tradeableClasses.has(cls)) continue;
            byClass[cls] = { current: 0, after: 0 };
        }
        hsProjections.forEach((p) => {
            const cls = state.pairCategory?.[p.sym];
            if (!cls || !byClass[cls]) return;
            byClass[cls].current += p.currentMag;
            byClass[cls].after += p.afterMag;
        });
        const classRows = Object.entries(byClass).sort((a, b) => b[1].after - a[1].after);
        if (!capsAvailable || classRows.length === 0) {
            hsClassRowEl.style.display = 'none';
            hsClassSubBarsEl.innerHTML = '';
        } else {
            hsClassRowEl.style.display = '';
            hsClassSubBarsEl.innerHTML = classRows.map(([cls, { current, after }]) => {
                const cap = hsMaxByClass[cls];
                // Each pair projects against the full class room independently, so
                // the summed `after` can exceed the cap. Clamp it: the validator
                // caps the class at fill time, so the excess never mirrors. The
                // bar fills to 100%, which conveys the cap without a text tag.
                const cappedAfter = Math.min(after, cap);
                const currentPct = Math.min((current / cap) * 100, 100);
                const afterPct   = Math.min((cappedAfter / cap) * 100, 100);
                const overlayPct = Math.max(0, afterPct - currentPct);
                const isOver = current > cap;
                const fillBg = isOver ? 'rgb(239, 68, 68)' : capColor(currentPct);
                const trackCls = isOver ? 'capacity-asset-track capacity-asset-track--over' : 'capacity-asset-track';
                const valueCls = isOver ? 'capacity-asset-value capacity-asset-value--over' : 'capacity-asset-value';
                const delta = cappedAfter - current;
                const pendingMid = Math.abs(delta) > 0.01
                    ? ` <span class="capacity-asset-pending" style="color:${capColor(afterPct)}">${delta >= 0 ? '+' : '−'} ${fmtUsd(Math.abs(delta))} pending</span>`
                    : '';
                return `
                    <div class="capacity-asset-row">
                        <span class="capacity-asset-symbol">${cls.toUpperCase().replace(/[^A-Z]/g, '')}</span>
                        <div class="${trackCls}">
                            <div class="capacity-asset-fill" style="width: ${currentPct.toFixed(1)}%; background: ${fillBg};"></div>
                            <div class="capacity-asset-fill capacity-asset-fill--pending" style="width: ${overlayPct.toFixed(1)}%; left: ${currentPct.toFixed(1)}%; background: ${pendingStripeBg(afterPct)};"></div>
                        </div>
                        <span class="${valueCls}">${fmtUsd(current)}${pendingMid} / ${fmtUsd(cap)}</span>
                    </div>
                `;
            }).join('');
        }
    }

    // Portfolio cap is tighter than the sum of class caps — show the note only
    // when class caps exist (i.e. the Asset Class row is visible).
    const hsPortfolioNoteEl = document.getElementById('hsPortfolioNote');
    if (hsPortfolioNoteEl) {
        hsPortfolioNoteEl.style.display = (hsClassRowEl && hsClassRowEl.style.display !== 'none') ? '' : 'none';
    }

    const hsCapacityUsedEl = document.getElementById('hsCapacityUsed');
    const hsCapacityMaxEl = document.getElementById('hsCapacityMax');
    const hsCapacityFillEl = document.getElementById('hsCapacityFill');
    const hsTotalOver = capsAvailable && hsMaxTotal > 0 && hsFilledTotal > hsMaxTotal;

    // Aggregate per-pair projections for the total row so reduce/flip pairs
    // don't inflate the bar by adding raw buy notional on top of the short.
    const hsAfterTotalRaw = hsProjections.reduce((s, p) => s + p.afterMag, 0);
    const hsAfterTotal = capsAvailable && hsMaxTotal > 0 ? Math.min(hsAfterTotalRaw, hsMaxTotal) : hsAfterTotalRaw;
    const totalDelta = hsAfterTotal - hsFilledTotal;
    const totalShrinks = totalDelta < -0.01;
    const totalGrows = totalDelta > 0.01;

    const totalFilledPct = capsAvailable && hsMaxTotal > 0 ? Math.min((hsFilledTotal / hsMaxTotal) * 100, 100) : 0;
    const totalAfterPct  = capsAvailable && hsMaxTotal > 0 ? Math.min((hsAfterTotal  / hsMaxTotal) * 100, 100) : 0;

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

    if (hsCapacityUsedEl) {
        if (!capsAvailable) {
            hsCapacityUsedEl.textContent = '--';
        } else {
            const pendingTextColor = capColor(hsTotalOver ? 100 : totalAfterPct);
            let pendingMid = '';
            if (Math.abs(totalDelta) > 0.01) {
                const sign = totalDelta >= 0 ? '+' : '−';
                pendingMid = ` <span class="capacity-asset-pending" style="color:${pendingTextColor}">${sign} ${fmtUsd(Math.abs(totalDelta))} pending</span>`;
            }
            hfCapacityUsedEl.innerHTML = `${fmtUsd(hfFilledTotal)}${pendingMid}`;
        }
    }
    if (hsCapacityMaxEl) hsCapacityMaxEl.textContent = capsAvailable ? fmtUsd(hsMaxTotal) : '--';
    if (hsCapacityFillEl) {
        hsCapacityFillEl.style.width = totalSolidPct + '%';
        hsCapacityFillEl.style.background = hsTotalOver ? 'rgb(239, 68, 68)' : capColor(totalSolidPct);
        hsCapacityFillEl.classList.toggle('capacity-fill--over', hsTotalOver);
        const hsTrackEl = hsCapacityFillEl.parentElement;
        if (hsTrackEl) hsTrackEl.classList.toggle('capacity-bar--over', hsTotalOver);
        let pendingEl = hsCapacityFillEl.parentElement?.querySelector('.capacity-fill--pending');
        if (hsCapacityFillEl.parentElement) {
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

    showDashboard();
    state.dashboardShown = true;
}
