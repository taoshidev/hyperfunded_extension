// Toast notification system for order clamping/blocking
(() => {
  const HF = window.__HF;
  const { ACCOUNT } = HF.state;

  let activeClampToast = null;
  let activeInfoToast = null;
  let activeLimitBlockToast = null;
  let activeOversizeToast = null;
  let oversizeDismissed = false;  // sticky until state returns under cap
  let infoToastTimer = null;
  let blockedToastDismissed = false;
  let blockedToastDetailsExpanded = false;
  let depositToastDetailsExpanded = false;

  function ensureToastContainer() {
    let container = document.getElementById("hf-toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "hf-toast-container";
      container.className = "hf-toast-container";
      (document.body || document.documentElement).appendChild(container);
    }
    return container;
  }

  function formatLeverageForToast(value) {
    if (!Number.isFinite(value) || value <= 0) return "0x";
    return parseFloat(value.toFixed(2)).toString() + "x";
  }

  function buildBlockedDetails(constraint, allowed, clampedSize, sizeUnit, formatSizeForToast, pairContext) {
    const limitScope = constraint === "per-pair" ? "single-asset" : "portfolio";
    const heading = "Why this was blocked";
    const what = "You tried to place a size above your current " + limitScope + " capacity.";
    const why = "HyperFunded enforces this cap to keep your account inside funded-challenge risk limits.";
    const how = "Lower size to <b>" + formatSizeForToast(clampedSize, sizeUnit) + " " + sizeUnit +
      "</b> or less, or close/reduce existing positions to free " + limitScope + " capacity.";
    const capacity = "Remaining capacity right now: <b>" + formatSizeForToast(allowed, sizeUnit) + " " + sizeUnit + "</b>.";
    const pairLimit = "Per-pair limit (" + pairContext.symbolLabel + "): <b>" + pairContext.limitUsd + "</b> " +
      "(used " + pairContext.usedUsd + ", remaining " + pairContext.remainingUsd + ").";
    const availableLeverage = "Available leverage on " + pairContext.symbolLabel + ": <b>" +
      pairContext.remainingLeverage + "</b> remaining (max " + pairContext.maxLeverage + " per pair).";

    return (
      '<div class="hf-toast-details-head">' + heading + "</div>" +
      '<ul class="hf-toast-details-list">' +
        '<li><span>What:</span> ' + what + "</li>" +
        '<li><span>Why:</span> ' + why + "</li>" +
        '<li><span>How to avoid:</span> ' + how + " " + capacity + "</li>" +
        '<li><span>Per-pair cap:</span> ' + pairLimit + "</li>" +
        '<li><span>Leverage left:</span> ' + availableLeverage + "</li>" +
      "</ul>"
    );
  }

  function showClampToast(details) {
    const { fmt, effectiveMaxSingleUsd, formatSizeForToast, getSizeUnit, getCurrentSymbol, marginLimitBasisUsd, getActiveOrderSide } = HF.utils;
    const requested = Number(details?.requestedNotional) || 0;
    const allowed = Number(details?.allowedNotional) || 0;
    const constraint = details?.constraint || "portfolio";
    const requestedSize = Number(details?.requestedSize) || 0;
    const clampedSize = Number(details?.clampedSize) || 0;
    const sizeUnit = details?.sizeUnit || getSizeUnit();
    const isBlockedOnly = details?.blocked === true;
    const symbol = getCurrentSymbol();
    const symbolLabel = symbol || "this asset";
    const perPairLimitUsd = effectiveMaxSingleUsd();
    const resolvedSymbol = HF.utils.resolveExposureSymbol(symbol);
    const usedPerPairUsd = (resolvedSymbol && ACCOUNT.notionalByPair[resolvedSymbol]) || 0;
    const remainingPerPairUsd = Math.max(perPairLimitUsd - usedPerPairUsd, 0);
    const leverageBasisUsd = marginLimitBasisUsd();
    const maxPairLeverage = leverageBasisUsd > 0 ? perPairLimitUsd / leverageBasisUsd : 0;
    const remainingPairLeverage = leverageBasisUsd > 0 ? remainingPerPairUsd / leverageBasisUsd : 0;
    const pairContext = {
      symbolLabel,
      limitUsd: fmt(perPairLimitUsd),
      usedUsd: fmt(usedPerPairUsd),
      remainingUsd: fmt(remainingPerPairUsd),
      maxLeverage: formatLeverageForToast(maxPairLeverage),
      remainingLeverage: formatLeverageForToast(remainingPairLeverage),
    };
    const activeOrderSide = typeof getActiveOrderSide === "function" ? getActiveOrderSide() : null;
    const isBuySide = activeOrderSide === "buy";
    const hasSameAssetExposure = usedPerPairUsd > 0.01;
    const perAssetBuyContext = constraint === "per-pair" && isBuySide && hasSameAssetExposure;
    const isCrossPairContext = constraint === "portfolio";
    const crossPairSuggestions = "To free cross-pair capacity, reduce some other pairs first: trim your largest position, close lower-conviction pairs, or stagger new entries instead of opening multiple pairs at once.";

    if (isBlockedOnly && blockedToastDismissed) return;
    if (!isBlockedOnly) blockedToastDetailsExpanded = false;

    let messageHtml = "Order exceeds your <b>" + constraint + " position size limit</b>.";
    let titleHtml = "HyperFunded: Size clamped to " + formatSizeForToast(clampedSize, sizeUnit) + " " + sizeUnit;
    let iconHtml = "\u26a0\ufe0f";
    let variantClass = "hf-toast hf-toast--alert";

    if (allowed === 0) {
       titleHtml = "HyperFunded: Order Prevented";
       messageHtml =
         "No remaining capacity within your <b>" + constraint + "</b> position limit.";
       if (perAssetBuyContext) {
         messageHtml += " You already have <b>" + pairContext.usedUsd + "</b> on " + symbolLabel + ", so this asset's remaining buy capacity is currently exhausted.";
       } else if (isCrossPairContext) {
         messageHtml += " " + crossPairSuggestions;
       }
       iconHtml = "\u26d4";
       variantClass = "hf-toast hf-toast--warning";
    } else if (isBlockedOnly) {
       titleHtml = "Order Blocked";
       messageHtml = "Requested size is above your active " + constraint + " limit.";
       if (perAssetBuyContext) {
         messageHtml += " You already hold <b>" + pairContext.usedUsd + "</b> on " + symbolLabel +
           ", so there is less room left for additional buys on this asset.";
       } else if (isCrossPairContext) {
         messageHtml += " " + crossPairSuggestions;
       } else {
         messageHtml += " Per-pair remaining: <b>" + pairContext.remainingUsd + "</b> (" + pairContext.remainingLeverage + " available).";
       }
       iconHtml = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="#f87171" stroke-width="1.5"/><line x1="5" y1="5" x2="11" y2="11" stroke="#f87171" stroke-width="1.5" stroke-linecap="round"/></svg>';
       variantClass = "hf-toast hf-toast--blocked";
    } else if (constraint === 'per-pair') {
       messageHtml = "Single-asset limit is <b>" + fmt(effectiveMaxSingleUsd()) + "</b>. Size " +
         formatSizeForToast(requestedSize, sizeUnit) + " " + sizeUnit + " should be reduced to " +
         formatSizeForToast(clampedSize, sizeUnit) + " " + sizeUnit + ".";
       if (perAssetBuyContext) {
         messageHtml += " You already have <b>" + pairContext.usedUsd + "</b> on " + symbolLabel +
           ", so your additional buy room on this asset is smaller right now.";
       }
    } else {
       messageHtml = "Portfolio capacity allows <b>" + fmt(allowed) + "</b>. Size " +
         formatSizeForToast(requestedSize, sizeUnit) + " " + sizeUnit + " should be reduced to " +
         formatSizeForToast(clampedSize, sizeUnit) + " " + sizeUnit + ".";
       messageHtml += " " + crossPairSuggestions;
    }

    const showClose = isBlockedOnly;
    const detailsId = "hf-toast-blocked-details";
    const detailsHtml = isBlockedOnly
      ? buildBlockedDetails(constraint, allowed, clampedSize, sizeUnit, formatSizeForToast, pairContext)
      : "";
    const detailsToggleHtml = isBlockedOnly
      ? '<button class="hf-toast-details-toggle" type="button" aria-expanded="' + (blockedToastDetailsExpanded ? "true" : "false") + '" aria-controls="' + detailsId + '">' +
          '<span>Why blocked?</span>' +
          '<svg class="hf-toast-details-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none">' +
            '<path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
          "</svg>" +
        "</button>"
      : "";
    const detailsPanelHtml = isBlockedOnly
      ? '<div id="' + detailsId + '" class="hf-toast-details' + (blockedToastDetailsExpanded ? " hf-toast-details-open" : "") + '" ' + (blockedToastDetailsExpanded ? "" : "hidden") + ">" +
          detailsHtml +
        "</div>"
      : "";
    const innerHtml =
      '<div class="hf-toast-icon">' + iconHtml + '</div>' +
      '<div class="hf-toast-content">' +
        '<div class="hf-toast-title">' + titleHtml + '</div>' +
        '<div class="hf-toast-msg">' + messageHtml + '</div>' +
        detailsToggleHtml +
        detailsPanelHtml +
      '</div>' +
      (showClose ? '<button class="hf-toast-close" type="button" aria-label="Dismiss">' +
        '<svg width="10" height="10" viewBox="0 0 10 10" fill="none">' +
          '<line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
          '<line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
        '</svg>' +
      '</button>' : '');

    if (activeClampToast && activeClampToast.parentNode) {
      activeClampToast.className = variantClass + " hf-toast-show";
      activeClampToast.innerHTML = innerHtml;
      return;
    }

    const container = ensureToastContainer();

    const toast = document.createElement("div");
    toast.className = variantClass;
    toast.innerHTML = innerHtml;

    container.appendChild(toast);
    activeClampToast = toast;

    toast.addEventListener("mousedown", function(e) {
      const detailsToggle = e.target.closest(".hf-toast-details-toggle");
      if (detailsToggle) {
        e.preventDefault();
        e.stopPropagation();
        blockedToastDetailsExpanded = !blockedToastDetailsExpanded;
        const detailsPanel = toast.querySelector(".hf-toast-details");
        if (detailsPanel) {
          detailsPanel.hidden = !blockedToastDetailsExpanded;
          detailsPanel.classList.toggle("hf-toast-details-open", blockedToastDetailsExpanded);
        }
        detailsToggle.setAttribute("aria-expanded", blockedToastDetailsExpanded ? "true" : "false");
        return;
      }

      if (e.target.closest(".hf-toast-close")) {
        e.preventDefault();
        e.stopPropagation();
        blockedToastDismissed = true;
        dismissClampToast();
      }
    });

    toast.addEventListener("click", function(e) {
      const detailsToggle = e.target.closest(".hf-toast-details-toggle");
      if (detailsToggle) {
        return;
      }

      if (e.target.closest(".hf-toast-close")) {
        return;
      }
    });

    void toast.offsetWidth;
    toast.classList.add("hf-toast-show");
  }

  function showDepositScalingToast() {
    const titleHtml = "Deposit Blocked";
    const messageHtml = "You can't deposit while owning assets unless you explicitly bypass this warning.";
    const iconHtml = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="#f87171" stroke-width="1.5"/><line x1="5" y1="5" x2="11" y2="11" stroke="#f87171" stroke-width="1.5" stroke-linecap="round"/></svg>';
    const variantClass = "hf-toast hf-toast--blocked";
    const detailsId = "hf-toast-deposit-details";
    const detailsToggleHtml =
      '<button class="hf-toast-details-toggle" type="button" aria-expanded="' + (depositToastDetailsExpanded ? "true" : "false") + '" aria-controls="' + detailsId + '">' +
        '<span>Why blocked?</span>' +
        '<svg class="hf-toast-details-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none">' +
          '<path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
        "</svg>" +
      "</button>";
    const detailsPanelHtml =
      '<div id="' + detailsId + '" class="hf-toast-details' + (depositToastDetailsExpanded ? " hf-toast-details-open" : "") + '" ' + (depositToastDetailsExpanded ? "" : "hidden") + ">" +
        '<div class="hf-toast-details-head">Why this matters</div>' +
        '<ul class="hf-toast-details-list">' +
          '<li><span>Scaling impact:</span> Depositing while you already own assets changes account equity immediately, which shifts remaining-size calculations for new orders.</li>' +
          '<li><span>Risk impact:</span> Your open positions were sized on pre-deposit equity, so position scaling logic can be temporarily inconsistent until account state is re-evaluated.</li>' +
          '<li><span>Safe path:</span> Close positions first, deposit, then re-open with fresh sizing.</li>' +
        "</ul>" +
      "</div>";
    const bypassActionHtml =
      '<button class="hf-toast-details-toggle hf-toast-deposit-bypass" type="button" aria-label="Bypass deposit warning">' +
        "<span>I understand - let me deposit</span>" +
      "</button>";
    const innerHtml =
      '<div class="hf-toast-icon">' + iconHtml + '</div>' +
      '<div class="hf-toast-content">' +
        '<div class="hf-toast-title">' + titleHtml + '</div>' +
        '<div class="hf-toast-msg">' + messageHtml + '</div>' +
        detailsToggleHtml +
        detailsPanelHtml +
        bypassActionHtml +
      '</div>' +
      '<button class="hf-toast-close" type="button" aria-label="Dismiss">' +
        '<svg width="10" height="10" viewBox="0 0 10 10" fill="none">' +
          '<line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
          '<line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
        "</svg>" +
      "</button>";

    const container = ensureToastContainer();
    depositToastDetailsExpanded = false;
    if (activeInfoToast && activeInfoToast.parentNode) {
      activeInfoToast.className = variantClass + " hf-toast-show";
      activeInfoToast.innerHTML = innerHtml;
    } else {
      const toast = document.createElement("div");
      toast.className = variantClass;
      toast.innerHTML = innerHtml;
      container.appendChild(toast);
      activeInfoToast = toast;
      void toast.offsetWidth;
      toast.classList.add("hf-toast-show");
    }

    const toast = activeInfoToast;
    if (toast && !toast.dataset.depositHandlersBound) {
      toast.dataset.depositHandlersBound = "1";
      toast.addEventListener("mousedown", function(e) {
        const bypassBtn = e.target.closest(".hf-toast-deposit-bypass");
        if (bypassBtn) {
          e.preventDefault();
          e.stopPropagation();
          HF.tradeGate?.bypassDepositBlockAndRetry?.();
          dismissInfoToast();
          return;
        }

        const detailsToggle = e.target.closest(".hf-toast-details-toggle");
        if (detailsToggle && !detailsToggle.classList.contains("hf-toast-deposit-bypass")) {
          e.preventDefault();
          e.stopPropagation();
          depositToastDetailsExpanded = !depositToastDetailsExpanded;
          const detailsPanel = toast.querySelector(".hf-toast-details");
          if (detailsPanel) {
            detailsPanel.hidden = !depositToastDetailsExpanded;
            detailsPanel.classList.toggle("hf-toast-details-open", depositToastDetailsExpanded);
          }
          detailsToggle.setAttribute("aria-expanded", depositToastDetailsExpanded ? "true" : "false");
          return;
        }

        if (e.target.closest(".hf-toast-close")) {
          e.preventDefault();
          e.stopPropagation();
          dismissInfoToast();
        }
      });
    }

    if (infoToastTimer) clearTimeout(infoToastTimer);
    infoToastTimer = setTimeout(() => {
      dismissInfoToast();
    }, 8000);
  }

  function dismissInfoToast() {
    if (infoToastTimer) {
      clearTimeout(infoToastTimer);
      infoToastTimer = null;
    }
    if (!activeInfoToast) return;
    const toast = activeInfoToast;
    activeInfoToast = null;
    depositToastDetailsExpanded = false;
    toast.classList.remove("hf-toast-show");
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }

  function dismissClampToast() {
    if (!activeClampToast) return;
    const toast = activeClampToast;
    activeClampToast = null;
    blockedToastDetailsExpanded = false;
    toast.classList.remove("hf-toast-show");
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }

  function resetBlockedToastDismissed() {
    blockedToastDismissed = false;
  }

  function isBlockedToastDismissed() {
    return blockedToastDismissed;
  }

  function showUnsupportedPairToast(symbol) {
    const variantClass = "hf-toast hf-toast--blocked";
    const iconHtml = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="#f87171" stroke-width="1.5"/><line x1="5" y1="5" x2="11" y2="11" stroke="#f87171" stroke-width="1.5" stroke-linecap="round"/><line x1="11" y1="5" x2="5" y2="11" stroke="#f87171" stroke-width="1.5" stroke-linecap="round"/></svg>';
    const innerHtml =
      '<div class="hf-toast-icon">' + iconHtml + '</div>' +
      '<div class="hf-toast-content">' +
        '<div class="hf-toast-title">Unsupported Pair</div>' +
        '<div class="hf-toast-msg"><b>' + (symbol || "This pair") + '</b> is not supported by HyperFunded. Switch to a supported pair to trade.</div>' +
      '</div>' +
      '<button class="hf-toast-close" type="button" aria-label="Dismiss">' +
        '<svg width="10" height="10" viewBox="0 0 10 10" fill="none">' +
          '<line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
          '<line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
        '</svg>' +
      '</button>';

    const container = ensureToastContainer();
    if (activeInfoToast && activeInfoToast.parentNode) {
      activeInfoToast.className = variantClass + " hf-toast-show";
      activeInfoToast.innerHTML = innerHtml;
    } else {
      const toast = document.createElement("div");
      toast.className = variantClass;
      toast.innerHTML = innerHtml;
      container.appendChild(toast);
      activeInfoToast = toast;
      void toast.offsetWidth;
      toast.classList.add("hf-toast-show");
    }

    activeInfoToast.addEventListener("mousedown", function handler(e) {
      if (e.target.closest(".hf-toast-close")) {
        e.preventDefault();
        dismissInfoToast();
        activeInfoToast?.removeEventListener("mousedown", handler);
      }
    });

    if (infoToastTimer) clearTimeout(infoToastTimer);
    infoToastTimer = setTimeout(() => dismissInfoToast(), 6000);
  }

  function showLimitBlockToast() {
    if (activeLimitBlockToast && activeLimitBlockToast.parentNode) return;

    const { fmt, effectiveMaxSingleUsd, effectiveMaxTotalUsd, getCurrentSymbol, resolveExposureSymbol } = HF.utils;
    const symbol = getCurrentSymbol();
    const pairMax = effectiveMaxSingleUsd();
    const totalMax = effectiveMaxTotalUsd();
    const resolvedSym = resolveExposureSymbol(symbol);
    const pairUsed = (resolvedSym && ACCOUNT.notionalByPair[resolvedSym]) || 0;
    const totalUsed = ACCOUNT.openTotalUsed || 0;
    const remaining = fmt(Math.max(Math.min(pairMax - pairUsed, totalMax - totalUsed), 0));

    const iconHtml = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="#f87171" stroke-width="1.5"/><line x1="5" y1="5" x2="11" y2="11" stroke="#f87171" stroke-width="1.5" stroke-linecap="round"/><line x1="11" y1="5" x2="5" y2="11" stroke="#f87171" stroke-width="1.5" stroke-linecap="round"/></svg>';
    const innerHtml =
      '<div class="hf-toast-icon">' + iconHtml + '</div>' +
      '<div class="hf-toast-content">' +
        '<div class="hf-toast-title">Order Blocked — Over Position Limit</div>' +
        '<div class="hf-toast-msg">Max remaining: <b>' + remaining + '</b>. Reduce your order size to place this trade.</div>' +
      '</div>';

    const container = ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = 'hf-toast hf-toast--blocked';
    toast.innerHTML = innerHtml;
    container.appendChild(toast);
    activeLimitBlockToast = toast;
    void toast.offsetWidth;
    toast.classList.add('hf-toast-show');
  }

  function dismissLimitBlockToast() {
    if (!activeLimitBlockToast) return;
    const toast = activeLimitBlockToast;
    activeLimitBlockToast = null;
    toast.classList.remove('hf-toast-show');
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
  }

  // ── Oversize Positions toast ──────────────────────────────────────────────
  // Shown when current open positions already exceed the per-asset or total
  // cap (independent of any new order attempt). Stays up until the breach
  // resolves — call evaluateOversizeState() after every ACCOUNT update.
  function computeOverCapInfo() {
    // Trigger semantics: toast fires when HL exposure × ratio exceeds the
    // HF cap (i.e. validator clamped HF to cap). This distinguishes
    // "intentionally at-cap" (HL fits exactly) from "validator-clamped due
    // to HL excess" — only the latter warrants a warning.
    //
    // Display values: actual capped HF values from the validator (size ×
    // current price, sourced from ACCOUNT.hfPositionsByCoin). The HL
    // projection (HL × ratio, the "would-be" if uncapped) is shown in
    // expanded details so traders can see how much HL needs to reduce.
    const { fmt, effectiveMaxSingleUsd, effectiveMaxTotalUsd, getMirrorMultiplier } = HF.utils;
    const pairMax = effectiveMaxSingleUsd();
    const totalMax = effectiveMaxTotalUsd();
    const mirror = getMirrorMultiplier();

    const hfPairs = ACCOUNT.hfPositionsByCoin || {};
    const hlByPair = ACCOUNT.filledNotionalByPair || {};
    const hlTotalTarget = (Number(ACCOUNT.filledTotal) || 0) * mirror;

    const overAssets = Object.keys(hlByPair)
      .map((sym) => {
        const key = String(sym).toUpperCase();
        return {
          sym: key,
          value: Math.abs(Number(hfPairs[key]?.value || hfPairs[sym]?.value) || 0),
          hlTarget: (Number(hlByPair[sym]) || 0) * mirror,
        };
      })
      .filter(({ hlTarget }) => pairMax > 0 && hlTarget > pairMax + 0.01)
      .sort((a, b) => b.hlTarget - a.hlTarget);

    const totalOver = totalMax > 0 && hlTotalTarget > totalMax + 0.01;
    return { fmt, pairMax, totalMax, overAssets, totalOver, hlTotalTarget };
  }

  function buildOversizeDetailsHtml({ fmt, pairMax, totalMax, overAssets, totalOver, hlTotalTarget }) {
    const lines = [];
    if (overAssets.length > 0) {
      const worst = overAssets[0];
      const more = overAssets.length > 1 ? ` (+${overAssets.length - 1} more over cap)` : '';
      lines.push(
        '<b>' + worst.sym + '</b> HF pair is at the cap of <b>' + fmt(pairMax) + '</b>' + more + '. ' +
        'HL exposure projects to <b>' + fmt(worst.hlTarget) + '</b> in HF terms.'
      );
    }
    if (totalOver) {
      lines.push(
        'HF portfolio is at the cap of <b>' + fmt(totalMax) + '</b>. ' +
        'Total HL exposure projects to <b>' + fmt(hlTotalTarget) + '</b> in HF terms.'
      );
    }
    lines.push('HL trading is unaffected.');
    lines.push('HF will resume tracking HL once HL exposure drops below the cap.');
    return lines.map(l => '<div class="hf-toast-detail-line">' + l + '</div>').join('');
  }

  function showOversizeToast() {
    const info = computeOverCapInfo();
    const { fmt, overAssets, pairMax, totalMax, totalOver, hlTotalTarget } = info;

    // Compact one-line summary: worst pair, or portfolio if only that breached.
    // "HF at cap $X" reports the actual capped state; "(HL +$Y)" surfaces
    // the magnitude of the HL excess so traders know how much to reduce.
    let summary;
    if (overAssets.length > 0) {
      const w = overAssets[0];
      const extra = overAssets.length > 1 ? ' +' + (overAssets.length - 1) : '';
      const excess = Math.max(0, w.hlTarget - pairMax);
      const excessSuffix = excess > 0.01 ? ' (HL +' + fmt(excess) + ')' : '';
      summary = w.sym + ' HF at cap ' + fmt(pairMax) + excessSuffix + extra;
    } else {
      const excess = Math.max(0, hlTotalTarget - totalMax);
      const excessSuffix = excess > 0.01 ? ' (HL +' + fmt(excess) + ')' : '';
      summary = 'Portfolio HF at cap ' + fmt(totalMax) + excessSuffix;
    }

    const detailsHtml = buildOversizeDetailsHtml(info);

    const innerHtml =
      '<span class="hf-toast-icon" aria-hidden="true">⚠</span>' +
      '<span class="hf-toast-summary">Over HF limit · ' + summary + '</span>' +
      '<button type="button" class="hf-toast-expand" aria-expanded="false" title="Details">▾</button>' +
      '<button type="button" class="hf-toast-close" title="Dismiss" aria-label="Dismiss">×</button>' +
      '<div class="hf-toast-details" hidden>' + detailsHtml + '</div>';

    const variantClass = "hf-toast hf-toast--warning hf-toast--oversize hf-toast--compact";

    if (activeOversizeToast && activeOversizeToast.parentNode) {
      // Preserve expanded state across re-renders so updating the numbers
      // doesn't collapse the panel under the user's mouse.
      const wasExpanded = activeOversizeToast.classList.contains('hf-toast--expanded');
      activeOversizeToast.className = variantClass + " hf-toast-show" + (wasExpanded ? ' hf-toast--expanded' : '');
      activeOversizeToast.innerHTML = innerHtml;
      wireOversizeControls(activeOversizeToast);
      if (wasExpanded) {
        const det = activeOversizeToast.querySelector('.hf-toast-details');
        if (det) det.hidden = false;
        const ex = activeOversizeToast.querySelector('.hf-toast-expand');
        if (ex) ex.setAttribute('aria-expanded', 'true');
      }
      return;
    }

    const container = ensureToastContainer();
    const toast = document.createElement("div");
    toast.className = variantClass;
    toast.innerHTML = innerHtml;
    container.appendChild(toast);
    activeOversizeToast = toast;
    wireOversizeControls(toast);
    void toast.offsetWidth;
    toast.classList.add("hf-toast-show");
  }

  function wireOversizeControls(toast) {
    const expandBtn = toast.querySelector('.hf-toast-expand');
    const closeBtn = toast.querySelector('.hf-toast-close');
    const details = toast.querySelector('.hf-toast-details');
    if (expandBtn && details) {
      expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const expanded = toast.classList.toggle('hf-toast--expanded');
        details.hidden = !expanded;
        expandBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        oversizeDismissed = true;
        dismissOversizeToast();
      });
    }
  }

  function dismissOversizeToast() {
    if (!activeOversizeToast) return;
    const toast = activeOversizeToast;
    activeOversizeToast = null;
    toast.classList.remove("hf-toast-show");
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
  }

  function evaluateOversizeState() {
    if (!HF.state.limitsLoaded) return;
    const { effectiveMaxSingleUsd, effectiveMaxTotalUsd, getMirrorMultiplier } = HF.utils;
    const pairMax = effectiveMaxSingleUsd();
    const totalMax = effectiveMaxTotalUsd();
    const mirror = getMirrorMultiplier();
    if (!(mirror > 0)) return;
    // Trigger by HL exposure × ratio against caps. When HL × ratio > cap,
    // validator has clamped actual HF to cap — that's the breach worth
    // warning about. Filled-only (pending limit orders are hypothetical
    // and may never fill; they're surfaced visually elsewhere). The
    // small +0.01 tolerance avoids flickering at exact-fit positions.
    const byPair = ACCOUNT.filledNotionalByPair || {};
    const anyPairOver = pairMax > 0 && Object.values(byPair).some(v => ((Number(v) || 0) * mirror) > pairMax + 0.01);
    const hlTotalTarget = (Number(ACCOUNT.filledTotal) || 0) * mirror;
    const totalOver = totalMax > 0 && hlTotalTarget > totalMax + 0.01;
    if (anyPairOver || totalOver) {
      if (oversizeDismissed && !activeOversizeToast) return;
      showOversizeToast();
    } else {
      oversizeDismissed = false;
      dismissOversizeToast();
    }
  }

  HF.toast = {
    showClampToast,
    showDepositScalingToast,
    showUnsupportedPairToast,
    showLimitBlockToast,
    dismissLimitBlockToast,
    dismissClampToast,
    resetBlockedToastDismissed,
    isBlockedToastDismissed,
    showOversizeToast,
    dismissOversizeToast,
    evaluateOversizeState,
  };
})();
