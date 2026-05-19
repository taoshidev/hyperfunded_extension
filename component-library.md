# Component Library

Recurring UI patterns in `popup.html` / `popup.css`. Use these structures when adding new UI. Each section describes the pattern, its full HTML, and the CSS tokens it consumes.

---

## Info Expand (Educational Tooltip)

An inline expandable explanation panel paired with a section header. Users click the circle-i icon to reveal educational text about the metric.

### HTML structure

```html
<!-- Inside a section header or label -->
<div class="section-title">Challenge Progress <button class="info-toggle" aria-expanded="false" data-info="challengeProgress"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M8 7v4M8 5.5v.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></div>
<div class="info-expand" id="info-challengeProgress" hidden>Explanation text goes here. Keep it to 2–3 sentences.</div>
```

For multi-item explanations (e.g. Leverage & Buying Power):

```html
<div class="info-expand" id="info-tradingCapacity" hidden>Overview text.
    <span class="info-expand-item"><strong>Per Pair Limit</strong> — explanation of this sub-metric.</span>
    <span class="info-expand-item"><strong>Portfolio Limit</strong> — explanation of this sub-metric.</span>
</div>
```

### CSS tokens consumed

| Element | Tokens |
|---------|--------|
| `.info-toggle` rest | `color: --text-faint` |
| `.info-toggle` hover | `color: --text-subtle` |
| `.info-toggle[aria-expanded="true"]` | `color: --accent` |
| `.info-expand` text | `--font-ui`, 11px, `--text-subtle`, line-height 1.6 |
| `.info-expand-item strong` | `--text-body`, weight 600 |
| Animation | `max-height 0.25s ease` |

### JS wiring

The `data-info` attribute on the button matches the `id="info-{key}"` on the panel. `popup/explain.js` handles all toggles via `initExplainers()` called on DOMContentLoaded.

---

## Leverage & Buying Power Block (HF-side)

A single block showing the validator-enforced leverage limits on the funded HS account. HL has no limits post-faca41c (orders pass through unchanged), so the previous HL/HF toggle block was collapsed to a single HF-only block. HL exposure data still appears in the injected mirror preview at order entry, where it actually informs an action.

### HTML structure

```html
<div class="capacity-block capacity-block--hs">
    <div class="capacity-header">
        <span class="capacity-title">Leverage &amp; Buying Power</span>
    </div>
    <div class="capacity-basis-note">
        Scaling ratio: HS balance <span id="hfBasisValue">$1,002.26</span> &divide; HL equity <span id="hfBasisHlEquity">$47.99</span> = <span id="hfBasisRatio">20.9x</span>
    </div>
    <!-- Hidden until /limits provides max_asset_class_usd; one sub-bar per class, zero-usage included -->
    <div class="capacity-row" id="hsClassRow" style="display: none;">
        <div class="capacity-row-header">
            <span class="capacity-row-label">Asset Class Limits</span>
        </div>
        <div class="capacity-asset-list" id="hsClassSubBars"></div>
    </div>
    <div class="capacity-row">
        <div class="capacity-row-header">
            <span class="capacity-row-label">Portfolio Limit</span>
            <span class="capacity-row-value"><span id="hfCapacityUsed">$302.72</span> / <span id="hfCapacityMax">$2,004.51</span></span>
        </div>
        <div class="capacity-bar">
            <div class="capacity-fill capacity-fill--total" id="hfCapacityFill" style="width: 15%;"></div>
        </div>
        <div class="capacity-basis-note" id="hsPortfolioNote" style="margin-top: var(--space-1);">The portfolio limit is the overall ceiling and sits below the sum of your asset-class limits — you can't fill every class to its own cap at once.</div>
    </div>
</div>
```

### Tokens used

| Element | Property | Token / Value |
|---------|----------|---------------|
| Title | Font size / weight | `12px / 600` |
| Title | Color | `--text-strong` |
| Basis note | Font size / color | `10px` / `--text-faint` |
| Basis note value | Font / color | `--font-mono` / `--text-body` |
| Row label | Font size / weight | `11px / 500` |
| Row label | Color | `--text-faint` |
| Row label | Text transform | `uppercase`, `letter-spacing: 0.03em` |
| Bar track | Background | `--bar-bg` (neutral white at 6%) |
| Bar fill | Background | DD severity color via JS — teal `#97FCE4` < 70%, amber `#ffb900` 70–90%, red `rgb(239,68,68)` ≥ 90% or breached |
| Pending overlay | Background | 45° stripe in severity color of after-fill %, opacities `0.55 / 0.18` |
| Bar height | — | `10px` |
| Bar radius | — | `5px` |
| Bar spacing | — | `margin-top: --space-1`, `margin-bottom: --space-1` |
| Asset sub-bar track | Background | `--bar-bg` |
| Asset sub-bar fill | Background | DD severity color via JS (same scale as the total bar) |
| Asset sub-bar height | — | `6px` |
| Asset labels | Font | `10px`, Menlo |
| Footer labels | Color | `--text-faint` |
| Footer labels | Font size | `11px` |

### Rules

