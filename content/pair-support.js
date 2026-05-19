// Symbol detection and unsupported pair overlay
(() => {
  const HF = window.__HF;

  let lastDetectedSymbol = null;
  let dismissedSymbol = null;

  function isSymbolSupported(symbol) {
    if (!symbol) return true;
    if (!HF.state.pairsLoaded) return true;
    return HF.state.SUPPORTED_SYMBOLS.includes(symbol);
  }

  function showUnsupportedOverlay(symbol) {
    const existing = document.getElementById(HF.state.UNSUPPORTED_OVERLAY_ID);
    if (existing && existing.dataset.symbol === symbol) return;
    if (existing) existing.remove();

    // Resolve friendly display name (e.g. XYZ:CL \u2192 WTIOIL)
    const displayName = (HF.state.hlCoinToDisplay || {})[symbol] || symbol;
    // Supported pairs list using only friendly names (no hl_coin duplicates)
    const friendlySupported = Object.values(HF.state.hlCoinToDisplay || {});
    const supportedList = friendlySupported.length
      ? friendlySupported.sort().map(s => s + "-USDC").join(", ")
      : HF.state.SUPPORTED_SYMBOLS.map(s => s + "-USDC").join(", ");

    const overlay = document.createElement("div");
    overlay.id = HF.state.UNSUPPORTED_OVERLAY_ID;
    overlay.dataset.symbol = symbol;
    overlay.innerHTML = `
      <div class="hf-unsupported-card">
        <button class="hf-unsupported-close" id="hf-unsupported-close" type="button">\u2715</button>
        <span class="hf-unsupported-icon">\u26a0\ufe0f</span>
        <span class="hf-unsupported-title">Unsupported Pair</span>
        <span class="hf-unsupported-msg">
          <b>${displayName}-USDC</b> is not supported by HyperFunded.<br>
          Supported pairs: <b>${supportedList}</b>
        </span>
      </div>
    `;
    (document.body || document.documentElement).appendChild(overlay);

    overlay.querySelector("#hf-unsupported-close")?.addEventListener("click", () => {
      dismissedSymbol = symbol;
      removeUnsupportedOverlay();
    });
  }

  function removeUnsupportedOverlay() {
    document.getElementById(HF.state.UNSUPPORTED_OVERLAY_ID)?.remove();
  }

  function checkPairSupport(forceRecheck = false) {
    const symbol = HF.utils.getCurrentSymbol();
    if (symbol === lastDetectedSymbol && !forceRecheck) return;
    lastDetectedSymbol = symbol;

    if (symbol !== dismissedSymbol) {
      dismissedSymbol = null;
    }

    if (isSymbolSupported(symbol) || symbol === dismissedSymbol) {
      removeUnsupportedOverlay();
      if (HF.state._unsupportedPairBlocked) {
        HF.state._unsupportedPairBlocked = false;
        HF.state.shouldBlockTrade = false;
      }
    } else {
      HF.toast.showUnsupportedPairToast(symbol);
      HF.state._unsupportedPairBlocked = true;
    }
  }

  HF.pairSupport = {
    checkPairSupport,
    removeUnsupportedOverlay,
    isSymbolSupported,
  };
})();
