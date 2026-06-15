// Banner HTML generation, updates, drawdown panel, state classes
(() => {
  const HF = window.__HF;
  const { ACCOUNT } = HF.state;

  function ddColor(usagePct) {
    if (usagePct >= 100) return 'var(--red)';
    if (usagePct > 80) return 'var(--amber)';
    return 'var(--accent)';
  }

  function ddBadgeState(usagePct) {
    if (usagePct >= 100) return { label: 'Breached', cls: 'hf-dd-panel-badge--red' };
    if (usagePct > 80) return { label: 'Warning', cls: 'hf-dd-panel-badge--amber' };
    return { label: 'Safe', cls: 'hf-dd-panel-badge--accent' };
  }

  function targetColor(val) {
    if (val >= 10) return 'var(--accent)';
    if (val >= 8) return 'var(--amber)';
    return 'var(--indigo)';
  }

  let ddDocListenerAttached = false;

  function positionDdPanel(banner, trigger, panel) {
    const triggerRect = trigger.getBoundingClientRect();
    const bannerRect = banner.getBoundingClientRect();
    panel.style.left = (triggerRect.left - bannerRect.left) + 'px';
  }

  function wireDdPanel(banner) {
    const trigger = banner.querySelector('#hf-dd-trigger');
    const panel = banner.querySelector('#hf-dd-panel');
    if (!trigger || !panel) return;

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = panel.classList.contains('hf-dd-panel--open');
      panel.classList.toggle('hf-dd-panel--open', !isOpen);
      positionDdPanel(banner, trigger, panel);
    });

    if (!ddDocListenerAttached) {
      document.addEventListener('click', (e) => {
        const p = document.getElementById('hf-dd-panel');
        const t = document.getElementById('hf-dd-trigger');
        if (!p || !t) return;
        if (!p.contains(e.target) && !t.contains(e.target)) {
          p.classList.remove('hf-dd-panel--open');
        }
      });
      ddDocListenerAttached = true;
    }
  }

  // DD thresholds come from the validator only. When absent, show "--" — never
  // a fixed fallback, which would misreport (funded EOD is 8%, not 5%).
  const ddLimit = (v) => (Number.isFinite(v) && v > 0 ? v : null);
  const ddPct = (v, d) => (v == null ? '--' : v.toFixed(d) + '%');

  function updateDdPanel() {
    const { fmt } = HF.utils;
    const dailyUsage = ACCOUNT.intraday_usage_pct || 0;
    const trailingUsage = ACCOUNT.eod_usage_pct || 0;
    const daily = ACCOUNT.daily_loss_pct || 0;
    const trailing = ACCOUNT.eod_trailing_loss_pct || 0;
    const intradayLimit = ddLimit(ACCOUNT.intraday_threshold_pct);
    const eodLimit = ddLimit(ACCOUNT.eod_threshold_pct);
    // Day-open / HWM are reported by the validator as ratios relative to the
    // starting funded size. Multiplying by fundedSize yields the actual $
    // figures the drawdown rules are checked against. If either ratio or
    // fundedSize is missing we have no honest answer — show "--" rather than
    // fall back to a wrong number.
    const fundedSize = Number(ACCOUNT.fundedSize) || 0;
    const dayOpenRatio = ACCOUNT.dailyOpenRatio;
    const hwmRatio = ACCOUNT.eodHwmRatio;
    const dayOpenUsd = (fundedSize > 0 && dayOpenRatio > 0) ? fundedSize * dayOpenRatio : null;
    const hwmUsd = (fundedSize > 0 && hwmRatio > 0) ? fundedSize * hwmRatio : null;
    const fmtOrDash = (v) => (v == null ? '--' : fmt(v));

    const dailyBadge = document.getElementById('hf-dd-daily-badge');
    if (dailyBadge) {
      const ds = ddBadgeState(dailyUsage);
      dailyBadge.textContent = ds.label;
      dailyBadge.className = 'hf-dd-panel-badge ' + ds.cls;
    }

    const trailingBadge = document.getElementById('hf-dd-trailing-badge');
    if (trailingBadge) {
      const ts = ddBadgeState(trailingUsage);
      trailingBadge.textContent = ts.label;
      trailingBadge.className = 'hf-dd-panel-badge ' + ts.cls;
    }

    const dayOpen = document.getElementById('hf-dd-day-open');
    if (dayOpen) dayOpen.textContent = fmtOrDash(dayOpenUsd);
    const dailyBreach = document.getElementById('hf-dd-daily-breach');
    if (dailyBreach) dailyBreach.textContent = fmtOrDash(dayOpenUsd != null && intradayLimit != null ? dayOpenUsd * (1 - intradayLimit / 100) : null);
    const dailyLoss = document.getElementById('hf-dd-daily-loss');
    if (dailyLoss) dailyLoss.textContent = fmtOrDash(dayOpenUsd != null ? dayOpenUsd * daily / 100 : null) + ' (' + daily.toFixed(2) + '%)';
    const dailyBuffer = document.getElementById('hf-dd-daily-buffer');
    if (dailyBuffer) dailyBuffer.textContent = fmtOrDash(dayOpenUsd != null && intradayLimit != null ? dayOpenUsd * (intradayLimit - daily) / 100 : null);

    const hwm = document.getElementById('hf-dd-hwm');
    if (hwm) hwm.textContent = fmtOrDash(hwmUsd);
    const trailingBreach = document.getElementById('hf-dd-trailing-breach');
    if (trailingBreach) trailingBreach.textContent = fmtOrDash(hwmUsd != null && eodLimit != null ? hwmUsd * (1 - eodLimit / 100) : null);
    const trailingLoss = document.getElementById('hf-dd-trailing-loss');
    if (trailingLoss) trailingLoss.textContent = fmtOrDash(hwmUsd != null ? hwmUsd * trailing / 100 : null) + ' (' + trailing.toFixed(2) + '%)';
    const trailingBuffer = document.getElementById('hf-dd-trailing-buffer');
    if (trailingBuffer) trailingBuffer.textContent = fmtOrDash(hwmUsd != null && eodLimit != null ? hwmUsd * (eodLimit - trailing) / 100 : null);
  }

  function getBannerHTML() {
    const { fmt } = HF.utils;
    const dailyUsage = ACCOUNT.intraday_usage_pct || 0;
    const trailingUsage = ACCOUNT.eod_usage_pct || 0;
    const daily = ACCOUNT.daily_loss_pct || 0;
    const trailing = ACCOUNT.eod_trailing_loss_pct || 0;
    const intradayLimit = ddLimit(ACCOUNT.intraday_threshold_pct);
    const eodLimit = ddLimit(ACCOUNT.eod_threshold_pct);
    const target = ACCOUNT.challengeCurrent || 0;
    const targetMax = ACCOUNT.challengeTarget || 10;
    const targetPct = targetMax > 0 ? Math.max(0, Math.min((target / targetMax) * 100, 100)) : 0;
    const equity = ACCOUNT.validatorEquity || 0;
    const fundedSize = Number(ACCOUNT.fundedSize) || 0;
    const dayOpenRatio = ACCOUNT.dailyOpenRatio;
    const hwmRatio = ACCOUNT.eodHwmRatio;
    const dayOpenUsd = (fundedSize > 0 && dayOpenRatio > 0) ? fundedSize * dayOpenRatio : null;
    const hwmUsd = (fundedSize > 0 && hwmRatio > 0) ? fundedSize * hwmRatio : null;
    const fmtOrDash = (v) => (v == null ? '--' : fmt(v));

    return `
      <div class="hf-bar">
        <span class="hf-brand"><img src="${chrome.runtime.getURL('images/hyperstack-logo.svg')}" alt="Hyperstack" class="hf-brand-logo"></span>
        ${ACCOUNT.registrationChecked ? `<span class="hf-status-badge${ACCOUNT.isRegistered ? '' : ' hf-status-badge--unregistered'}">● ${ACCOUNT.isRegistered ? (ACCOUNT.inChallenge ? 'In Challenge' : 'Funded') : 'Unregistered'}</span>` : ''}
        <span class="hf-divider"></span>
        <div class="hf-stat-group">
          <span class="hf-stat-label">HS BALANCE</span>
          <span class="hf-stat-value" id="hf-equity">${fmt(equity)}</span>
        </div>
        <span class="hf-divider"></span>
        <div class="hf-dd-stack hf-dd-trigger" id="hf-dd-trigger">
          <div class="hf-dd-row">
            <span class="hf-dd-label">INTRADAY DD</span>
            <span class="hf-dd-value" id="hf-daily" style="color:${ddColor(dailyUsage)} !important">${daily.toFixed(3)}%</span>
            <span class="hf-dd-suffix">/ ${ddPct(intradayLimit, 0)}</span>
            ${dailyUsage > 80 ? `<span class="hf-dd-warn" style="color:${ddColor(dailyUsage)} !important">\u26a0</span>` : ''}
          </div>
          <div class="hf-dd-row">
            <span class="hf-dd-label">EOD TRAILING DD</span>
            <span class="hf-dd-value" id="hf-trailing" style="color:${ddColor(trailingUsage)} !important">${trailing.toFixed(3)}%</span>
            <span class="hf-dd-suffix">/ ${ddPct(eodLimit, 0)}</span>
            ${trailingUsage > 80 ? `<span class="hf-dd-warn" style="color:${ddColor(trailingUsage)} !important">\u26a0</span>` : ''}
          </div>
        </div>
        <div class="hf-dd-panel" id="hf-dd-panel">
          <div class="hf-dd-panel-header">
            <div class="hf-dd-panel-title">Drawdown Rules</div>
            <div class="hf-dd-panel-sub">Two independent drawdown rules — breaching either results in immediate disqualification.</div>
          </div>
          <div class="hf-dd-panel-grid">
            <div class="hf-dd-panel-col">
              <div class="hf-dd-panel-col-header">
                <span class="hf-dd-panel-dot" style="background:var(--indigo) !important"></span>
                <span class="hf-dd-panel-col-title">RULE 1 — DAILY LOSS LIMIT (${ddPct(intradayLimit, 2)})</span>
                <span class="hf-dd-panel-badge" id="hf-dd-daily-badge">Safe</span>
              </div>
              <div class="hf-dd-panel-rows">
                <div class="hf-dd-panel-row"><span class="hf-dd-panel-key">Day open equity</span><span class="hf-dd-panel-val" id="hf-dd-day-open">${fmtOrDash(dayOpenUsd)}</span></div>
                <div class="hf-dd-panel-row"><span class="hf-dd-panel-key">Breach level</span><span class="hf-dd-panel-val hf-dd-panel-val--red" id="hf-dd-daily-breach">${fmtOrDash(dayOpenUsd != null && intradayLimit != null ? dayOpenUsd * (1 - intradayLimit / 100) : null)}</span></div>
                <div class="hf-dd-panel-row"><span class="hf-dd-panel-key">Current loss</span><span class="hf-dd-panel-val" id="hf-dd-daily-loss">${fmtOrDash(dayOpenUsd != null ? dayOpenUsd * daily / 100 : null)} (${daily.toFixed(2)}%)</span></div>
                <div class="hf-dd-panel-row"><span class="hf-dd-panel-key">Buffer remaining</span><span class="hf-dd-panel-val hf-dd-panel-val--accent" id="hf-dd-daily-buffer">${fmtOrDash(dayOpenUsd != null && intradayLimit != null ? dayOpenUsd * (intradayLimit - daily) / 100 : null)}</span></div>
              </div>
              <div class="hf-dd-panel-note">Checked intraday in real-time. Resets 00:00 UTC.</div>
            </div>
            <div class="hf-dd-panel-col">
              <div class="hf-dd-panel-col-header">
                <span class="hf-dd-panel-dot" style="background:var(--amber) !important"></span>
                <span class="hf-dd-panel-col-title">RULE 2 — EOD TRAILING LOSS LIMIT (${ddPct(eodLimit, 2)})</span>
                <span class="hf-dd-panel-badge" id="hf-dd-trailing-badge">Safe</span>
              </div>
              <div class="hf-dd-panel-rows">
                <div class="hf-dd-panel-row"><span class="hf-dd-panel-key">EOD high water mark</span><span class="hf-dd-panel-val" id="hf-dd-hwm">${fmtOrDash(hwmUsd)}</span></div>
                <div class="hf-dd-panel-row"><span class="hf-dd-panel-key">Breach level</span><span class="hf-dd-panel-val hf-dd-panel-val--red" id="hf-dd-trailing-breach">${fmtOrDash(hwmUsd != null && eodLimit != null ? hwmUsd * (1 - eodLimit / 100) : null)}</span></div>
                <div class="hf-dd-panel-row"><span class="hf-dd-panel-key">Drawdown from HWM</span><span class="hf-dd-panel-val" id="hf-dd-trailing-loss">${fmtOrDash(hwmUsd != null ? hwmUsd * trailing / 100 : null)} (${trailing.toFixed(2)}%)</span></div>
                <div class="hf-dd-panel-row"><span class="hf-dd-panel-key">Buffer remaining</span><span class="hf-dd-panel-val hf-dd-panel-val--accent" id="hf-dd-trailing-buffer">${fmtOrDash(hwmUsd != null && eodLimit != null ? hwmUsd * (eodLimit - trailing) / 100 : null)}</span></div>
              </div>
              <div class="hf-dd-panel-note">Checked at end of day. HWM trails upward with equity gains.</div>
            </div>
          </div>
          <div class="hf-dd-panel-footer">
            <span>Trading day resets 00:00 UTC</span>
            <span class="hf-dd-panel-sep">|</span>
            <span>Intraday checked in real-time</span>
            <span class="hf-dd-panel-sep">|</span>
            <span>EOD trailing checked at end of day</span>
          </div>
        </div>
        ${ACCOUNT.inChallenge ? `
        <span class="hf-divider"></span>
        <div class="hf-stat-group">
          <span class="hf-stat-label">TARGET</span>
          <div class="hf-target-bar" style="--hf-target-pct:${targetPct}%">
            <div class="hf-target-fill" id="hf-target-fill" style="background-color:${targetColor(target)} !important"></div>
          </div>
          <span class="hf-target-value" id="hf-target-val" style="color:${targetColor(target)} !important">${target.toFixed(2)}%</span>
          <span class="hf-target-suffix">/ ${targetMax}%</span>
        </div>` : ''}
        <span class="hf-divider"></span>
        <a href="https://www.hyperstack.trade/rules" target="_blank" class="hf-rules-link">Rules</a>
        <span class="hf-spacer"></span>
      </div>
    `;
  }

  function ensureLayoutFix() {
    if (document.getElementById(HF.state.LAYOUT_STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = HF.state.LAYOUT_STYLE_ID;
    st.textContent = `body { padding-top: ${HF.state.BANNER_HEIGHT}px !important; background-color: #18181b !important; }`;
    (document.head || document.documentElement).appendChild(st);
  }

  function removeLayoutFix() {
    document.getElementById(HF.state.LAYOUT_STYLE_ID)?.remove();
  }

  function applyBannerStateClasses(banner) {
    const dailyUsage = ACCOUNT.intraday_usage_pct || 0;
    const trailingUsage = ACCOUNT.eod_usage_pct || 0;
    banner.classList.remove('hf-blocked', 'hf-warning');
    if (HF.state.shouldBlockTrade) {
      banner.classList.add('hf-blocked');
    } else if (dailyUsage > 80 || trailingUsage > 80) {
      banner.classList.add('hf-warning');
    }
  }

  // Pending notional helpers
  function pendingFromLastEditedInput() {
    const el = HF.state.lastEditedInput;
    if (!el) return 0;
    if (!(el instanceof HTMLInputElement)) return 0;
    if (el.offsetParent === null) return 0;
    const v = HF.utils.parseNumber(el.value);
    if (v <= 0) return 0;
    return HF.utils.inputToNotional(v);
  }

  function pendingFromScan() {
    const inputs = [...document.querySelectorAll("input")].filter(
      (i) => i.offsetParent !== null && !i.disabled
    );
    let qty = 0;
    let price = 0;
    for (const input of inputs) {
      const v = HF.utils.parseNumber(input.value);
      if (v <= 0) continue;
      const ph = (input.placeholder || "").toLowerCase();
      const aria = (input.getAttribute("aria-label") || "").toLowerCase();
      const hint = `${ph} ${aria}`;
      if (hint.includes("price") || hint.includes("limit")) price = v;
      else if (hint.includes("qty") || hint.includes("quantity") || hint.includes("size") || hint.includes("amount")) qty = v;
    }
    if (qty > 0 && price > 0) return qty * price;
    return 0;
  }

  function getPendingNotional() {
    // pendingNotional is set directly from the input by mirror-preview — most reliable.
    // Prioritise it so scheduleUpdate's checkAndBlockButtons() doesn't override the block
    // with a stale DOM read or missing mid-price that returns 0.
    if (HF.state.pendingNotional > 0) return HF.state.pendingNotional;
    const orderValue = HF.utils.readOrderValueFromDOM();
    if (orderValue > 0) return orderValue;
    return pendingFromLastEditedInput() || pendingFromScan() || 0;
  }

  function updateBannerFromValidator() {
    const banner = document.getElementById(HF.state.BANNER_ID);
    if (!banner) return;

    const prevPanel = banner.querySelector('#hf-dd-panel');
    const wasPanelOpen = prevPanel?.classList.contains('hf-dd-panel--open') || false;

    banner.innerHTML = getBannerHTML();
    applyBannerStateClasses(banner);

    banner.querySelector("#hf-dashboard-link")?.addEventListener("click", (e) => {
      e.preventDefault();
      window.open("https://vanta.network/dashboard", "_blank");
    });

    wireDdPanel(banner);
    updateDdPanel();

    if (wasPanelOpen) {
      const trigger = banner.querySelector('#hf-dd-trigger');
      const panel = banner.querySelector('#hf-dd-panel');
      if (trigger && panel) {
        panel.classList.add('hf-dd-panel--open');
        positionDdPanel(banner, trigger, panel);
      }
    }

    updateBanner(getPendingNotional());
  }

  function updateBanner(pendingNotional) {
    const banner = document.getElementById(HF.state.BANNER_ID);
    if (!banner) return;
    HF.tradeGate.checkAndBlockButtons();
  }

  HF.banner = {
    getBannerHTML,
    wireDdPanel,
    updateDdPanel,
    ensureLayoutFix,
    removeLayoutFix,
    applyBannerStateClasses,
    updateBannerFromValidator,
    updateBanner,
    getPendingNotional,
    ddColor,
  };
})();
