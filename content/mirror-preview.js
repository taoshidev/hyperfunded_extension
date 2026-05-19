// Mirror preview card — shows order size, mirrored amount, and capacity impact
(() => {
  const HF = window.__HF;
  const { ACCOUNT } = HF.state;

  let previewEl = null;
  let hideTimer = null;

  function buildPreviewEl() {
    const el = document.createElement('div');
    el.id = 'hf-mirror-preview';
    el.className = 'hf-mirror-preview';
    el.innerHTML =
      '<div class="hf-mp-header">' +
        '<span class="hf-mp-symbol" id="hf-mp-symbol"></span>' +
        '<span class="hf-mp-mode" id="hf-mp-mode"></span>' +
      '</div>' +
      '<div class="hf-mp-rows">' +
        '<div class="hf-mp-row">' +
          '<span class="hf-mp-label">HL Order</span>' +
          '<span class="hf-mp-val" id="hf-mp-hl-val">--</span>' +
        '</div>' +
        '<div class="hf-mp-row hf-mp-row--mirror" id="hf-mp-mirror-row">' +
          '<span class="hf-mp-label">Mirrors to HF</span>' +
          '<span class="hf-mp-val-group">' +
            '<span class="hf-mp-val hf-mp-val--accent" id="hf-mp-hs-val">--</span>' +
            '<span class="hf-mp-ratio" id="hf-mp-ratio"></span>' +
          '</span>' +
        '</div>' +
      '</div>' +
      '<div class="hf-mp-warning" id="hf-mp-warning" style="display:none"></div>' +
      '<div class="hf-mp-capacity hf-mp-capacity--pair" id="hf-mp-pair-section">' +
        '<div class="hf-mp-cap-header">' +
          '<span class="hf-mp-cap-title" id="hf-mp-pair-title">HF PAIR LIMIT</span>' +
          '<span class="hf-mp-cap-pct" id="hf-mp-pair-pct">--</span>' +
        '</div>' +
        '<div class="hf-mp-bar">' +
          '<div class="hf-mp-bar-current" id="hf-mp-pair-bar-current"></div>' +
          '<div class="hf-mp-bar-pending" id="hf-mp-pair-bar-pending"></div>' +
        '</div>' +
        '<div class="hf-mp-cap-detail" id="hf-mp-pair-detail">-- / --</div>' +
      '</div>' +
      '<div class="hf-mp-capacity">' +
        '<div class="hf-mp-cap-header">' +
          '<span class="hf-mp-cap-title">HF PORTFOLIO</span>' +
          '<span class="hf-mp-cap-pct" id="hf-mp-cap-pct">--</span>' +
        '</div>' +
        '<div class="hf-mp-bar">' +
          '<div class="hf-mp-bar-current" id="hf-mp-bar-current"></div>' +
          '<div class="hf-mp-bar-pending" id="hf-mp-bar-pending"></div>' +
        '</div>' +
        '<div class="hf-mp-cap-detail" id="hf-mp-cap-detail">-- / --</div>' +
      '</div>';
    return el;
  }

  // Find the order form container by walking up from the size input
  function findInsertionPoint(input) {
    // Try the sz-input container first, then walk up to find a good row-level parent
    const szContainer = input.closest('[data-testid="sz-input"]');
    const anchor = szContainer || input;
    // Walk up to a reasonable row/section wrapper (stop before anything too large)
    let row = anchor;
    while (row.parentElement && row.parentElement !== document.body) {
      const parent = row.parentElement;
      // Stop if the parent looks like the full order panel (has many children or is very tall)
      if (parent.children.length > 6) break;
      // Stop if we've gone 4 levels up from the sz container
      row = parent;
      if (row.offsetHeight > 200) break;
    }
    return row;
  }

  function ensurePreviewEl(input) {
    if (previewEl && previewEl.isConnected) return previewEl;
    previewEl = buildPreviewEl();
    // Insert into the page after the size input's row
    const anchor = findInsertionPoint(input);
    if (anchor && anchor.parentElement) {
      anchor.parentElement.insertBefore(previewEl, anchor.nextSibling);
    } else {
      // Fallback: append to body (shouldn't normally happen)
      (document.body || document.documentElement).appendChild(previewEl);
    }
    return previewEl;
  }

  // Live mirror multiplier — HF = HL × (accountBalance / hlBalance).
  // Tracks current PnL because both sides are live equity figures.
  function getMirrorRatio() {
    return HF.utils.getMirrorMultiplier();
  }

  // Severity color matches the banner's ddColor() — teal/amber/red by proximity
  // to the cap. The injected mirror preview bar reads "are you about to breach?"
  // (DD-style semantic), unlike the popup's neutral indigo capacity bar.
  function capColor(pct) {
    if (pct >= 90) return 'rgb(239, 68, 68)';
    if (pct >= 70) return '#ffb900';
    return '#00c6a7';
  }

  function barPendingBg(pct) {
    if (pct >= 90) return 'rgba(239, 68, 68, 0.5)';
    if (pct >= 70) return 'rgba(255, 185, 0, 0.4)';
    return 'rgba(0, 198, 167, 0.4)';
  }

  // Reductions overlay the closing chunk in striped teal — a "fading away"
  // visual that's distinguishable from a teal-solid addition in the safe zone.
  const REDUCE_STRIPE =
    'repeating-linear-gradient(135deg, ' +
    'rgba(0, 198, 167, 0.55) 0, rgba(0, 198, 167, 0.55) 2px, ' +
    'rgba(0, 198, 167, 0.15) 2px, rgba(0, 198, 167, 0.15) 4px)';

  // Vanta API pairs are USDC-quoted on HL. Display the full pair name so the
  // trader can distinguish from any unmirrored USDT pair they might also
  // hold. URL-form symbols (e.g. "XYZ:WTIOIL" from HL routes) and HL API
  // names (e.g. "XYZ:CL") map back to the validator's friendly name (e.g.
  // "WTIOIL") via HF.state.hlCoinToDisplay. Native pairs pass through.
  function formatPairLabel(coin) {
    if (!coin) return '';
    const display = (HF.state && HF.state.hlCoinToDisplay) || {};
    const upper = String(coin).toUpperCase();
    const friendly = display[upper] || display[coin] || coin;
    return `${friendly}/USDC`;
  }

  function showMirrorPreview(input) {
    console.log('[HyperFunded][MirrorPreview] showMirrorPreview called', {
      isRegistered: ACCOUNT.isRegistered,
      registrationChecked: ACCOUNT.registrationChecked,
      hlBalance: ACCOUNT.hlBalance,
      fundedSize: ACCOUNT.fundedSize,
      inputValue: input.value,
      isLikelySizeInput: HF.utils.isLikelySizeInput(input),
    });

    if (!ACCOUNT.isRegistered) {
      console.log('[HyperFunded][MirrorPreview] Skipped: not registered');
      return;
    }

    if (HF.state._unsupportedPairBlocked) {
      hideMirrorPreview();
      return;
    }

    const v = HF.utils.parseNumber(input.value);
    if (v <= 0) {
      hideMirrorPreview();
      return;
    }

    // Notional resolution:
    //   - USD/USDC input: trader's intent IS the notional. HL's "Order Value"
    //     in the DOM can drift below the typed value (lot-size rounding,
    //     slippage estimate at best ask, etc.) which makes the preview show
    //     a smaller number than what the trader typed.
    //   - Coin input (BTC/ETH/...): typed size × price → notional. Prefer
    //     HL's DOM "Order Value" because it uses the limit price for limit
    //     orders, where mid-price would be wrong.
    let notional;
    const sizeUnit = HF.utils.getSizeUnit();
    if (sizeUnit === 'USD' || sizeUnit === 'USDC') {
      notional = v;
    } else {
      notional = HF.utils.readOrderValueFromDOM();
      if (notional <= 0) notional = HF.utils.inputToNotional(v);
    }
    if (notional <= 0) {
      console.log('[HyperFunded][MirrorPreview] Skipped: notional <= 0');
      hideMirrorPreview();
      return;
    }

    console.log('[HyperFunded][MirrorPreview] Showing card', { notional, ratio: getMirrorRatio() });

    // Caps and exposures are compared in HF units. Convert HL exposure /
    // pending order to HF via mirrorMultiplier; caps already come in HF USD
    // from effectiveMax*Usd.
    const ratio = getMirrorRatio();
    const hfOrder = ratio > 0 ? notional * ratio : 0;
    const { fmt, getCurrentSymbol, effectiveMaxSingleUsd, effectiveMaxTotalUsd, getActiveOrderSide } = HF.utils;

    const symbol = getCurrentSymbol();
    const side = getActiveOrderSide(input);
    const resolvedSymbol = HF.utils.resolveExposureSymbol(symbol);

    const pairMax  = effectiveMaxSingleUsd();
    const maxTotal = effectiveMaxTotalUsd();

    // ── Branch detection (add | reduce | flip | new) ──────────────────────
    // Source HL signed exposure (positionValue, signed by szi) for direction
    // and order-vs-position magnitude. The validator's `nl` is never used.
    const hlSignedNow = (resolvedSymbol && Number(ACCOUNT.signedNotionalByPair?.[resolvedSymbol])) || 0;
    const sideSign = side === 'buy' ? 1 : -1;
    const deltaHl = sideSign * notional;
    const hlSignedAfter = hlSignedNow + deltaHl;
    const hlAfterAbs = Math.abs(hlSignedAfter);

    const currentSide = Math.abs(hlSignedNow) < 0.01
      ? null : (hlSignedNow > 0 ? 'long' : 'short');
    const flippedSide = hlSignedAfter > 0.01
      ? 'long' : (hlSignedAfter < -0.01 ? 'short' : null);

    let branch;
    if (!currentSide) {
      branch = 'new';
    } else if ((hlSignedNow > 0) === (deltaHl > 0)) {
      branch = 'add';
    } else if (Math.abs(deltaHl) <= Math.abs(hlSignedNow) + 0.01) {
      branch = 'reduce';
    } else {
      branch = 'flip';
    }

    // ── Source-of-truth current HF values ─────────────────────────────────
    // Strict size × price from validator (sum of signed `q` × current mid
    // price). Never derived from net_leverage or HL_pair × ratio.
    const hfPairs = ACCOUNT.hfPositionsByCoin || {};
    const hfPairEntry = (resolvedSymbol && hfPairs[resolvedSymbol]) || null;
    const currentHsPair = hfPairEntry ? Math.abs(Number(hfPairEntry.value) || 0) : 0;
    const hfTotalNow = Object.values(hfPairs).reduce((s, e) => s + Math.abs(Number(e?.value) || 0), 0);

    // ── Per-branch HF impact ──────────────────────────────────────────────
    // Caps are deterministic (validator clamps at fill time). For PREDICTING
    // the after-fill HF state we project: target = HL_after × ratio, then
    // clamp by pair cap and portfolio cap. Mirrors_to is the net HF movement.
    let afterHsPair = currentHsPair;
    let mirrorsTo = 0;
    let pairCapBinds = false;
    let portCapBinds = false;
    let stillOver = false;        // reduce branch: HL after still ≥ pair cap

    if (branch === 'new' || branch === 'add') {
      const targetHs = hlAfterAbs * ratio;
      let proposedAfter = targetHs;
      if (pairMax > 0 && proposedAfter > pairMax + 0.01) {
        proposedAfter = pairMax;
        pairCapBinds = true;
      }
      let proposed = Math.max(0, proposedAfter - currentHsPair);
      const portAfter = hfTotalNow + proposed;
      if (maxTotal > 0 && portAfter > maxTotal + 0.01) {
        proposed = Math.max(0, proposed - (portAfter - maxTotal));
        portCapBinds = true;
      }
      afterHsPair = currentHsPair + proposed;
      mirrorsTo = proposed;
    } else if (branch === 'reduce') {
      const targetHsAfter = hlAfterAbs * ratio;
      if (pairMax > 0 && targetHsAfter >= pairMax - 0.01) {
        // HL after-position still over implied cap → HF doesn't follow.
        afterHsPair = currentHsPair;
        mirrorsTo = 0;
        stillOver = true;
      } else {
        afterHsPair = targetHsAfter;
        mirrorsTo = Math.max(0, currentHsPair - afterHsPair);
      }
    } else { // flip
      const targetNew = hlAfterAbs * ratio;
      let proposed = targetNew;
      if (pairMax > 0 && proposed > pairMax + 0.01) {
        proposed = pairMax;
        pairCapBinds = true;
      }
      const portAfter = hfTotalNow - currentHsPair + proposed;
      if (maxTotal > 0 && portAfter > maxTotal + 0.01) {
        proposed = Math.max(0, proposed - (portAfter - maxTotal));
        portCapBinds = true;
      }
      afterHsPair = proposed;
      // Net HF movement: close existing + open new.
      mirrorsTo = currentHsPair + proposed;
    }

    const hfTotalAfter = (branch === 'flip')
      ? Math.max(0, hfTotalNow - currentHsPair + afterHsPair)
      : (branch === 'reduce')
      ? Math.max(0, hfTotalNow - mirrorsTo)
      : (hfTotalNow + mirrorsTo);

    const el = ensurePreviewEl(input);

    // ── Header ────────────────────────────────────────────────────────────
    const symbolEl = el.querySelector('#hf-mp-symbol');
    if (symbolEl) symbolEl.textContent = formatPairLabel(symbol) || '—';
    const modeEl = el.querySelector('#hf-mp-mode');
    if (modeEl) modeEl.textContent = ACCOUNT.inChallenge ? 'Challenge' : 'Funded';

    const hlVal = el.querySelector('#hf-mp-hl-val');
    if (hlVal) hlVal.textContent = fmt(notional);

    const mirrorRow = el.querySelector('#hf-mp-mirror-row');
    if (ratio > 0) {
      if (mirrorRow) mirrorRow.style.display = '';
      const hfVal = el.querySelector('#hf-mp-hs-val');
      const ratioEl = el.querySelector('#hf-mp-ratio');
      if (hfVal) hfVal.textContent = fmt(hfOrder);
      if (ratioEl) ratioEl.textContent = '(' + ratio.toFixed(2) + 'x)';
    } else {
      if (mirrorRow) mirrorRow.style.display = 'none';
    }

    // ── Cap warning (branch-aware, $-style, no "would be" hypotheticals) ─
    const warningEl = el.querySelector('#hf-mp-warning');
    if (warningEl) {
      const lines = [];
      const capPhrase = (kind) =>
        kind === 'both'
          ? 'the per-pair cap of <b>' + fmt(pairMax) + '</b> and portfolio cap of <b>' + fmt(maxTotal) + '</b>'
          : kind === 'pair'
          ? 'the per-pair cap of <b>' + fmt(pairMax) + '</b>'
          : 'the portfolio cap of <b>' + fmt(maxTotal) + '</b>';
      const bindKind = (pairCapBinds && portCapBinds) ? 'both' : (pairCapBinds ? 'pair' : 'port');

      if (stillOver) {
        lines.push('After this reduction, HL pair would still exceed the cap. HF stays at <b>' + fmt(pairMax) + '</b> — none of this order mirrors until HL drops below the cap.');
        lines.push('HL trading is unaffected.');
      } else if ((branch === 'new' || branch === 'add') && (pairCapBinds || portCapBinds)) {
        if (mirrorsTo < 0.01) {
          const desc = (bindKind === 'pair')
            ? 'HF pair is at the cap of <b>' + fmt(pairMax) + '</b>'
            : (bindKind === 'port')
            ? 'HF portfolio is at the cap of <b>' + fmt(maxTotal) + '</b>'
            : 'HF pair and portfolio are at the caps';
          lines.push(desc + '. None of this order mirrors.');
          lines.push('HL trading is unaffected.');
        } else {
          lines.push('Order exceeds ' + capPhrase(bindKind) + '. HF will mirror only <b>' + fmt(mirrorsTo) + '</b> before capping at the limit.');
          lines.push('HL trading is unaffected.');
          // Suggest a smaller HL order — only when the pair cap (alone)
          // binds; portfolio-bound headroom depends on other pairs and isn't
          // a clean "lower this order to X" recommendation.
          if (pairCapBinds && !portCapBinds && ratio > 0) {
            const cappedHlRaw = Math.max(0, pairMax - currentHsPair) / ratio;
            const cappedHl = Math.floor(cappedHlRaw * 100) / 100;
            if (cappedHl > 0) {
              lines.push('Lower this HL order to <b>' + fmt(cappedHl) + '</b> or less to mirror fully.');
            }
          }
        }
      } else if (branch === 'flip' && (pairCapBinds || portCapBinds)) {
        const oldS = (currentSide || '').toUpperCase();
        const newS = (flippedSide || '').toUpperCase();
        if (afterHsPair < 0.01) {
          lines.push('This flips your position. HF will close <b>' + fmt(currentHsPair) + ' ' + oldS + '</b>; the new ' + newS + ' is fully blocked by ' + capPhrase(bindKind) + ', so none of the new side mirrors.');
        } else {
          lines.push('This flips your position. HF will close <b>' + fmt(currentHsPair) + ' ' + oldS + '</b> and open <b>' + fmt(afterHsPair) + ' ' + newS + '</b>, capped by ' + capPhrase(bindKind) + '.');
        }
        lines.push('HL trading is unaffected.');
      }

      if (lines.length > 0) {
        warningEl.innerHTML =
          '<span class="hf-mp-warning-icon">⚠</span>' +
          '<span class="hf-mp-warning-text">' +
            lines.map(l => '<div class="hf-mp-warning-line">' + l + '</div>').join('') +
          '</span>';
        warningEl.style.display = '';
      } else {
        warningEl.style.display = 'none';
        warningEl.innerHTML = '';
      }
    }

    // ── Per-pair capacity bar ─────────────────────────────────────────────
    // Bar length always represents |after| / pairMax (HF actual after fill,
    // capped). Color from capColor(after%). Side label in the title; flips
    // get an arrow. Detail line shows transition $-amounts.
    const pairTitle = el.querySelector('#hf-mp-pair-title');
    if (pairTitle) {
      let titleText = 'HF ' + (formatPairLabel(symbol) || 'PAIR') + ' LIMIT';
      if (branch === 'flip' && currentSide && flippedSide) {
        titleText += ' · ' + currentSide.toUpperCase() + ' → ' + flippedSide.toUpperCase();
      } else if (branch === 'reduce' && !flippedSide) {
        titleText += ' · ' + (currentSide || '').toUpperCase() + ' → flat';
      } else {
        const labelSide = flippedSide || currentSide;
        if (labelSide) titleText += ' · ' + labelSide.toUpperCase();
      }
      pairTitle.textContent = titleText;
    }

    const pairCurrentPct = pairMax > 0 ? Math.min(currentHsPair / pairMax * 100, 100) : 0;
    const pairAfterPct   = pairMax > 0 ? Math.min(afterHsPair  / pairMax * 100, 100) : 0;

    const pairPctEl = el.querySelector('#hf-mp-pair-pct');
    const pairBarCurrent = el.querySelector('#hf-mp-pair-bar-current');
    const pairBarPending = el.querySelector('#hf-mp-pair-bar-pending');
    const pairDetail = el.querySelector('#hf-mp-pair-detail');

    if (pairPctEl) {
      pairPctEl.textContent = pairAfterPct.toFixed(1) + '%';
      pairPctEl.style.color = capColor(pairAfterPct);
    }

    // Bar layout (flex: solid then overlay, no `left` positioning needed):
    //   add/new  (going up):   solid = currentPct, overlay = afterPct - currentPct (cap-color)
    //   reduce   (going down): solid = afterPct,   overlay = currentPct - afterPct (green)
    //   reduce-stillOver:      solid = currentPct, overlay = 0
    //   flip:                  solid = afterPct,   overlay = 0   (jumps to new side)
    let pairSolid, pairOverlay, pairOverlayIsReduction;
    if (stillOver) {
      pairSolid = pairCurrentPct; pairOverlay = 0; pairOverlayIsReduction = false;
    } else if (branch === 'flip') {
      pairSolid = pairAfterPct;   pairOverlay = 0; pairOverlayIsReduction = false;
    } else if (branch === 'reduce') {
      pairSolid = pairAfterPct;
      pairOverlay = Math.max(0, pairCurrentPct - pairAfterPct);
      pairOverlayIsReduction = true;
    } else { // new or add
      pairSolid = pairCurrentPct;
      pairOverlay = Math.max(0, pairAfterPct - pairCurrentPct);
      pairOverlayIsReduction = false;
    }

    if (pairBarCurrent) {
      pairBarCurrent.style.width = pairSolid.toFixed(2) + '%';
      pairBarCurrent.style.background = capColor(pairSolid);
    }
    if (pairBarPending) {
      pairBarPending.style.width = pairOverlay.toFixed(2) + '%';
      pairBarPending.style.background = pairOverlayIsReduction
        ? REDUCE_STRIPE
        : barPendingBg(pairAfterPct);
    }

    if (pairDetail) {
      const cur = fmt(currentHsPair);
      const aft = fmt(afterHsPair);
      const capStr = pairMax > 0 ? ' / ' + fmt(pairMax) : '';
      const cappedTag = pairCapBinds ? ' (capped)' : '';
      let text;
      if (branch === 'flip') {
        const oldS = (currentSide || '').toUpperCase();
        const newS = (flippedSide || '').toUpperCase();
        text = cur + ' ' + oldS + ' → ' + aft + ' ' + newS + cappedTag + capStr;
      } else if (branch === 'new') {
        text = aft + cappedTag + capStr;
      } else if (stillOver) {
        text = cur + capStr;
      } else {
        text = cur + ' → ' + aft + cappedTag + capStr;
      }
      pairDetail.textContent = text;
    }

    // ── Portfolio capacity bar (same logic, against maxTotal) ─────────────
    const portCurrentPct = maxTotal > 0 ? Math.min(hfTotalNow   / maxTotal * 100, 100) : 0;
    const portAfterPct   = maxTotal > 0 ? Math.min(hfTotalAfter / maxTotal * 100, 100) : 0;

    const capPctEl = el.querySelector('#hf-mp-cap-pct');
    const barCurrent = el.querySelector('#hf-mp-bar-current');
    const barPending = el.querySelector('#hf-mp-bar-pending');
    const capDetail = el.querySelector('#hf-mp-cap-detail');

    if (capPctEl) {
      capPctEl.textContent = portAfterPct.toFixed(1) + '%';
      capPctEl.style.color = capColor(portAfterPct);
    }

    let portSolid, portOverlay, portOverlayIsReduction;
    if (stillOver) {
      portSolid = portCurrentPct; portOverlay = 0; portOverlayIsReduction = false;
    } else if (branch === 'reduce') {
      portSolid = portAfterPct;
      portOverlay = Math.max(0, portCurrentPct - portAfterPct);
      portOverlayIsReduction = true;
    } else if (branch === 'flip') {
      // Portfolio can move either direction on flip (close - open net effect).
      if (portAfterPct >= portCurrentPct) {
        portSolid = portCurrentPct;
        portOverlay = portAfterPct - portCurrentPct;
        portOverlayIsReduction = false;
      } else {
        portSolid = portAfterPct;
        portOverlay = portCurrentPct - portAfterPct;
        portOverlayIsReduction = true;
      }
    } else { // new or add
      portSolid = portCurrentPct;
      portOverlay = Math.max(0, portAfterPct - portCurrentPct);
      portOverlayIsReduction = false;
    }

    if (barCurrent) {
      barCurrent.style.width = portSolid.toFixed(2) + '%';
      barCurrent.style.background = capColor(portSolid);
    }
    if (barPending) {
      barPending.style.width = portOverlay.toFixed(2) + '%';
      barPending.style.background = portOverlayIsReduction
        ? REDUCE_STRIPE
        : barPendingBg(portAfterPct);
    }

    if (capDetail) {
      const cur = fmt(hfTotalNow);
      const aft = fmt(hfTotalAfter);
      const capStr = maxTotal > 0 ? ' / ' + fmt(maxTotal) : '';
      const cappedTag = portCapBinds ? ' (capped)' : '';
      let text;
      if (branch === 'new') {
        text = aft + cappedTag + capStr;
      } else if (stillOver) {
        text = cur + capStr;
      } else {
        text = cur + ' → ' + aft + cappedTag + capStr;
      }
      capDetail.textContent = text;
    }

    // Cache notional for getPendingNotional() — banner / toast still consume it.
    // Cap-based blocking is gone: HL orders pass through, the warning above is
    // the only feedback path before confirm.
    HF.state.pendingNotional = notional;

    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    void el.offsetWidth;
    el.classList.add('hf-mirror-show');
  }

  function hideMirrorPreview() {
    if (!previewEl) return;
    previewEl.classList.remove('hf-mirror-show');
    HF.state.pendingNotional = 0;
  }

  function onSizeInputChange(input) {
    console.log('[HyperFunded][MirrorPreview] onSizeInputChange triggered');
    showMirrorPreview(input);
  }

  function onSizeInputBlur(input) {
    // Only hide if the input is empty or zero
    const v = input instanceof HTMLInputElement ? HF.utils.parseNumber(input.value) : 0;
    if (v <= 0) {
      hideMirrorPreview();
    }
  }

  function refreshIfVisible() {
    if (!previewEl || !previewEl.classList.contains('hf-mirror-show')) return;
    const input = HF.state.lastEditedInput;
    if (input && HF.utils.isLikelySizeInput(input)) showMirrorPreview(input);
  }

  HF.mirrorPreview = {
    showMirrorPreview,
    hideMirrorPreview,
    onSizeInputChange,
    onSizeInputBlur,
    refreshIfVisible,
  };
})();