- Bars use the DD severity scale (teal/amber/red) — same `capColor()` thresholds as the banner DD bars and the injected mirror preview, so proximity-to-cap reads consistently across surfaces. JS sets the fill `background` inline based on severity.
- Two rows: "Asset Class Limits" and "Portfolio Limit". The popup carries no per-pair row — per-pair caps differ pair to pair (`subaccount_positional_leverage_by_tier[tier]` via `/trade-pairs` + the `tier` field on `/limits`), so a single per-pair figure would misreport; the per-pair bar lives in the injected mirror preview where a concrete pair is in context. Per-pair caps still clamp the popup's per-class/portfolio projections internally.
- The class row stays hidden (`display: none`) until `/limits` returns `max_asset_class_usd`, then renders one sub-bar for every capped class — zero-usage classes included — labeled with the uppercase class name (e.g. `COMMODITIES`), sorted by projected usage.
- The injected mirror preview card shows three bars (pair / class / portfolio) with a uniform 8px gap between sections and no divider lines; its class bar is hidden when no class cap applies.
- The class breakdown only lists classes with at least one tradeable pair (forex is omitted while no HL forex pairs exist).
- Caps and filled exposure render whenever the live HS balance is known; only pending projections additionally require the HS÷HL scaling ratio (HL equity > 0). With a zero HL wallet the section still shows caps and filled values rather than "--".
- The basis note shows the scaling ratio as a formula (`HS balance ÷ HL equity = ratio`) so the trader can verify the conversion against their own readings.
- "HL trading is unrestricted" replaces the earlier "no HL-side cap" — same meaning, framed positively (what the trader can do, not what's missing).
- Filled exposure comes from `hsPositionsByCoin` (validator's authoritative size × price). Pending overlay comes from HL resting-orders × mirror ratio (validator only records pending at fill time, so HL clearinghouse is the source).
- Pending is projected against signed current exposure using the mirror-preview branch logic (`add | reduce | flip | new`). A buy pending against a short is **reduce** or **flip**, not additive. Each pair's after-magnitude is then clamped by `pair_cap` and the shared `min(portfolio_room, class_room)` budget. The total row aggregates per-pair after-magnitudes — never the raw sum of pending notional.
- Both the per-class and total rows clamp their aggregated after-magnitude to the row's own cap before display. Per-pair projections each claim the full shared room independently, so the raw sum across same-class (or all) pairs can exceed the cap; the validator caps the row at fill time, so the excess never mirrors. The bar simply fills to `$cap / $cap` — the popup shows no unreachable over-cap figure and no `(capped)` tag (the full bar conveys it).
- Bar segments per branch: add/new = solid current + overlay growth (severity stripe); reduce = solid after + overlay closing tail (teal stripe matching mirror preview); flip = solid jumps to after on new side, no overlay.
- The `± $X pending` text shows the net magnitude delta (sign indicates direction). Insert it *between* filled and `/ cap` so the row reads as a math expression: `$filled + $pending pending / $cap`. Sign and value are space-separated (`+ $171.94`). Same format applies to per-class and portfolio rows. The popup does not append a `(capped)` tag — that cue lives only in the mirror preview's order-entry detail line.
- The Portfolio Limit row carries a faint note (`#hsPortfolioNote`, reusing `.capacity-basis-note`), shown only on multi-class accounts (when the Asset Class row is visible): the portfolio cap is the overall ceiling and sits below the sum of the class caps, so the trader can't fill every class to its own cap at once. There is no `(capped)`-style sum figure — the prose alone carries it.
- The class sub-bar list uses a single CSS grid (`display: grid` on `.capacity-asset-list`, `display: contents` on each `.capacity-asset-row`). Symbol / track / value share columns across all rows so every bar's track is the same width — otherwise the row with longer pending text would have a narrower bar, and a smaller yellow segment could visually appear shorter than a larger green segment, breaking severity-by-length comparison.
- Bar fill width and background are set inline via `style="width: XX%; background: ..."` calculated from JS.

### Oversized state modifiers

When notional exceeds the allowed cap, JS adds `--over` modifier classes so the bar reads as breached:

| Element | Class added |
|---------|-------------|
| Total bar track | `capacity-bar--over` |
| Total bar fill | `capacity-fill--over` |
| Asset row track | `capacity-asset-track--over` |
| Asset row fill | `capacity-asset-fill--over` |
| Asset row value | `capacity-asset-value--over` |

Width still clamps to 100%; only color flips. See **Oversized Positions State** in `design-rules.md` for tokens.

---

## Oversize Toast (HL page)

When current open positions already exceed the per-asset or total cap, the content script shows a persistent toast in the top-right of the Hyperliquid page. The popup's capacity bars also flip to red — see "Oversized state modifiers" above. The toast lives on HL (not in the popup) so the trader is alerted in their trading flow without needing to open the extension.

### Structure

The toast is built dynamically in `content/toast.js` (`showOversizeToast()`). Reuses the `--warning` variant surface for visual severity:

```html
<div class="hf-toast hf-toast--warning hf-toast--oversize hf-toast-show">
  <div class="hf-toast-icon"><!-- inline SVG warning glyph --></div>
  <div class="hf-toast-content">
    <div class="hf-toast-title">Hyperstack: Position Size Over Cap</div>
    <div class="hf-toast-msg">
      <b>BTC</b> exposure <b>$1,999.91</b> exceeds the per-asset cap of <b>$352.34</b>.
      Total exposure <b>$1,999.91</b> exceeds the portfolio cap of <b>$1,409.36</b>.
      Reduce or close positions to bring exposure back under the cap.
    </div>
  </div>
</div>
```

### API

| Function | Purpose |
|----------|---------|
| `HF.toast.showOversizeToast()` | Build / refresh the toast. Idempotent — replaces innerHTML if already mounted. |
| `HF.toast.dismissOversizeToast()` | Tear down with the standard 300ms fade. |
| `HF.toast.evaluateOversizeState()` | Read `ACCOUNT.notionalByPair` / `openTotalUsed` against `effectiveMaxSingleUsd()` / `effectiveMaxTotalUsd()` and call show/dismiss. Bails out if `HF.state.limitsLoaded` is false. |

`evaluateOversizeState()` is called from `content/api.js` after each ACCOUNT update: `fetchValidatorData()`, `checkBalance()`, and `fetchTraderLimits()`. Wallet-address change calls `dismissOversizeToast()` directly to clear stale state before the new fetches resolve.

### Rules

- Always lead with the **worst per-asset breach** (largest absolute over-cap value) so the trader has one specific position to act on. If multiple assets are over, append `(+N more over cap)`.
- If total exposure is also over the portfolio cap, append a second sentence — but only after the per-asset line.
- Always end with the action: `Reduce or close positions to bring exposure back under the cap.`
- No dismiss button. The toast disappears automatically once exposure returns under cap. This is intentional — the trader cannot snooze a real risk breach.
- Reuse `hf-toast--warning` styling, do not invent a new color. The trailing `hf-toast--oversize` class is a behavioral marker (used to find/replace the active oversize toast), not a style hook.

---

## Metric Section

A self-contained section displaying a tracked metric with a title and optional right-hand header value, one or more progress bars, and a sublabel. Challenge Progress uses a title/value header; Current Drawdown is title-only in the header (details live in Intraday / EOD Trailing rows).

The header value is **realized return** (`balance / account_size − 1`, where `balance = account_size + realized PnL − fees`) — not the mark-to-market equity return. The section title text lives in `<span id="challengeSectionTitle">` so JS can swap it per account state (see Funded variant). Missing balance/size → `--`, never a wrong number.

### HTML structure

```html
<div class="section">
  <div class="section-header">
    <div class="section-title"><span id="challengeSectionTitle">Challenge Progress</span></div>
    <div class="section-value challenge">6.45% / 10%</div>
  </div>
  <div class="progress-bar">
    <div class="progress-fill" style="width: 61.25%;"></div>
  </div>
  <div class="progress-label">$3,543 to target ($10,000 goal)</div>
</div>
```

### Tokens used

| Property | Token | Notes |
|----------|-------|-------|
| Section title | `--text-strong` | 12px / 600 (UI font) |
| Section value | varies | 12px / 700 (Menlo, tabular-nums); challenge header = `--accent` |
| Drawdown row labels | `--text-faint` | 10px / 600, UI font, uppercase |
| Drawdown row values | `--amber` | 11px / 400, Menlo, tabular-nums |
| Bar height | — | `10px` — uniform bar height |
| Bar radius | — | `5px` track + fill (must match) |
| Bar spacing | — | `margin-top: --space-1`, `margin-bottom: --space-1` |
| Bar background | `--bar-bg` | |
| Challenge fill | `--accent` | |
| Sublabel color | `--text-faint` | 11px, UI font |

### Variants

**Drawdown variant** — section header is title-only; two stacked bars (Intraday + EOD Trailing) with amber fill and amber-tinted tracks. Labels are written in title case in HTML; CSS uppercases them on render:
```html
<div class="drawdown-row">
  <div class="drawdown-row-header">
    <span class="drawdown-row-label">Intraday</span>
    <span class="drawdown-row-value">2.3% / 5%</span>
  </div>
  <div class="progress-bar drawdown-bar">
    <div class="progress-fill drawdown-fill" style="width: 46%;"></div>
  </div>
</div>

<div class="drawdown-row">
  <div class="drawdown-row-header">
    <span class="drawdown-row-label">EOD Trailing</span>
    <span class="drawdown-row-value">2.9% / 5%</span>
  </div>
  <div class="progress-bar drawdown-bar">
    <div class="progress-fill drawdown-fill" style="width: 58%;"></div>
  </div>
</div>
```

| Property | Token / value |
|----------|--------------|
| Row value color | `--amber` |
| Bar background | `rgba(251, 191, 36, 0.1)` (amber tint) |
| Fill gradient | `linear-gradient(90deg, #fbbf24, #f59e0b)` |

**Funded variant** — funded accounts have no profit target, so the Challenge Progress section becomes a plain readout: the title swaps to "Realized Return", the header value shows realized return alone (e.g. `12.50%`, no `/ target`), and the progress bar and goal sublabel are hidden (`display: none`). Challenge accounts keep the title/value/bar/label as above, with progress measured against the fixed 10% target. The same realized-return basis drives both. (The banner mirrors this: its `TARGET` stat is rendered only for challenge accounts.)

---

## Wallet Inline (Header)

The wallet address lives in the header once saved — zero screen real estate wasted on setup UI during normal operation. On first run (no address saved), the full `#walletConfig` card is shown below the header.

### Collapsed state (HTML in `.header-right`)

```html
<div id="walletCollapsed" class="wallet-inline" style="display: none;">
  <span id="walletAddressDisplay" class="wallet-inline-address">0x34...abcd</span>
  <button id="walletEdit" class="wallet-inline-edit">· Edit</button>
</div>
```

### Expanded state (shown on first run or when editing)

```html
<div id="walletConfig" class="wallet-config">
  <div class="wallet-config-header">
    <span class="wallet-config-label">Wallet Address</span>
    <span id="walletStatus" class="wallet-status"></span>
  </div>
  <div class="wallet-input-row">
    <input type="text" id="walletAddress" placeholder="0x..." class="wallet-input" spellcheck="false" />
    <button id="walletSave" class="wallet-save-btn">Save</button>
  </div>
</div>
```

### Tokens used

| Element | Property | Token |
|---------|----------|-------|
| Address text | Font | `--font-mono` |
| Address text | Color | `--text-dim` |
| Edit button | Color | `--text-ghost` → `--text-subtle` on hover |

### Rule

Never show the full wallet-config card when an address is already saved. `showWalletCollapsed()` hides `#walletConfig` and reveals the inline element; `showWalletExpanded()` reverses this.

---

## Accent Card Block

Card treatment is **reserved** for:
- HF Account balance card (primary KPI — the one number that matters most)
- Position cards (grouped interactive data)
- Wallet Config form (setup UI, first-run only)

Everything else — Leverage & Buying Power, Challenge Progress, Drawdown, HL Account, Analytics link — breathes directly on the background. No card needed.

### Position card HTML

```html
<div class="position-card"> ... </div>
```

### Tokens used (position card)

| Property | Token |
|----------|-------|
| Background | `--card-bg` |
| Border | `--border-card` |
| Border radius | `--radius-card` |
| Padding | `16px` uniform |

### Variants

**Primary card** (stronger surface — used by HF Account balance card):
```css
background: var(--card-bg);
border-color: rgba(255,255,255,0.1);
```

**Position card** (uses `--radius-card`, `--card-bg`, `--border-card`, uniform `16px` padding):
```html
<div class="position-card"> ... </div>
```

Position card PnL typography and color:

| Property | Value |
|----------|-------|
| Font | `--font-mono` (Menlo) |
| Size | `14px` |
| Weight | `700` |
| Numeric | `tabular-nums` |

| State | Class | Token |
|-------|-------|-------|
| Positive PnL | `.position-pnl.positive` | `--green` |
| Negative PnL | `.position-pnl.negative` | `--red` |

**Rule:** Never render a directional value (P&L, change) in `--text-primary`. Color encodes direction before the user reads a single character — positive must be green, negative must be red.

---

## Accent Button

Reserved for true primary actions. Currently no instances exist in the popup — the badge components (LONG, In Challenge) use `--accent-bg` but are not buttons. If a primary CTA is added in future, use this pattern.

### Tokens used

| State | Property | Token |
|-------|----------|-------|
| Default | Background | `--accent-bg` |
| Default | Border | `--accent-border` |
| Default | Color | `--text-primary` |
| Hover | Background | `--accent-border` |
| Hover | Border | `--accent-hover-border` |
| Transition | All | `0.15s ease` |

### Do not

- Use raw teal (`--accent`) as a button background — it's too loud. Use `--accent-bg` only.
- Use this pattern for utility or debug actions. See Ghost Button and Muted Button below.

---

## Ghost Button

For utility / setup actions that need to be clearly interactive but should not compete for attention. Current instance: `wallet-save-btn`.

### HTML structure

```html
<button class="wallet-save-btn">Save</button>
```

### Tokens used

| State | Property | Token |
|-------|----------|-------|
| Default | Background | `transparent` |
| Default | Border | `--border-card` |
| Default | Color | `--text-subtle` |
| Hover | Background | `transparent` |
| Hover | Border | `--accent-border` |
| Hover | Color | `--text-primary` |
| Transition | All | `0.15s ease` |

### Rule

Hover reveals a teal border as the only accent signal — confirming interactivity without adding teal to the at-rest view.

---

## Balance Grid

A 2-column grid displaying the HF Account and HL Account as separate cards. Each card is a label/value/sublabel stack.

### HTML structure

```html
<div class="balance-grid">
    <div class="balance-card">
        <div class="balance-label">HF Account</div>
        <div class="balance-value"><span id="fundedBalance">--</span></div>
        <div class="balance-change positive"><span id="fundedChange">--</span></div>
    </div>
    <div class="balance-card">
        <div class="balance-label">HL Account</div>
        <div class="balance-value"><span id="hlBalance">--</span></div>
        <div class="balance-sublabel">Live equity</div>
    </div>
</div>
```

### Tokens used

| Element | Property | Token / Value |
|---------|----------|---------------|
| Grid | Layout | `grid-template-columns: 1fr 1fr`, `gap: --space-2` |
| Card | Surface | `--card-bg` / `--border-card` / `--radius-card` |
| Card | Padding | `--space-4` |
| Label | Font / size / color | `--font-ui` / 10px / `--text-label` |
| Label | Transform | uppercase, letter-spacing 0.08em |
| Label | Spacing | `margin-bottom: --space-1` |
| Value | Font / size / weight | `--font-mono` / 19px / 700 |
| Value | Tracking | -0.38px, tabular-nums |
| Change (positive) | Font / size / color | `--font-ui` / 11px / `--green` |
| Sublabel | Font / size / color | `--font-ui` / 11px / `--text-ghost` |

---

## Label / Value Pair

A vertically stacked label-above-value pattern used wherever data is displayed: balance cards, position details, capacity rows. Uses `--font-mono` for all financial data.

### HTML structure

```html
<!-- Balance card -->
<div class="balance-label">HF Account</div>
<div class="balance-value">$106,456.78</div>
<div class="balance-change positive">+$6,456.78 (6.45%)</div>

<!-- Position detail column -->
<div class="detail-col detail-col--left">
  <span class="detail-label">Size</span>
  <span class="detail-value">0.15 BTC</span>
</div>
```

### Tokens used

| Element | Font | Size | Color token |
|---------|------|------|-------------|
| Label | UI | 10px | `--text-label` (uppercase, 0.08em tracking) |
| Balance value | Menlo | 19px, tracking -0.38px | `--text-primary` |
| Payout value | Menlo | 18px, tracking -0.36px | `--accent` |
| Change — positive | UI | 11px | `--green` |
| Change — negative | UI | 11px | `--red` |
| Change — neutral | UI | 11px | `--text-neutral` |
| Detail label | Menlo | 10px | `--text-dim` |
| Detail value | Menlo | 10px | `--text-subtle` |

### Rule

All prices, sizes, percentages, and symbols **must** use `--font-mono`. Only UI chrome (labels, descriptions, section titles) uses `--font-ui`.

---

## Collapsible Utility Card

A card that collapses to a single-line summary once the user has completed setup. Reduces prime-real-estate cost of configuration UI that is only needed on first run or when editing. Current instance: Wallet Config.

### States

**Collapsed (default after setup):** A single flex row showing a monospace-truncated identifier, a muted confirmation mark, and a ghost edit icon. The full form is hidden in the DOM.

**Expanded (editing):** The full card content — restores on edit icon click, collapses again on save.

### HTML structure

```html
<div id="walletConfig" class="wallet-config">

  <!-- Collapsed state -->
  <div id="walletCollapsed" class="wallet-collapsed" style="display: none;">
    <span id="walletAddressDisplay" class="wallet-address-display">0x1234...abcd</span>
    <span class="wallet-connected-mark">✓</span>
    <button id="walletEdit" class="wallet-edit-btn" title="Edit address">
      <!-- 12×12 pencil SVG -->
    </button>
  </div>

  <!-- Expanded state -->
  <div id="walletExpanded" class="wallet-expanded">
    <div class="wallet-config-header">
      <span class="wallet-config-label">Wallet Address</span>
      <span id="walletStatus" class="wallet-status"></span>
    </div>
    <div class="wallet-input-row">
      <input type="text" id="walletAddress" placeholder="0x..." class="wallet-input" />
      <button id="walletSave" class="wallet-save-btn">Save</button>
    </div>
  </div>

</div>
```

### Tokens used

| Element | Token |
|---------|-------|
| Card surface | `--card-bg-subtle` / `--border-card` |
| Address text | `--font-mono`, `--text-body` |
| Confirmation mark | `--text-subtle` |
| Edit icon (rest) | `--text-ghost` |
| Edit icon (hover) | `--text-subtle` |

### Rules

- Address is truncated to `0x34...1234` format: `address.slice(0, 4) + '...' + address.slice(-4)` — first 4 chars (0x + 2 hex) + last 4 chars, in monospace.
- The confirmation mark (`✓`) uses `--text-subtle`, not `--accent` — it is a confirmation signal, not a call to action.
- The edit icon uses `--text-ghost` at rest (barely visible) and `--text-subtle` on hover. No teal at any state.
- On save: collapse immediately (do not show a success badge — the collapsed address itself is the confirmation).
- The card's outer padding and border remain identical in both states. Only the inner content swaps.

---

## Next Payout Card

A card displaying the next payout amount with a navigation arrow. Interactive — cursor pointer with hover opacity.

### HTML structure

```html
<div class="payout-card">
    <div class="payout-content">
        <div class="payout-left">
            <div class="payout-label">Next Payout</div>
            <div class="payout-value"><span id="payoutAmount">--</span></div>
        </div>
        <div class="payout-arrow">→</div>
    </div>
</div>
```

### Tokens used

| Element | Property | Token / Value |
|---------|----------|---------------|
| Card | Surface | `--card-bg` / `--border-card` / `--radius-card` |
| Card | Padding | `--space-4` |
| Card | Interaction | `cursor: pointer`, hover opacity 0.85 |
| Label | Font / size / color | `--font-ui` / 10px / `--text-label` |
| Label | Transform | uppercase, letter-spacing 0.08em |
| Label | Spacing | `margin-bottom: --space-1` |
| Value | Font / size / weight | `--font-mono` / 18px / 700 |
| Value | Color / tracking | `--accent` / -0.36px, tabular-nums |
| Arrow | Color / size | `--accent` / 18px |

### Rules

- The payout card is always a card (never breathes on bg) — it's navigational.
- The arrow is decorative and part of the click target.
- The `payoutAmount` ID is reserved for JS data binding.

---

## Spacing Tokens

All spacing in this UI uses a 4px base unit. Never hardcode pixel values for `margin`, `padding`, `gap`, or `inset` — use the token scale.

### Token reference

| Token | px equivalent | Primary use in this UI |
|-------|--------------|------------------------|
| `--space-1` | 4px | Tight badge/icon pairs; progress bar `margin-top` |
| `--space-2` | 8px | Flex gaps between inline elements; section header `margin-bottom` |
| `--space-3` | 12px | Card padding (compact variant); section `margin-bottom`; progress bar `margin-bottom` |
| `--space-4` | 16px | Card padding (standard — position cards, balance cards) |
| `--space-5` | 20px | Loose section breathing room |
| `--space-6` | 24px | Container top/bottom padding |
| `--space-8`+ | 32px+ | Reserved for outer layout margins; not used inside cards |

### Component mapping

| Component | Property | Token |
|-----------|----------|-------|
| `.position-card` | `padding` | `--space-3` |
| `.payout-card` | `padding` | `--space-4` |
| `.balance-card` | `padding` | `--space-4` |
| `.wallet-config` | `padding` | `--space-3` |
| `.section` | `margin-bottom` | `--space-3` |
| `.section-header` | `margin-bottom` | `--space-2` |
| `.progress-bar` | `margin-top` | `--space-1` |
| `.progress-bar` | `margin-bottom` | `--space-1` |
| `.wallet-collapsed` | `gap` | `--space-2` |
| `.wallet-input-row` | `gap` | `--space-2` |
| `.detail-grid` | `gap` | `--space-2` |

### Rule

New components must use tokens from this scale. If a value falls between two tokens (e.g. 10px between `--space-2` and `--space-3`), round to the nearest token. Exception: fixed visual dimensions (bar heights, border radii, icon sizes) are not spacing and may use explicit values.

---

## Order Events (dashboard section)

Recent order activity with optional pagination when the filtered list exceeds one page.

### HTML structure

```html
<div class="section">
    <div class="section-header">
        <div class="section-title">Order Events <!-- info-toggle --></div>
        <span class="events-count" id="eventsCount"></span>
    </div>
    <div class="info-expand" id="info-orderEvents" hidden>...</div>
    <div id="eventsContainer">
        <div class="no-more-positions">Loading events...</div>
    </div>
    <div class="events-pagination" id="eventsPagination" hidden>
        <button type="button" id="eventsPagePrev" class="events-page-btn" disabled aria-label="Previous page">‹</button>
        <span class="events-page-label" id="eventsPageLabel" aria-live="polite"></span>
        <button type="button" id="eventsPageNext" class="events-page-btn" disabled aria-label="Next page">›</button>
    </div>
</div>
```

### Tokens used

| Element | Property | Token / Value |
|---------|----------|---------------|
| Event cards | — | `.event-card`, `.event-accepted` / `.event-rejected` (existing) |
| Pagination bar | Border-top / spacing | `var(--border-card)`, `--space-2`, `--space-3` |
| Page label | Font / color | 11px tabular-nums / `var(--text-faint)` |
| Page buttons | Border / hover | `var(--border-card)` → `var(--accent-border)`; `var(--text-subtle)` → `var(--accent)` |

### Rules

- `eventsContainer`, `eventsCount`, `eventsPagination`, `eventsPagePrev`, `eventsPageNext`, `eventsPageLabel` IDs are bound in `popup/events.js`.
- JS shows at most 8 events per page; the full filtered list is sorted newest first.

---

## Not Registered Screen

A welcome/onboarding screen shown when no wallet address is saved. Contains a centered hero block and a wallet input card. Replaces the simpler wallet-config form with a more guided experience.

### HTML structure

```html
<div id="walletConfig" class="screen-not-registered">
    <div class="not-registered-hero">
        <div class="not-registered-icon">⬡</div>
        <div class="not-registered-title">Welcome to Hyperstack</div>
        <div class="not-registered-body">Enter your Hyperliquid wallet address...</div>
    </div>
    <div class="not-registered-card">
        <div class="not-registered-card-header">
            <span class="not-registered-label">Hyperliquid Wallet Address</span>
            <span id="walletStatus" class="wallet-status"></span>
        </div>
        <input type="text" id="walletAddress" placeholder="0x..." class="wallet-input wallet-input--full" spellcheck="false" />
        <button id="walletSave" class="wallet-save-btn wallet-save-btn--full">Check</button>
        <div class="not-registered-signup">
            <span class="not-registered-signup-text">Not registered yet?</span>
            <a href="https://hyperstack.trade" target="_blank" class="not-registered-signup-link">Sign up at hyperstack.trade →</a>
        </div>
    </div>
</div>
```

### Tokens used

| Element | Property | Token / Value |
|---------|----------|---------------|
| Screen layout | Gap | `--space-4` (no padding — inherits container padding) |
| Hero padding-top | — | `--space-8` |
| Icon | Color / size | `--accent` / 28px |
| Title | Font / size / weight / color | `--font-ui` / 14px / 700 / `--text-strong` |
| Body text | Font / size / color / line-height | `--font-ui` / 12px / `--text-body` / 1.7 |
| Body max-width | — | 280px |
| Card surface | Background / border | `--card-bg` / `--border-card` |
| Card radius / padding | — | `--radius-card` / `--space-4` |
| Input label | Font / size / weight / color | `--font-ui` / 11px / 600 / `--text-label` |
| Input | Font / background / border / radius | `--font-mono` 12px / `--bg` / `--border-card` / `--radius-sm` |
| Input padding | — | `--space-2` `--space-3` |
| Input placeholder | Color | `--text-ghost` |
| Button | Pattern | Ghost button (full-width variant) |
| Signup text | Color / size | `--text-subtle` / 11px |
| Signup link | Color / size | `--accent` / 11px |

### Rules

- The outer div retains `id="walletConfig"` for JS compatibility — the JS developer toggles this screen via `style.display`.
- `walletAddress`, `walletSave`, and `walletStatus` IDs must never change — they are bound in popup.js.
- The input uses `--bg` background (not `--input-bg`) to create a recessed effect inside the `--card-bg` card.
- The icon (⬡) is the single teal accent element for this screen — no other element uses `--accent` at rest.

---

## Pending Screen

A status screen shown when the wallet address is saved but no active challenge is found. Displays registration status with an amber progress indicator and placeholder registration details.

### HTML structure

```html
<div id="pendingScreen" class="screen-pending" style="display: none;">
    <div class="pending-status-card">
        <div class="pending-icon">⏳</div>
        <div class="pending-title">Registration Pending</div>
        <div class="pending-body">Your payment was received...</div>
        <div class="pending-progress-bar">
            <div class="pending-progress-fill" style="width: 65%;"></div>
        </div>
        <div class="pending-sublabel">Awaiting validator confirmation...</div>
    </div>
    <div class="pending-details-card">
        <div class="pending-details-title">Registration Details</div>
        <div class="pending-detail-row">
            <span class="pending-detail-key">Account Size</span>
            <span class="pending-detail-value">--</span>
        </div>
        <!-- ... more rows ... -->
        <div class="pending-detail-row pending-detail-row--last">
            <span class="pending-detail-key">Entity Miner</span>
            <span class="pending-detail-value">--</span>
        </div>
    </div>
    <div class="pending-footer-note">You'll receive an email confirmation...</div>
</div>
```

### Tokens used

| Element | Property | Token / Value |
|---------|----------|---------------|
| Screen layout | Padding / gap | `--space-4` / `--space-3` |
| Status card | Background / border / radius / padding | `--card-bg` / `--border-card` / `--radius-card` / `--space-5` |
| Icon | Size | 24px |
| Title | Font / size / weight / color | `--font-ui` / 14px / 700 / `--text-strong` |
| Body | Font / size / color / line-height | `--font-ui` / 12px / `--text-body` / 1.7 |
| Progress bar | Height / track / radius | 4px / `--bar-bg` / 5px |
| Progress fill | Background | `--amber` (flat, no gradient) |
| Progress spacing | margin-top | `--space-3` |
| Sublabel | Color / size | `--amber` / 10px |
| Details card | Background / border / radius / padding | `--card-bg-subtle` / `--border-card` / `--radius-card` / `--space-4` |
| Details title | Font / size / weight / color / transform | `--font-ui` / 10px / 600 / `--text-label` / uppercase 0.08em |
| Detail row | Padding / border | `--space-1` 0 / `--border-card` bottom |
| Detail key | Color / size | `--text-subtle` / 12px |
| Detail value | Color / size / weight | `--text-primary` / 12px / 600 |
| Footer note | Color / size / line-height | `--text-ghost` / 11px / 1.6 |

### Rules

- Hidden by default (`style="display: none;"`). JS developer toggles visibility.
- The progress bar uses the uniform 10px height. Bar purpose is distinguished by color (amber), not height.
- Amber is used for both the progress fill and sublabel, consistent with the caution/waiting semantic.
- The details card uses `--card-bg-subtle` (2% white) vs the status card's `--card-bg` (3% white) to establish visual hierarchy.
- The last detail row uses `pending-detail-row--last` modifier to remove its bottom border.
- All detail values are placeholder `--` text. The JS developer will add IDs or data-binding later.

---

## Positions Screen

A full-list view of all open positions (`#positionsScreen` markup). Includes a header with active count badge, position cards (reused from the dashboard), and a Trading Capacity reminder block.

### HTML structure

```html
<div id="positionsScreen" class="screen-positions" style="display: none;">
    <div class="positions-header">
        <span class="positions-title">Open Positions</span>
        <span id="positionsCountBadge" class="positions-count-badge">0</span>
    </div>
    <div class="positions-sublabel">Mirrored from Vanta Network validator</div>
    <div id="positionsListContainer">
        <div class="positions-empty">No open positions</div>
    </div>
    <div class="positions-capacity-reminder">
        <div class="positions-capacity-header">
            <span class="positions-capacity-title">Trading Capacity</span>
            <span id="positionsCapacityPct" class="positions-capacity-pct">0%</span>
        </div>
        <div class="positions-capacity-bar">
            <div class="positions-capacity-fill" id="positionsCapacityFill" style="width: 0%;"></div>
        </div>
        <div class="positions-capacity-note">Max position size enforced in Hyperliquid UI.</div>
    </div>
</div>
```

### Tokens used

| Element | Property | Token / Value |
|---------|----------|---------------|
| Screen layout | Flex / padding / gap | column / `--space-4` / `--space-3` |
| Title | Font / size / weight / color | `--font-ui` / 13px / 700 / `--text-strong` |
| Count badge | Color / bg / border / radius / padding | `--accent` / `--accent-bg` / `--accent-border` / 4px / 2px 6px |
| Count badge | Font / size / weight | `--font-ui` / 10px / 700 |
| Sublabel | Color / size | `--text-ghost` / 11px |
| Empty state | Color / size / padding | `--text-ghost` / 11px / `--space-8` |
| Capacity reminder | Border / bg / radius / padding | `rgba(100,102,241,0.2)` / `rgba(100,102,241,0.04)` / `--radius-card` / `--space-3` |
| Capacity title | Color / size / weight | `--text-strong` / 12px / 600 |
| Capacity pct | Color / size / weight | `--indigo` / 11px / 600 |
| Capacity bar | Height / track / fill / radius | 5px / `--indigo-bg` / `--indigo` / 5px |
| Capacity bar spacing | margin-top / margin-bottom | `--space-2` / `--space-2` |
| Capacity note | Color / size | `--text-faint` / 11px |

### Rules

- Hidden by default (`style="display: none;"`). JS developer toggles visibility.
- Position cards inside `#positionsListContainer` reuse the existing `.position-card` component — no new card pattern.
- The capacity reminder breathes on background (no `--card-bg`), with an indigo-tinted border and faint indigo background.
- The count badge text is the number of active positions, populated by JS.

---

## Payouts Screen

A detail view showing the claimable payout amount, a request button, KYC note, and payout history rows.

### HTML structure

```html
<div id="payoutsScreen" class="screen-payouts" style="display: none;">
    <div class="payouts-claimable-card">
        <div class="payouts-claimable-label">Claimable Payout</div>
        <div class="payouts-claimable-value"><span id="payoutsClaimableAmount">$0.00</span></div>
        <div class="payouts-claimable-wallet"><span id="payoutsWalletAddress">0x00...0000</span></div>
        <button id="payoutsRequestBtn" class="payouts-request-btn">Request Payout</button>
        <div class="payouts-kyc-note">
            <span class="payouts-kyc-text">KYC required for first payout — </span>
            <a href="#" id="payoutsKycLink" class="payouts-kyc-link">Set up via Privado ID →</a>
        </div>
    </div>
    <div class="payouts-history-label">Payout History</div>
    <div id="payoutsHistoryContainer">
        <div class="payouts-history-card">
            <div class="payouts-history-row">
                <div class="payouts-history-left">
                    <div class="payouts-history-amount">$0.00</div>
                    <div class="payouts-history-date">--</div>
                </div>
                <div class="payouts-history-right">
                    <div class="payouts-history-badge">Paid</div>
                    <div class="payouts-history-tx">0x00...0000</div>
                </div>
            </div>
        </div>
    </div>
</div>
```

### Tokens used

| Element | Property | Token / Value |
|---------|----------|---------------|
| Screen layout | Flex / padding / gap | column / `--space-4` / `--space-3` |
| Claimable card | Surface / border / radius / padding | `--card-bg` / `--border-card` / `--radius-card` / `--space-5` |
| Claimable label | Font / size / color / transform | `--font-ui` / 10px / `--text-label` / uppercase 0.08em |
| Claimable value | Font / size / weight / color / tracking | `--font-mono` / 28px / 800 / `--accent` / -0.56px |
| Wallet address | Font / size / color | `--font-ui` / 11px / `--text-subtle` |
| Request button | Pattern | Ghost button (full-width variant) |
| KYC text | Font / size / color | `--font-ui` / 11px / `--text-subtle` |
| KYC link | Font / size / color | `--font-ui` / 11px / `--accent` |
| History label | Font / size / color / transform | `--font-ui` / 11px / `--text-label` / uppercase 0.08em |
| History card | Surface / border / radius / padding | `--card-bg` / `--border-card` / `--radius-card` / `--space-3` |
| History amount | Font / size / weight / color | `--font-mono` / 13px / 600 / `--accent` |
| History date | Font / size / color | `--font-ui` / 11px / `--text-subtle` |
| Paid badge | Color / bg / border / radius / padding | `--accent` / `--accent-bg` / `--accent-border` / 20px / 3px 10px |
| Tx hash | Font / size / color | `--font-mono` / 10px / `--text-ghost` |

### Rules

- Hidden by default (`style="display: none;"`). JS developer toggles visibility.
- The claimable value uses 28px/800 weight — the largest financial value in the system — as a hero KPI.
- The "Paid" badge uses pill-shaped radius (20px) to differentiate from rectangular status badges.
- History rows are individual cards with `--space-2` gap between them (via `margin-top` on adjacent siblings).
- All amounts, dates, and tx hashes are placeholders for JS data binding.

---

## Settings Screen

A full settings view with wallet configuration, push notification toggles, and account management.

### HTML structure

```html
<div id="settingsScreen" class="screen-settings" style="display: none;">
    <div class="settings-back-row">
        <span id="settingsBackBtn" class="settings-back-arrow">←</span>
        <span class="settings-back-title">Settings</span>
    </div>
    <div class="settings-card">
        <div class="settings-section-label">Wallet</div>
        <div class="settings-field">
            <div class="settings-field-label">Hyperliquid Address</div>
            <div class="settings-input-row">
                <input type="text" id="settingsHlAddress" class="settings-input" placeholder="0x..." />
                <button id="settingsHlSave" class="settings-save-btn">Save</button>
            </div>
        </div>
        <div class="settings-field settings-field--second">
            <div class="settings-field-label">Payout Wallet</div>
            <div class="settings-input-row">
                <input type="text" id="settingsPayoutAddress" class="settings-input" placeholder="0x..." />
                <button id="settingsPayoutSave" class="settings-save-btn">Save</button>
            </div>
        </div>
    </div>
    <div class="settings-card">
        <div class="settings-section-label">Push Notifications</div>
        <div class="settings-notif-desc">All on by default. Sent as Chrome push notifications even when the extension is closed.</div>
        <div class="settings-toggle-list">
            <div class="settings-toggle-row">
                <span class="settings-toggle-label">Order mirrored successfully</span>
                <div class="settings-toggle" data-setting="orderMirrored" data-state="on">
                    <div class="settings-toggle-knob"></div>
                </div>
            </div>
            <!-- ... 5 more toggle rows ... -->
            <div class="settings-toggle-row settings-toggle-row--last">
                <span class="settings-toggle-label">Registration complete</span>
                <div class="settings-toggle" data-setting="registrationComplete" data-state="on">
                    <div class="settings-toggle-knob"></div>
                </div>
            </div>
        </div>
    </div>
    <div class="settings-card">
        <div class="settings-section-label">Account</div>
        <button id="settingsDisconnect" class="settings-disconnect-btn">Disconnect Wallet</button>
    </div>
    <div class="settings-footer">Powered by Vanta Network on Bittensor</div>
</div>
```

### Tokens used

| Element | Property | Token / Value |
|---------|----------|---------------|
| Screen layout | Flex / padding / gap | column / `--space-4` 0 (no horizontal) / `--space-3` |
| Back arrow | Font / size / color | 18px / `--text-subtle` |
| Back title | Font / size / weight / color | `--font-ui` / 14px / 700 / `--text-strong` |
| Settings card | Surface / border / radius / padding | `--card-bg` / `--border-card` / `--radius-card` / `--space-4` |
| Section label | Font / size / color / transform | `--font-ui` / 11px / `--text-label` / uppercase 0.08em |
| Field label | Font / size / color | `--font-ui` / 11px / `--text-subtle` |
| Input | Font / bg / border / radius / padding | `--font-mono` 11px / `--bg` / `--border-card` / `--radius-sm` / `--space-2` `--space-3` |
| Save button | Pattern | Ghost button |
| Notif description | Font / size / color / line-height | `--font-ui` / 11px / `--text-subtle` / 1.6 |
| Toggle row | Padding / border-bottom | `--space-2` 0 / `--border-card` |
| Toggle label | Font / size / color | `--font-ui` / 12px / `--text-primary` |
| Toggle pill | See Toggle Pill pattern in design-rules.md |
| Disconnect button | Pattern | Ghost button (full-width) |
| Footer | Font / size / color | `--font-ui` / 10px / `--text-ghost` |

### Rules

- Hidden by default (`style="display: none;"`). JS developer toggles visibility.
- The back arrow (`←`) is a click target for JS to navigate back to the dashboard.
- Settings inputs use `--bg` background (recessed inside `--card-bg` card) — same pattern as the Not Registered screen.
- Toggle state is controlled via `data-state` attribute. CSS reads it; JS writes it.
- The last toggle row uses `settings-toggle-row--last` to remove its bottom border.
- The "Disconnect Wallet" button uses the ghost button pattern — no destructive red styling (confirmation is JS's responsibility).

---

## Hyperliquid clamp toast (content script)

Toast anchored top-right on the Hyperliquid site when the extension blocks or clamps order size against Hyperstack limits. Rendered by `showClampToast()` in `content/toast.js` into `#hf-toast-container`.

### HTML structure (JS-generated)

```html
<div id="hf-toast-container" class="hf-toast-container">
  <div class="hf-toast hf-toast--blocked hf-toast-show">
    <div class="hf-toast-icon">…</div>
    <div class="hf-toast-content">
      <div class="hf-toast-title">Order Blocked</div>
      <div class="hf-toast-msg">Requested size is above your active per-pair limit.</div>
      <button class="hf-toast-details-toggle" type="button" aria-expanded="false" aria-controls="hf-toast-blocked-details">
        <span>Why blocked?</span>
      </button>
      <div id="hf-toast-blocked-details" class="hf-toast-details" hidden>
        <div class="hf-toast-details-head">Why this was blocked</div>
        <ul class="hf-toast-details-list">
          <li><span>What:</span> attempted order exceeds current capacity.</li>
          <li><span>Why:</span> guardrail keeps account inside challenge limits.</li>
          <li><span>How to avoid:</span> reduce size or free capacity first.</li>
        </ul>
      </div>
    </div>
  </div>
</div>
```

### Variants

| Class | When |
|-------|------|
| `hf-toast--warning` | Order prevented — no headroom left under the limit (`allowed === 0`). |
| `hf-toast--alert` | Reduced to a positive allowed size. |
| `hf-toast--blocked` | User-entered order exceeds current capacity; includes a click-to-expand explainer panel. |
| `hf-toast--info` | Registration / payment prompts. |

### Tokens used

See **Hyperliquid page toasts** in `design-rules.md` — all variants (`--alert` / `--warning` / `--info`) use the same fully opaque treatment; CSS is scoped under `#hf-toast-container` with `background: #hex none` so HL cannot layer translucent backgrounds on “Reduced to …” alerts.

### Rules

- Throttle repeated toasts (3s) in JS to avoid spam.
- Icon column is emoji/SVG today; copy may use `<b>` inside `.hf-toast-msg` and details panel bullets.
- For `hf-toast--blocked`, keep default state collapsed and reveal context through `.hf-toast-details-toggle` so dense explanatory text never crowds the first glance.

---

## Hyperliquid injected banner blocked-state styling (content script)

When `shouldBlockTrade` is true, JS applies `hf-blocked` to `#hf-banner`. This class indicates order-capacity blocking, but the banner remains visually neutral (no red danger wash).

### HTML structure (stateful class)

```html
<div id="hf-banner" class="hf-blocked">
  <div class="hf-bar">...</div>
</div>
```

### Tokens used

| Element | Property | Token / Value |
|---------|----------|---------------|
| `.hf-bar` | Bottom border | `--border-card` |
| `.hf-disabled-msg` | Text color | `--text-subtle` |
| `.hf-icon-disabled` | Icon color | `--text-subtle` |
| `.hf-sub-strip` | Surface / border | `rgba(255,255,255,0.03)` / `--border-card` |
| `.hf-sub-strip-btn` | Border / text / hover | `--border-card` / `--text-subtle` / `rgba(255,255,255,0.06)` |

### Rules

- `hf-blocked` is a behavior/state flag; do not treat it as a drawdown-breach color state.
- Reserve red styling for directional loss and true danger semantics (PnL negative, breach values, warning toasts).
