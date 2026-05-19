// Pure utility functions — formatting, parsing, leverage calculations, input detection
(() => {
  const HF = window.__HF;
  const { ACCOUNT } = HF.state;

  function marginLimitBasisUsd() {
    // Caps live on the HF side now (= ratio × accountBalance), so the
    // fallback basis when validator limits haven't loaded is the live HF
    // balance. Trade-gate / mirror-preview compare HF-mapped exposure to
    // this, not raw HL equity.
    return Number(ACCOUNT.accountBalance) || 0;
  }

  // Multiplier that converts HL-side notional to HF-side notional.
  // HS_value = HL_value × mirrorMultiplier — mirrors tgbot's `weight × hs_bal`
  // expressed as a single up-front multiply.
  function getMirrorMultiplier() {
    const hlBal = Number(ACCOUNT.hlBalance) || 0;
    const accountBalance = Number(ACCOUNT.accountBalance) || 0;
    if (hlBal <= 0 || accountBalance <= 0) return 0;
    return accountBalance / hlBal;
  }

  // Resolves a URL symbol (e.g. "XYZ:WTIOIL") or HL coin (e.g. "XYZ:CL") to
  // the canonical display/exposure key used in notionalByPair and signedNotionalByPair.
  // Native pairs like "BTC" pass through unchanged. xyz pairs resolve through
  // hlCoinToDisplay (built by fetchTradePairs) so that both "XYZ:CL" and
  // "XYZ:WTIOIL" map to the same "WTIOIL" key that validator data uses.
  function resolveExposureSymbol(symbol) {
    if (!symbol) return null;
    const display = HF.state.hlCoinToDisplay || {};
    return display[symbol] || symbol;
  }

  // True when the order side is opposite the current position direction —
  // i.e. selling a long or buying a short. Used to bypass cap-based gating
  // when the user is reducing exposure (which should always be allowed,
  // even when current exposure is already over the cap).
  function isReduceIntent(symbol, side) {
    if (!symbol || (side !== "buy" && side !== "sell")) return false;
    const resolved = resolveExposureSymbol(symbol);
    const signed = Number(ACCOUNT.signedNotionalByPair?.[resolved]) || 0;
    if (Math.abs(signed) <= 0.01) return false;
    if (signed > 0 && side === "sell") return true;
    if (signed < 0 && side === "buy") return true;
    return false;
  }

  function resolveChallengeModeFromValidator(result) {
    const bucket = result?.challenge_period?.bucket;
    // Explicit bucket → use it directly
    if (bucket === 'SUBACCOUNT_FUNDED') return false;
    if (bucket) return true; // SUBACCOUNT_CHALLENGE, SUBACCOUNT_EVAL, etc.
    // No bucket (no trades placed yet, status "active") → assume challenge
    return true;
  }

  function effectiveMaxSingleUsd() {
    if (HF.state.limitsLoaded && ACCOUNT.maxPositionPerPair > 0) {
      return ACCOUNT.maxPositionPerPair;
    }
    return marginLimitBasisUsd();
  }

  function effectiveMaxTotalUsd() {
    if (HF.state.limitsLoaded && ACCOUNT.maxPortfolio > 0) {
      return ACCOUNT.maxPortfolio;
    }
    return marginLimitBasisUsd();
  }

  const fmt = (n) =>
    "$" +
    Number(n).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const pct = (used, max) => max > 0 ? Math.min((used / max) * 100, 100).toFixed(1) : "0.0";
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  // Detect once at load time — which character this locale uses as decimal separator
  const _localeDecimal = (() => {
    try {
      return new Intl.NumberFormat(navigator.language)
        .formatToParts(1.1)
        .find(p => p.type === 'decimal')?.value ?? '.';
    } catch (_) {
      return '.';
    }
  })();

  function parseNumber(raw) {
    if (!raw) return 0;
    const s = raw.toString().trim().replace(/[$\s]/g, "");
    if (!s) return 0;

    const lastComma = s.lastIndexOf(",");
    const lastDot   = s.lastIndexOf(".");

    let normalized;
    if (lastComma < 0 && lastDot < 0) {
      // plain integer
      normalized = s;
    } else if (lastComma < 0) {
      // only dots → standard decimal (e.g. "1234.56")
      normalized = s;
    } else if (lastDot < 0) {
      // only commas
      const afterComma  = s.length - lastComma - 1;
      const commaCount  = (s.match(/,/g) || []).length;
      const beforeComma = s.slice(0, lastComma);
      if (commaCount > 1) {
        // multiple commas → EN thousands separator: "1,234,567"
        normalized = s.replace(/,/g, "");
      } else if (afterComma === 3 && !/^-?0$/.test(beforeComma)) {
        // single comma, exactly 3 trailing digits, non-zero integer part — ambiguous.
        // use locale: EU decimal ("1,500" = 1.5) vs EN thousands ("1,500" = 1500)
        normalized = _localeDecimal === ',' ? s.replace(",", ".") : s.replace(",", "");
      } else {
        // unambiguous decimal comma: "1,5" or "0,001" or "12,34"
        normalized = s.replace(",", ".");
      }
    } else if (lastComma > lastDot) {
      // comma comes after dot → EU format: "1.234,56"
      normalized = s.replace(/\./g, "").replace(",", ".");
    } else {
      // dot comes after comma → US format: "1,234.56"
      normalized = s.replace(/,/g, "");
    }

    const v = parseFloat(normalized);
    return Number.isFinite(v) ? v : 0;
  }

  function getHLLeverage() {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.closest('#' + HF.state.BANNER_ID)) continue;
      const text = (btn.textContent || '').trim();
      const match = text.match(/^(\d+(?:\.\d+)?)x$/i);
      if (match) return parseFloat(match[1]);
    }
    return 1;
  }

  function getSizeUnit() {
    const container = document.querySelector('[data-testid="sz-input"]');
    if (!container) return 'USD';
    const divs = [...container.querySelectorAll('div')].filter(d => {
      if (d.children.length > 1) return false;
      if (d.children.length === 1 && d.children[0].tagName.toLowerCase() !== 'svg') return false;
      return true;
    });
    for (const d of divs) {
      const t = (d.textContent || '').trim().toUpperCase();
      if (!t || t === 'SIZE') continue;
      if (t === 'USD' || t === 'USDC') return 'USD';
      if (/^[A-Z]{2,10}$/.test(t)) return t;
    }
    return 'USD';
  }

  function getCurrentSymbol() {
    // Match /trade/xyz:EUR, /trade/@BTC, /trade/BTC etc — capture dex prefix if present
    const urlMatch = location.pathname.match(/\/trade\/(@?[\w:]+)/);
    if (urlMatch) {
      return urlMatch[1].replace(/^@/, "").toUpperCase();
    }

    const titleMatch = document.title.match(/^([A-Z0-9]+)\s*[\|–—]/);
    if (titleMatch) {
      return titleMatch[1].toUpperCase();
    }

    const candidates = document.querySelectorAll(
      'header *, [class*="asset"] *, [class*="pair"] *, [class*="symbol"] *, ' +
      '[class*="market"] *, [class*="coin"] *, [class*="ticker"] *'
    );
    for (const el of candidates) {
      if (el.children && el.children.length > 0) continue;
      const txt = (el.textContent || "").trim().toUpperCase();
      const m = txt.match(/^([A-Z]{2,10})(?:[\/\-](?:USD[CT]?|PERP))?$/);
      if (m) return m[1];
    }

    const allEls = document.querySelectorAll("span, div, a, button, p");
    for (const el of allEls) {
      if (el.children && el.children.length > 0) continue;
      if (el.offsetParent === null) continue;
      const txt = (el.textContent || "").trim();
      if (txt.length > 20) continue;
      const m = txt.match(/^([A-Z]{2,10})\s*[\/-]\s*(USDC|USD|PERP)$/i);
      if (m) return m[1].toUpperCase();
    }

    return null;
  }

  function inputToNotional(inputValue) {
    if (inputValue <= 0) return 0;
    const unit = getSizeUnit();
    if (unit === 'USD' || unit === 'USDC') return inputValue;
    const symbol = getCurrentSymbol();
    const price = symbol ? (HF.state.midPrices[symbol] || 0) : 0;
    return price > 0 ? inputValue * price : 0;
  }

  function notionalToInput(notional) {
    if (notional <= 0) return 0;
    const unit = getSizeUnit();
    if (unit === 'USD' || unit === 'USDC') return notional;
    const symbol = getCurrentSymbol();
    const price = symbol ? (HF.state.midPrices[symbol] || 0) : 0;
    return price > 0 ? notional / price : 0;
  }

  function readOrderValueFromDOM() {
    const allDivs = document.querySelectorAll('div');
    for (const div of allDivs) {
      if (div.children.length > 0) continue;
      if ((div.textContent || '').trim() !== 'Order Value') continue;
      const row = div.parentElement;
      if (!row) continue;
      for (const sibling of row.children) {
        if (sibling === div) continue;
        const text = (sibling.textContent || '').trim();
        if (text === 'N/A' || !text) return 0;
        return parseNumber(text);
      }
    }
    return 0;
  }

  function isSizeInput(input) {
    if (!(input instanceof HTMLInputElement)) return false;
    return !!input.closest('[data-testid="sz-input"]');
  }

  function isLikelySizeInput(input) {
    if (!(input instanceof HTMLInputElement)) return false;
    if (isSizeInput(input)) return true;
    const hint = (
      (input.placeholder || "") + " " + (input.getAttribute("aria-label") || "")
    ).toLowerCase();
    if (hint.includes("qty") || hint.includes("quantity") || hint.includes("size") || hint.includes("amount")) {
      return true;
    }
    const name = (input.name || "").toLowerCase();
    if (name.includes("qty") || name.includes("quantity") || name.includes("size") || name.includes("amount")) {
      return true;
    }
    return false;
  }

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function parseCssColor(color) {
    if (!color || typeof color !== "string") return null;
    const m = color.match(/rgba?\(([^)]+)\)/i);
    if (!m) return null;
    const parts = m[1].split(",").map((p) => p.trim());
    if (parts.length < 3) return null;
    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    const a = parts.length >= 4 ? Number(parts[3]) : 1;
    if (![r, g, b, a].every(Number.isFinite)) return null;
    return { r, g, b, a };
  }

  function getColorSaturation(color) {
    if (!color) return 0;
    const max = Math.max(color.r, color.g, color.b);
    const min = Math.min(color.r, color.g, color.b);
    if (max <= 0) return 0;
    return (max - min) / max;
  }

  function getButtonActivationScore(button) {
    if (!(button instanceof HTMLElement)) return -Infinity;
    if (button.offsetParent === null) return -Infinity;

    let score = 0;
    const ariaPressed = button.getAttribute("aria-pressed");
    const ariaSelected = button.getAttribute("aria-selected");
    const ariaChecked = button.getAttribute("aria-checked");
    const className = (button.className || "").toLowerCase();
    const dataState = normalizeText(button.getAttribute("data-state"));

    if (ariaPressed === "true" || ariaSelected === "true" || ariaChecked === "true") score += 100;
    if (ariaPressed === "false" || ariaSelected === "false" || ariaChecked === "false") score -= 100;
    if (/\b(active|selected|checked|current)\b/.test(className)) score += 40;
    if (dataState === "active" || dataState === "on" || dataState === "selected") score += 40;

    const styles = window.getComputedStyle(button);
    const bg = parseCssColor(styles.backgroundColor);
    const border = parseCssColor(styles.borderColor);
    if (bg && bg.a > 0.2) {
      score += 10;
      score += getColorSaturation(bg) * 30;
    }
    if (border && border.a > 0.2) {
      score += getColorSaturation(border) * 10;
    }
    return score;
  }

  function getActiveOrderSideFromHlToggle(scope) {
    if (!(scope instanceof Element || scope === document.body)) return null;

    const labels = Array.from(scope.querySelectorAll("div")).filter((el) => {
      const text = normalizeText(el.textContent);
      return text === "buy / long" || text === "sell / short";
    });
    if (!labels.length) return null;

    for (const label of labels) {
      const toggleRoot = label.parentElement;
      if (!toggleRoot) continue;
      const toggleText = normalizeText(toggleRoot.textContent);
      if (!toggleText.includes("buy / long") || !toggleText.includes("sell / short")) continue;

      const marker = toggleRoot.querySelector("div.left, div.right");
      if (marker) {
        if (marker.classList.contains("left")) return "buy";
        if (marker.classList.contains("right")) return "sell";
      }

      const markerParent = marker?.parentElement;
      if (markerParent) {
        if (markerParent.classList.contains("left")) return "buy";
        if (markerParent.classList.contains("right")) return "sell";
      }

      if (toggleRoot.classList.contains("left")) return "buy";
      if (toggleRoot.classList.contains("right")) return "sell";
      if (toggleRoot.parentElement?.classList.contains("left")) return "buy";
      if (toggleRoot.parentElement?.classList.contains("right")) return "sell";
    }

    return null;
  }

  function buildOrderSideCandidates(preferredInput) {
    const candidates = [];
    const seen = new Set();

    if (preferredInput instanceof HTMLInputElement) {
      let current = preferredInput.closest("form") || preferredInput.parentElement;
      let hops = 0;
      while (current && current !== document.body && hops < 10) {
        if (!seen.has(current)) {
          candidates.push(current);
          seen.add(current);
        }
        current = current.parentElement;
        hops += 1;
      }
    }
    if (!seen.has(document.body)) candidates.push(document.body);
    return candidates;
  }

  function getBestSideButtonsInScope(scope) {
    const buttons = scope.querySelectorAll("button");
    let bestBuy = null;
    let bestBuyScore = -Infinity;
    let bestSell = null;
    let bestSellScore = -Infinity;

    for (const button of buttons) {
      if (button.closest("#" + HF.state.BANNER_ID)) continue;
      const text = normalizeText(button.textContent);
      const aria = normalizeText(button.getAttribute("aria-label"));
      const combined = (text + " " + aria).trim();
      if (!combined) continue;

      const score = getButtonActivationScore(button);
      if (combined.includes("buy") || combined.includes("long")) {
        if (score > bestBuyScore) {
          bestBuy = button;
          bestBuyScore = score;
        }
      }
      if (combined.includes("sell") || combined.includes("short")) {
        if (score > bestSellScore) {
          bestSell = button;
          bestSellScore = score;
        }
      }
    }
    return { bestBuy, bestBuyScore, bestSell, bestSellScore };
  }

  function getActiveOrderSide(preferredInput) {
    const scopes = buildOrderSideCandidates(preferredInput);
    for (const scope of scopes) {
      const hlToggleSide = getActiveOrderSideFromHlToggle(scope);
      if (hlToggleSide) return hlToggleSide;

      const { bestBuy, bestBuyScore, bestSell, bestSellScore } = getBestSideButtonsInScope(scope);
      if (!bestBuy && !bestSell) continue;
      if (bestBuy && !bestSell) return "buy";
      if (!bestBuy && bestSell) return "sell";
      if (Math.abs(bestBuyScore - bestSellScore) < 5) continue;
      return bestBuyScore > bestSellScore ? "buy" : "sell";
    }
    return null;
  }

  function isBuyOrderSideActive(preferredInput) {
    const side = getActiveOrderSide(preferredInput);
    return side === "buy";
  }

  const TPSL_TAB_TEXTS = new Set([
    "tp/sl", "tp / sl", "tpsl", "tp", "stop", "stop loss", "take profit",
  ]);
  const ORDER_TYPE_SIBLING_TEXTS = new Set(["market", "limit", "pro", "scale"]);

  function isOrderTypeTabText(text) {
    return TPSL_TAB_TEXTS.has(text) || ORDER_TYPE_SIBLING_TEXTS.has(text);
  }

  function collectOrderTypeTabGroups() {
    const groups = new Map();
    const nodes = document.querySelectorAll('button, [role="tab"], [role="button"]');
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.closest("#" + HF.state.BANNER_ID)) continue;
      if (node.offsetParent === null) continue;
      const text = normalizeText(node.textContent);
      if (!isOrderTypeTabText(text)) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push({ node, text });
    }
    return groups;
  }

  function isTpSlOrderType() {
    const groups = collectOrderTypeTabGroups();
    for (const tabs of groups.values()) {
      const hasTpSl = tabs.some((t) => TPSL_TAB_TEXTS.has(t.text));
      const hasSibling = tabs.some((t) => ORDER_TYPE_SIBLING_TEXTS.has(t.text));
      if (!hasTpSl || !hasSibling) continue;

      let best = null;
      let bestScore = -Infinity;
      for (const t of tabs) {
        const score = getButtonActivationScore(t.node);
        if (score > bestScore) {
          bestScore = score;
          best = t;
        }
      }
      if (best && TPSL_TAB_TEXTS.has(best.text)) return true;
    }
    return false;
  }

  function isLiveEditableInput(input) {
    return (
      input instanceof HTMLInputElement &&
      input.isConnected &&
      !input.disabled &&
      input.offsetParent !== null
    );
  }

  const CLAMP_DEBUG = (() => {
    try {
      return window.HF_CLAMP_DEBUG === true || localStorage.getItem("hf_clamp_debug") === "1";
    } catch (_) {
      return window.HF_CLAMP_DEBUG === true;
    }
  })();

  function clampDebug(event, details = {}) {
    if (!CLAMP_DEBUG) return;
    console.log("[HyperFunded][ClampDebug]", event, details);
  }

  function describeInput(input) {
    if (!(input instanceof HTMLInputElement)) {
      return { kind: "none" };
    }
    return {
      className: (input.className || "").trim(),
      name: input.name || "",
      placeholder: input.placeholder || "",
      value: input.value,
      connected: input.isConnected,
      active: input === document.activeElement,
      inSizeContainer: !!input.closest('[data-testid="sz-input"]'),
      wrapperClass: (input.closest(".sc-fEXmlR")?.className || "").trim(),
    };
  }

  function inputContextSignature(input) {
    if (!(input instanceof HTMLInputElement)) return { className: "", wrapperClass: "" };
    return {
      className: (input.className || "").trim(),
      wrapperClass: (input.closest(".sc-fEXmlR")?.className || "").trim(),
    };
  }

  function withinTolerance(a, b, toleranceBase = Math.max(Math.abs(b) * 0.001, 1e-6)) {
    return Math.abs(a - b) <= toleranceBase;
  }

  function formatSizeForToast(value, unit) {
    if (unit === undefined) unit = getSizeUnit();
    if (!Number.isFinite(value) || value <= 0) return "0";
    if (unit === "USD" || unit === "USDC") {
      return Number(value).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    return parseFloat(Number(value).toFixed(6)).toString();
  }

  HF.utils = {
    marginLimitBasisUsd,
    getMirrorMultiplier,
    resolveExposureSymbol,
    isReduceIntent,
    resolveChallengeModeFromValidator,
    effectiveMaxSingleUsd,
    effectiveMaxTotalUsd,
    fmt,
    pct,
    clamp,
    parseNumber,
    getHLLeverage,
    getSizeUnit,
    getCurrentSymbol,
    inputToNotional,
    notionalToInput,
    readOrderValueFromDOM,
    isSizeInput,
    isLikelySizeInput,
    getActiveOrderSide,
    isBuyOrderSideActive,
    isTpSlOrderType,
    isLiveEditableInput,
    CLAMP_DEBUG,
    clampDebug,
    describeInput,
    inputContextSignature,
    withinTolerance,
    formatSizeForToast,
  };
})();
