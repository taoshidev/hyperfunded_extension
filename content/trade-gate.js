// Trade blocking/enforcement — disables trade buttons when over position limits
(() => {
  const HF = window.__HF;
  const { ACCOUNT } = HF.state;

  const TRADE_BTN_KEYWORDS = ["place order", "buy", "sell", "long", "short"];
  const TRADE_BLOCK_CLASS = "hf-trade-blocked";
  const MODAL_BLOCK_MSG_ID = "hf-modal-limit-msg";
  let tradeBlockObserver = null;
  let tradeBlockEnforceQueued = false;
  let isEnforcingBlock = false;
  let tradeGuardsInstalled = false;
  let tradeGuardAbort = null;
  let lastDepositWarningAt = 0;
  let depositBypassUntil = 0;
  let lastBlockedDepositButton = null;

  const TRADE_GATE_DEBUG = (() => {
    try {
      return (
        window.HF_TRADE_GATE_DEBUG === true ||
        localStorage.getItem("hf_trade_gate_debug") === "1"
      );
    } catch (_) {
      return window.HF_TRADE_GATE_DEBUG === true;
    }
  })();

  function logTradeGateDiagnostics({ source, pendingNotional, orderValue, eventType, details, always } = {}) {
    if (!always && !TRADE_GATE_DEBUG) return;
    console.log("[Hyperstack][TradeGate]", {
      source: source || "unknown",
      shouldBlockTrade: HF.state.shouldBlockTrade,
      forcedTradeBlock: HF.state.forcedTradeBlock,
      forcedTradeBlockReason: HF.state.forcedTradeBlockReason,
      pendingNotional, orderValue, eventType, details,
    });
  }

  function normalizeTradeText(text) {
    return (text || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function hasOpenPositions() {
    if (Number(ACCOUNT.openTotalUsed) > 0.01) return true;
    const byPair = ACCOUNT.notionalByPair || {};
    return Object.values(byPair).some((value) => Number(value) > 0.01);
  }

  function getDepositButtonTarget(target) {
    const button = target?.closest?.('button, [role="button"]');
    if (!button) return null;
    if (button.closest("#hf-banner") || button.closest("#hf-toast-container")) return null;

    const text = normalizeTradeText(button.textContent);
    const title = normalizeTradeText(button.getAttribute("title"));
    const aria = normalizeTradeText(button.getAttribute("aria-label"));
    const combined = [text, title, aria].filter(Boolean).join(" ");
    if (!combined) return null;
    return /\bdeposit\b/.test(combined) ? button : null;
  }

  function isDepositButtonTarget(target) {
    return !!getDepositButtonTarget(target);
  }

  function bypassDepositBlockAndRetry() {
    depositBypassUntil = Date.now() + 2000;
    const targetBtn = lastBlockedDepositButton;
    if (!targetBtn || !targetBtn.isConnected) return false;
    targetBtn.click();
    return true;
  }

  function maybeBlockDepositWhileOwningAssets(e, submitter) {
    if (!HF.state.balanceVerified || !HF.state.validatorDataLoaded) return;
    const targetForCheck = submitter || e?.target;
    const depositBtn = getDepositButtonTarget(targetForCheck);
    if (!depositBtn) return;
    if (Date.now() < depositBypassUntil) return;
    if (!hasOpenPositions()) return;
    lastBlockedDepositButton = depositBtn;

    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") {
      e.stopImmediatePropagation();
    }

    const now = Date.now();
    if (now - lastDepositWarningAt < 800) return;
    lastDepositWarningAt = now;

    HF.toast.showDepositScalingToast();
  }

  function isTradeButton(btn) {
    if (!(btn instanceof HTMLButtonElement)) return false;
    if (btn.closest("#hf-banner")) return false;
    const text = normalizeTradeText(btn.textContent);
    if (TRADE_BTN_KEYWORDS.some((kw) => text.includes(kw))) return true;
    const aria = normalizeTradeText(btn.getAttribute("aria-label"));
    return TRADE_BTN_KEYWORDS.some((kw) => aria.includes(kw));
  }

  // Broader check — covers <button> and [role="button"] for the hard gate
  function isTradeInteractionTarget(target) {
    const el = target?.closest?.('button, [role="button"]');
    if (!el) return false;
    if (el.closest('#hf-banner') || el.closest('#hf-toast-container')) return false;
    const text = normalizeTradeText(el.textContent);
    const aria = normalizeTradeText(el.getAttribute('aria-label') || '');
    const combined = text + ' ' + aria;
    return TRADE_BTN_KEYWORDS.some((kw) => combined.includes(kw));
  }

  function findTradeButtons() {
    const results = [];
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      if (isTradeButton(btn)) results.push(btn);
    }
    return results;
  }

  function applyBlockToButton(btn) {
    if (btn.classList.contains(TRADE_BLOCK_CLASS) && btn.disabled) return;
    btn.disabled = true;
    btn.setAttribute("aria-disabled", "true");
    btn.classList.add(TRADE_BLOCK_CLASS);
    btn.style.setProperty("pointer-events", "none", "important");
    btn.style.setProperty("opacity", "0.4", "important");
    btn.style.setProperty("filter", "grayscale(0.3)", "important");
    btn.style.setProperty("cursor", "not-allowed", "important");
  }

  function removeBlockFromButton(btn) {
    if (!btn.classList.contains(TRADE_BLOCK_CLASS) && !btn.disabled) return;
    btn.disabled = false;
    btn.removeAttribute("aria-disabled");
    btn.classList.remove(TRADE_BLOCK_CLASS);
    btn.style.removeProperty("pointer-events");
    btn.style.removeProperty("opacity");
    btn.style.removeProperty("filter");
    btn.style.removeProperty("cursor");
  }

  function enforceTradeBlock() {
    if (isEnforcingBlock) return;
    isEnforcingBlock = true;
    if (tradeBlockObserver) tradeBlockObserver.disconnect();
    try {
      const buttons = findTradeButtons();
      for (const btn of buttons) {
        if (HF.state.shouldBlockTrade) {
          applyBlockToButton(btn);
        } else {
          removeBlockFromButton(btn);
        }
      }
      enforceConfirmModalBlock();
    } finally {
      if (tradeBlockObserver) {
        tradeBlockObserver.observe(document.body, {
          childList: true, subtree: true, attributes: true,
          attributeFilter: ["disabled", "style", "class", "aria-disabled"],
        });
      }
      isEnforcingBlock = false;
    }
  }

  function findConfirmOrderModal() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
    let node;
    while ((node = walker.nextNode())) {
      if (node.id === HF.state.BANNER_ID || node.closest(`#${HF.state.BANNER_ID}`)) continue;
      if (node.children && node.children.length > 0) continue;
      const t = (node.textContent || "").trim();
      if (t !== "Confirm Order") continue;

      let container = node;
      for (let i = 0; i < 10 && container.parentElement; i++) {
        container = container.parentElement;
        if (container === document.body) break;
        const btns = getModalConfirmButtons(container);
        if (btns.length > 0) return container;
      }
    }
    return null;
  }

  const MODAL_CONFIRM_KW = ["buy", "sell", "long", "short"];

  function getModalConfirmButtons(container) {
    const buttons = [...container.querySelectorAll("button")];
    return buttons.filter((btn) => {
      if (btn.closest(`#${HF.state.BANNER_ID}`)) return false;
      const txt = normalizeTradeText(btn.textContent);
      if (!txt) return false;
      if (txt === "x" || txt === "\u00d7" || txt === "\u2715") return false;
      return MODAL_CONFIRM_KW.some((kw) => txt.includes(kw));
    });
  }

  function applyModalBlock(modal) {
    const confirmButtons = getModalConfirmButtons(modal);
    for (const btn of confirmButtons) {
      btn.classList.add("hf-modal-confirm-hidden");
      if (!btn.disabled) btn.disabled = true;
      btn.setAttribute("aria-disabled", "true");
    }

    if (!document.getElementById(MODAL_BLOCK_MSG_ID)) {
      const msg = document.createElement("div");
      msg.id = MODAL_BLOCK_MSG_ID;
      msg.className = "hf-modal-limit-warning";
      msg.innerHTML = "&#9888;&#65039; Order blocked — you are over your position limit.";
      const anchor = confirmButtons[0];
      if (anchor && anchor.parentElement) {
        anchor.parentElement.insertBefore(msg, anchor);
      } else {
        modal.appendChild(msg);
      }
    }
  }

  function removeModalBlock(modal) {
    document.getElementById(MODAL_BLOCK_MSG_ID)?.remove();
    for (const btn of getModalConfirmButtons(modal)) {
      btn.classList.remove("hf-modal-confirm-hidden");
      btn.removeAttribute("aria-disabled");
      if (btn.classList.contains(TRADE_BLOCK_CLASS)) continue;
      if (btn.disabled) btn.disabled = false;
    }
  }

  function enforceConfirmModalBlock() {
    const modal = findConfirmOrderModal();
    if (!modal) {
      document.getElementById(MODAL_BLOCK_MSG_ID)?.remove();
      return;
    }
    if (HF.state.shouldBlockTrade) applyModalBlock(modal);
    else removeModalBlock(modal);
  }

  function queueTradeBlockEnforce() {
    if (tradeBlockEnforceQueued || isEnforcingBlock) return;
    tradeBlockEnforceQueued = true;
    requestAnimationFrame(() => {
      tradeBlockEnforceQueued = false;
      enforceTradeBlock();
    });
  }

  function startTradeBlockObserver() {
    if (tradeBlockObserver) return;
    tradeBlockObserver = new MutationObserver(() => {
      if (isEnforcingBlock) return;
      queueTradeBlockEnforce();
    });
    tradeBlockObserver.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["disabled", "style", "class", "aria-disabled"],
    });
  }

  function stopTradeBlockObserver() {
    tradeBlockObserver?.disconnect();
    tradeBlockObserver = null;
  }

  function shouldBlockTradeInteraction(target, submitter) {
    if (!HF.state.shouldBlockTrade) return false;
    if (target?.closest?.("#hf-toast-container") || target?.closest?.("#hf-banner")) {
      return false;
    }
    const directButton = submitter || target?.closest?.("button");
    if (directButton && isTradeButton(directButton)) return true;
    const form = target?.closest?.("form") || null;
    if (!form) return false;
    return [...form.querySelectorAll("button")].some(isTradeButton);
  }

  function cancelBlockedTrade(e) {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") {
      e.stopImmediatePropagation();
    }
    logTradeGateDiagnostics({
      source: "interaction-blocked",
      eventType: e?.type || null,
      always: true,
    });
    queueTradeBlockEnforce();
  }

  function forceBlockTrade(reason) {
    if (reason === undefined) reason = "limit";
    HF.state.forcedTradeBlock = true;
    HF.state.forcedTradeBlockReason = reason;
    HF.state.shouldBlockTrade = true;
    enforceTradeBlock();
    startTradeBlockObserver();
    installTradeGuards();
    HF.utils.clampDebug("trade-block-forced", { reason });
  }

  function releaseForcedTradeBlock() {
    HF.state.forcedTradeBlock = false;
    HF.state.forcedTradeBlockReason = null;
    HF.toast.dismissClampToast();
  }

  function installTradeGuards() {
    if (tradeGuardsInstalled) return;
    tradeGuardsInstalled = true;
    tradeGuardAbort = new AbortController();

    const opts = { capture: true, passive: false, signal: tradeGuardAbort.signal };

    function hardGate(e, submitter) {
      // Re-evaluate synchronously so state is fresh even if scheduleUpdate hasn't fired
      if (!HF.state._unsupportedPairBlocked) checkAndBlockButtons();

      // Hard gate: catches cases where button detection fails (role=button,
      // child targets, etc.) The over-cap flow no longer blocks — this only
      // fires for unsupported pairs (which have their own overlay) or
      // explicit forceBlockTrade calls (none in the cap path now).
      if (HF.state.shouldBlockTrade && isTradeInteractionTarget(e.target)) {
        cancelBlockedTrade(e);
        return;
      }

      // Fallback: form-based detection
      if (shouldBlockTradeInteraction(e.target, submitter || null)) cancelBlockedTrade(e);
    }

    const clickLikeHandler = (e) => {
      maybeBlockDepositWhileOwningAssets(e, null);
      hardGate(e, null);
    };
    const submitHandler = (e) => {
      maybeBlockDepositWhileOwningAssets(e, e.submitter || null);
      hardGate(e, e.submitter || null);
    };
    const enterHandler = (e) => {
      if (e.key !== "Enter") return;
      hardGate(e, null);
    };

    window.addEventListener("pointerdown", clickLikeHandler, opts);
    window.addEventListener("mousedown", clickLikeHandler, opts);
    window.addEventListener("click", clickLikeHandler, opts);
    window.addEventListener("submit", submitHandler, opts);
    window.addEventListener("keydown", enterHandler, opts);
  }

  function uninstallTradeGuards() {
    if (!tradeGuardsInstalled) return;
    tradeGuardAbort?.abort();
    tradeGuardAbort = null;
    tradeGuardsInstalled = false;
  }

  function checkAndBlockButtons() {
    // HL orders are no longer blocked when they exceed the HS cap — the
    // mirror-preview card surfaces the over-cap state as a warning and the
    // user can still confirm. Real blocks remain for unsupported pairs and
    // explicit `forceBlockTrade` calls (e.g., drawdown breach handling, if
    // wired up later).
    if (HF.state._unsupportedPairBlocked) {
      HF.state.shouldBlockTrade = true;
      enforceTradeBlock();
      startTradeBlockObserver();
      installTradeGuards();
      return;
    }

    HF.state.shouldBlockTrade = HF.state.forcedTradeBlock || false;
    logTradeGateDiagnostics({ source: "checkAndBlockButtons" });
    enforceTradeBlock();
    startTradeBlockObserver();
    installTradeGuards();
  }

  HF.tradeGate = {
    checkAndBlockButtons,
    enforceTradeBlock,
    forceBlockTrade,
    releaseForcedTradeBlock,
    installTradeGuards,
    uninstallTradeGuards,
    startTradeBlockObserver,
    stopTradeBlockObserver,
    bypassDepositBlockAndRetry,
  };

  // If pair-support already flagged an unsupported pair before trade-gate loaded, enforce now.
  if (HF.state._unsupportedPairBlocked) {
    HF.state.shouldBlockTrade = true;
    enforceTradeBlock();
    startTradeBlockObserver();
    installTradeGuards();
  }
})();
