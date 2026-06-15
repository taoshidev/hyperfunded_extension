# Design Rules

Decisions and conventions for the Hyperstack extension. Paste this file as context into any Claude session working on this codebase.

---

## Brand Palette

Hyperstack's four-color brand system:

| Hex | Role |
|-----|------|
| `#12110E` | Warm near-black — root background (`--bg`) |
| `#97FCE4` | Mint teal — primary accent (`--accent`) |
| `#0D735F` | Deep emerald — emphasis / pressed states (`--accent-deep`) |
| `#E1DFD7` | Cream off-white — brand wordmark color (`--brand-cream`) |

---

## Base Surfaces

| Token | Value | Use when |
|-------|-------|----------|
| `--bg` | `#12110E` | Root background for all Hyperstack UI — popup container, injected banner. The single source of truth for the warm near-black base referenced throughout the design system. |

**Rule:** Never hardcode `#12110E` — always use `var(--bg)`. This keeps future theming possible.

---

## White Opacity Scale

The UI uses translucent whites over the warm near-black background (`#12110E`) to create depth. Never use flat gray colors for layered text — use the opacity primitives so elements stay correct on any future dark background.

| Token | Value | Use when |
|-------|-------|----------|
| `--white-90` / `--text-strong` | 90% | Section titles, card titles — the highest readable non-primary text |
| `--white-70` / `--text-body` | 70% | Secondary values, amounts that need to be read but aren't KPIs |
| `--white-50` / `--text-subtle` | 50% | Supplemental info, muted navigation links |
| `--white-45` / `--text-label` | 45% | Field labels, balance card labels — clearly subordinate to values |
| `--white-40` / `--text-faint` | 40% | Progress bar sublabels, subtitles, secondary descriptors |
| `--white-35` / `--text-neutral` | 35% | Separators ("of"), neutral change text, mid-opacity dividers |
| `--white-30` / `--text-ghost` | 30% | Footer text, empty state messages — barely visible, decorative |
| `--text-primary` (`#ffffff`) | 100% | KPI values, primary content — the user's most important data |

**Rule:** Prefer semantic aliases (`--text-strong`, `--text-label`, etc.) in CSS rules. Use the raw primitive (`--white-90`) only if you're defining a new semantic token.

---

## Accent Surfaces

Mint teal (`#97FCE4`) is the brand's single interactive color. It signals: active, safe, positive, interactive.

| Token | Value | Use when |
|-------|-------|----------|
| `--accent` | `#97FCE4` | Progress fills, active indicators, `color` on accent text |
| `--accent-deep` | `#0D735F` | Reserve for emphasis / pressed states / future deep-emerald moments (atmospheric, never primary UI) |
| `--brand-cream` | `#E1DFD7` | Hyperstack wordmark color in the logo SVG only; do not use as general text color |
| `--green` | alias of `--accent` | **Directional/semantic use only:** positive P&L, positive balance change |
| `--accent-bg` | 10% mint | Badge backgrounds only (LONG badge, In Challenge badge) |
| `--accent-border` | 22% mint | Badge borders; also ghost button hover background |
| `--accent-hover-border` | 38% mint | Ghost button hover border only |

**Rule:** Reserve mint for **one element per visual grouping**. Never apply `--accent` to more than one text element in the same card. If two elements compete for mint, one of them is the wrong color.

**Budget:** The 380px popup has two categories of mint:
- **Semantic/directional** (always correct, exempt from budget): `--green` on positive P&L, positive change values — this is trading convention, not brand decoration. A trader reads `color: green` as "winning" before they read the number.
- **Brand accent** (3 max simultaneously): In Challenge badge, challenge progress fill, LONG position badge. That's the brand budget spent.

**Never** render a directional value in `--text-primary`. Color encodes direction before the user reads a single character.

### Button Hierarchy

Three levels. Use the lowest level that communicates the action's importance.

| Level | Use when | Pattern |
|-------|----------|---------|
| **Ghost** | Utility / setup actions (e.g. Save wallet address) | `background: transparent`, `border: --border-card`, hover reveals `--accent-border` |
| **Accent** | Reserved — no primary CTA buttons exist in the current popup | `background: --accent-bg`, `border: --accent-border` |

**Ghost button hover pattern:**
```css
.btn-ghost:hover {
  border-color: var(--accent-border);  /* teal border hint, no fill */
  color: var(--text-primary);
  background: transparent;
}
```

### Toggle Pill

Used exclusively in the Settings notification preferences. A 36×20px pill with a 14px white knob.

| State | Property | Token / Value |
|-------|----------|---------------|
| OFF | Background | `--border-card` (6% white) |
| OFF | Knob position | `left: 3px` |
| ON | Background | `--accent` |
| ON | Knob position | `left: 19px` |
| Knob | Size / color / radius | 14px / `#ffffff` / 50% |
| Pill | Width / height / radius | 36px / 20px / 10px |
| Transition | All | `0.2s ease` |

**Rule:** State is toggled via `data-state="on"` / `data-state="off"` attribute on `.settings-toggle`. JS owns the state — CSS only reads the attribute.

---

## Amber / Caution Surface

Amber (`#ffb900`) signals: approaching a limit, caution, elevated risk. It sits between teal (safe) and red (blocked) in the severity scale.

| Token | Value | Use when |
|-------|-------|----------|
| `--amber` | `#ffb900` | Drawdown values ≥ 4%, target progress ≥ 8%, warning-state bottom borders. Always paired with the ⚠ icon when used on drawdown values. |

**Rule:** Amber is a transitional state — it means "pay attention, not yet critical." If the condition worsens, the value graduates to `--red`. Never use amber and red on the same element simultaneously.

---

## Danger Surfaces

Red signals: blocked, critical, loss, unsafe to trade.

| Token | Value | Use when |
|-------|-------|----------|
| `--danger-bg` | 8% red | Warning panel background, SHORT badge background |
| `--danger-border` | 25% red | Warning panel border, SHORT badge border |
| `--red` | `rgb(239, 68, 68)` | Text color on danger elements (title, badge text) |

**Rule:** Use `--danger-bg` and `--danger-border` as a pair — they're calibrated to work together. Don't mix one without the other. The pulsing border animation on low-balance warnings uses these same tokens so the intensity reads as the same semantic state.

---

## Indigo Surface

Indigo (`#6466f1`) is reserved for the positions-screen capacity reminder block (`.positions-capacity-*`) — a static, non-semantic accent. Capacity bars elsewhere now use the DD-aligned severity scale (teal/amber/red) so the trader reads a single proximity-to-limit signal across all surfaces.

| Token | Value | Use when |
|-------|-------|----------|
| `--indigo` | `#6466f1` | Positions-screen capacity reminder fill |
| `--indigo-bg` | `rgba(100, 102, 241, 0.1)` | Positions-screen capacity reminder track |

**Rule:** Do not use `--indigo` for any semantic purpose — it has no directional meaning. Both the popup Leverage & Buying Power block (`.capacity-fill`) and the injected mirror preview bar (`.hf-mp-bar`) use the DD severity scale (`capColor()`), not indigo. The two indigo tokens above survive only for the positions reminder block.

---

## Card Surfaces

Layered surfaces create depth without heavy shadows. Use the lowest opacity that achieves legibility.

| Token | Value | Use when |
|-------|-------|----------|
| `--card-bg` | 3% white | Primary/elevated card only (HS Account, Position cards) |
| `--card-bg-subtle` | 2% white | Setup/config cards (wallet config form) |
| `--border-card` | 6% white | Standard card border |
| `--border-outer` | 8% white | Container border, stronger dividers |
| `--bar-bg` | 6% white | Progress bar tracks |

**Card usage rule:** Use cards for: HS Account balance card, HL Account balance card (2-column grid), Position cards (grouped interactive data), Next Payout card (navigational destination), Analytics link (navigational destination), Wallet Config form (first-run setup). Everything else — Leverage & Buying Power, Challenge Progress, Drawdown — breathes directly on the background.

**Never** add box-shadows to cards — depth comes from opacity layering only.

---

## Hyperliquid page toasts (content script)

Fixed-position toasts injected on the Hyperliquid trading page (`content.css` — `.hf-toast-*`). Used for order clamp feedback and registration prompts.

| Rule | Value / intent |
|------|----------------|
| Host isolation | Do **not** use `var(--bg)` / `var(--text-primary)` on toasts — Hyperliquid defines those on `:root`; a translucent `--bg` made injected toasts look “see-through.” Prefer **`#hf-toast-container`-scoped** rules in `content.css` so page `background` shorthands lose the cascade war; use literal `background: #hex none` (not only `background-color`) so host `background-image` layers are cleared. No `::before` glow on toasts — it read as transparency. |
| Shown state | `opacity: 1` on `.hf-toast-show` — must stay fully opaque over HL’s busy UI. |
| Default surface | Solid `#1A1814`, 14% white border, inset + outer shadow for separation from the chart. |
| `--warning` (order prevented / zero headroom) | Solid `#120f0f`, strong red border + 3px left `#f87171`, title `#fecaca`, body ~94% white, light text-shadow for legibility on busy pixels. |
| `--alert` (clamped but non-zero) | Solid `#1a1712`, amber border + 3px left `#ffb900`, title `#fcd34d`. |
| `--info` | Solid `#1A1814`, teal border + 3px left `#97FCE4` — no translucent “glass” fill. |
| `--blocked` (manual over-limit attempt) | Compact red-leaning toast (`280px` width) with title `#f87171`, concise reason line, and a click-to-expand helper panel (`.hf-toast-details`) that explicitly answers **what is happening, why it is blocked, and how to avoid it**. |

**Expandable blocked helper rule:** Keep the first line brief and actionable; put explanatory copy behind a button (`.hf-toast-details-toggle`, label "Why blocked?"). The expanded panel uses a low-contrast red tint (`rgba(248,113,113,0.05)`), 10px text, and three structured bullets (`What`, `Why`, `How to avoid`) so traders can skim under pressure.

---

## Typography Rules

### Font assignment

- **`ui-sans-serif, system-ui, sans-serif`** (`--font-ui`) — all UI chrome: labels, titles, descriptions, section headers, button text. Resolves to SF Pro on macOS, Segoe UI on Windows — native OS fonts with superior rendering vs a web-loaded font in an extension context
- **Menlo** (`--font-mono`) — all financial data, without exception: prices, sizes, symbols, percentages, leverage multipliers, P&L deltas, section values (e.g. "6.45% / 10%"). **Always pair with `font-variant-numeric: tabular-nums`.**

### Type scale

| Use | Font | Size | Weight | Notes |
|-----|------|------|--------|-------|
| Balance value | Menlo | 19px | 700 | tracking -0.38px, tabular-nums — both Funded and HL cards |
| Payout value (inline card) | Menlo | 18px | 700 | tracking -0.36px, tabular-nums, `--accent` |
| Payout value (claimable hero) | Menlo | 28px | 800 | tracking -0.56px, tabular-nums, `--accent` |
| Balance change / P&L delta | UI | 11px | 400 | `--green` or `--red` |
| Section titles (Challenge Progress, Drawdown, Capacity) | UI | 12px | 600 | `--text-strong` |
| Section values (percentages, gauge readings) | Menlo | 12px | 700 | tabular-nums; challenge header = `--accent`; drawdown uses `--amber` on Intraday / EOD Trailing row values only |
| Drawdown row values (Intraday / EOD Trailing) | Menlo | 11px | 400 | tabular-nums; `--amber`, paired with row labels in UI font |
| Balance card label | UI | 10px | 400 | `--text-label`, uppercase, letter-spacing 0.08em |
| Body / misc | UI | 14px | 400 | |
| Capacity footer values | UI | 11px | 400 | `--text-faint` |
| Capacity asset mini-bars | Menlo | 10px | 600 (symbol) / 400 (value) | symbol `--text-secondary`, value `--text-faint`; value text is right-aligned tabular `used / max` |
| Position PnL | UI | 12px | 600 | `--green` / `--red` |
| Trading symbols | Menlo | 12px | 600 | |
| Trading data | Menlo | 10px | 400–600 | |

### Letter-spacing on KPIs

Large monetary values use negative letter-spacing to feel precise and compact:
- 19px values: `letter-spacing: -0.38px`
- 18px values: `letter-spacing: -0.36px`

Do not apply negative tracking to body text or labels.

### Status badges and pills

Small pills (like "In Challenge", "LONG", "LOW BALANCE") use:
- Font: Inter, 10–11px, weight 500–600
- Padding: 3–5px vertical, 6–10px horizontal
- Border radius: 4–12px (use `--radius-card` for header badges, 4px for inline status badges)
- Color: always the semantic color (`--accent`, `--red`) with matching surface (`--accent-bg`/`--danger-bg`)

---

## Spacing Conventions

### Scale

4px base unit. Use tokens only — never raw pixel values for spacing.

| Token | rem | px |
|-------|-----|----|
| `--space-1` | 0.25rem | 4px |
| `--space-2` | 0.5rem | 8px |
| `--space-3` | 0.75rem | 12px |
| `--space-4` | 1rem | 16px |
| `--space-5` | 1.25rem | 20px |
| `--space-6` | 1.5rem | 24px |
| `--space-8` | 2rem | 32px |
| `--space-10` | 2.5rem | 40px |
| `--space-12` | 3rem | 48px |
| `--space-16` | 4rem | 64px |
| `--space-20` | 5rem | 80px |
| `--space-24` | 6rem | 96px |

### Application rules

- **Section margin-bottom:** `--space-3` (12px) — migrating from hardcoded `14px`; use `--space-3` for new work
- **Card padding:** `--space-3` compact · `--space-4` standard (position cards, balance cards)
- **Inner gaps (flex):** `--space-2` (8px) for inline elements; `--space-1` (4px) for tight badge/icon pairs
- **Section header margin-bottom:** `--space-2` (8px) — tight coupling between header and content
- **Progress bar height:** `10px` — all bars use a uniform height for visual consistency
- **Progress bar spacing:** `margin-top: --space-1` · `margin-bottom: --space-1`
- **Border radius ladder:** `--radius-outer` (16px) → `--radius-card` (12px) → `--radius-sm` (8px) → 4–6px badges/inputs; `5px` progress bars (track and fill must match)

---

## Transitions

All interactive elements use one of two durations:
- `0.15s ease` — buttons, border-color changes (snappy, immediate feedback)
- `0.2–0.3s ease` — color changes, width animations (progress bars), link hover states

Never use `cubic-bezier` or spring animations — keep it linear-weighted ease for a precise, technical feel.

---

## Progressive Disclosure

Configuration UI that is only needed once (or rarely) must not consume prime vertical real estate on every open. Collapse it once setup is complete.

**Pattern:** Setup UI moves into the header when configured. The expanded form card only appears on first run or when explicitly editing. Zero screen real estate is spent on configuration during normal operation.

**Wallet address — rules:**
- Collapsed state lives in `.header-right` as `.wallet-inline`: `0x34...1234`. First 4 chars of address (`0x` + 2 hex) + `...` + last 4 chars. Brevity with enough context to recognize the address.
- Address text: `--font-mono`, `--text-dim`. Edit link: `--text-ghost` at rest → `--text-subtle` on hover. No teal at any state.
- `#walletConfig` card is hidden (`display: none`) whenever a saved address exists.
- On save, collapse immediately via `showWalletCollapsed(address)`. No separate success state.
- The full form remains in the DOM (just hidden) so input values are preserved if the user cancels an edit.

---

## Screen States

The popup has three mutually exclusive screen states, toggled via `style.display` in JS:

| State | Trigger | Visible sections | Hidden sections |
|-------|---------|-----------------|-----------------|
| **Not Registered** | No wallet address saved | Header + `#walletConfig` (not-registered screen) + Footer | Pending, all active-trading sections, Positions, Payouts, Settings |
| **Pending** | Address saved, no active challenge | Header + `#pendingScreen` + Footer | walletConfig, all active-trading sections, Positions, Payouts, Settings |
| **Active** | Address saved, active challenge found | Header + walletCollapsed + balance/capacity/challenge/drawdown/positions/events + Footer | walletConfig, pendingScreen, Positions, Payouts, Settings |
| **Payouts** | Payout card tapped from Active | Header + `#payoutsScreen` + Footer | All active-trading sections |
| **Settings** | Settings entry point tapped | Header + `#settingsScreen` + Footer | All active-trading sections |

**Rule:** Screen toggling is JS-only via `style.display`. CSS defines the layout for each screen; JS owns the state machine. Never use CSS classes for screen visibility toggling.

### Progress bar height

All progress bars use a uniform `10px` height for visual consistency. No height-based hierarchy — bar purpose is distinguished by color alone (teal = challenge, amber = drawdown/pending, indigo = capacity). Current Drawdown is represented as two stacked amber bars (Intraday and EOD Trailing), each still `10px`.

---

## Banner Dropdown Panel

The injected banner's Intraday / EOD Trailing stat group is clickable and opens a dropdown panel with detailed drawdown rules.

### Trigger
- `.hf-dd-trigger` on the `.hf-dd-stack` element
- `cursor: pointer`, `opacity: 0.75` on hover, `0.15s ease` transition
- Click toggles `.hf-dd-panel--open` on the panel; clicking outside dismisses

### Panel surface
| Property | Value |
|----------|-------|
| Position | `absolute`, `top: 38px` (below bar), left-aligned to trigger |
| Background | `#16140F` (slightly lighter than `--bg`) |
| Border | `1px solid --border-card`, no top border (visually attaches to bar) |
| Border-radius | `0 0 --radius-card --radius-card` (bottom corners only) |
| Padding | `--space-4` |
| Width | `560px` |
| Shadow | `0 16px 40px rgba(0,0,0,0.7)` |
| z-index | `999998` (one below banner) |

### Layout
- `display: grid`, `grid-template-columns: 1fr 1fr`, `gap: --space-3`
- Header (full-width): title `--text-strong` 14px 700, subtitle `--text-subtle` 11px
- Each column: dot (8px circle, indigo or amber) + uppercase title + status badge
- 4 data rows per column: key `--text-subtle` 12px, value `--font-mono` 12px 600 tabular-nums
- Footer (full-width): `--text-ghost` 10px, separator `|` at 0.3 opacity

### Status badges
| State | Color | Background | Border |
|-------|-------|------------|--------|
| Safe | `--accent` | `--accent-bg` | `--accent-border` |
| Warning | `--amber` | `rgba(255,185,0,0.10)` | `rgba(255,185,0,0.20)` |
| Breached | `--red` | `--danger-bg` | `--danger-border` |

**Rule:** Badge state is derived from the drawdown percentage: < 4% = Safe, 4–5% = Warning, >= 5% = Breached. Same thresholds as `ddColor()`.

---

## Injected Banner Blocked State

When orders are blocked due to insufficient remaining capacity, the banner uses the `hf-blocked` class for behavior only (messaging + trade lock state), not a danger surface tint.

| Element | Treatment |
|---------|-----------|
| `.hf-bar` bottom border | `--border-card` (neutral) |
| Optional inline blocked text/icon | `--text-subtle` |
| Optional sub-strip surface | `rgba(255,255,255,0.03)` + `1px solid --border-card` |
| Optional sub-strip CTA | Neutral ghost treatment (`--border-card`, `--text-subtle`) |

**Rule:** Capacity-blocked state should read as constrained, not breached. Reserve red danger surfaces for true loss/drawdown breach semantics only.

---

## Oversized Positions State

When current open positions already exceed the allowed cap (per-asset or total) — e.g. validator limits tightened, mark price moved, or the user took on positions outside enforced bounds — two surfaces fire:

1. **Capacity bars in the extension popup turn red** so the trader sees the breach when they open the popup.
2. **A persistent toast appears in the top-right of the Hyperliquid page** so the trader is alerted without needing to open the popup.

This is a stronger semantic than "blocked" because the trader has already breached the cap and must reduce exposure (close/trim positions) — the existing blocked-toast handles the inverse case (preventing a *new* order that would exceed cap).

### Popup capacity bars

| Element | Treatment |
|---------|-----------|
| Bar fill (over cap) | `--red` (`.capacity-fill--over`, `.capacity-asset-fill--over`) |
| Bar track / asset track (over cap) | `--danger-bg` (`.capacity-bar--over`, `.capacity-asset-track--over`) |
| Asset row value (over cap) | `--red` (`.capacity-asset-value--over`) |

**Rule:** Oversize is the only place capacity bars use red. Indigo remains the default for all under-cap states (any utilization 0–100% of the limit). The red treatment applies to the fill *and* track (paired tokens) so the bar reads as breached at a glance, not just heavy.

### Hyperliquid page toast (`hf-toast--oversize`)

| Property | Value |
|----------|-------|
| Variant class | `hf-toast hf-toast--warning hf-toast--oversize` (reuses the `--warning` red surface so severity matches "Order Prevented") |
| Title | `"Hyperstack: Position Size Over Cap"` |
| Body | Worst per-asset breach first (`<symbol>` exposure `<used>` exceeds per-asset cap `<max>`), then total breach if also over, then a one-line action ("Reduce or close positions to bring exposure back under the cap.") |
| Persistence | Stays up while the breach holds — no auto-dismiss timer. Re-evaluated after every ACCOUNT update (validator fetch, balance check, limits fetch) via `HF.toast.evaluateOversizeState()` |

**Rule:** Oversize toast is informational + actionable. It must list the *worst* over-cap axis so the trader has one specific position to act on. Don't add a close/dismiss button — the toast disappears automatically once exposure returns under cap.

**Rule:** Don't compete with the blocked-order toast. Oversize fires from already-open exposure; blocked fires from a new order attempt. They can coexist (both appear top-right, stacked).

---

## Info Expand (Educational Tooltips)

Inline expandable explanations that educate users about trading concepts and metrics. A small circle-i icon next to section headers toggles a collapsible text panel.

### Toggle button (`.info-toggle`)
| Property | Value |
|----------|-------|
| Size | Inline, 12×12px SVG icon |
| Color (rest) | `--text-faint` (40%) |
| Color (hover) | `--text-subtle` (50%) |
| Color (expanded) | `--accent` |
| Margin-left | `4px` from label text |
| Transition | `0.15s ease` on color |

### Expand panel (`.info-expand`)
| Property | Value |
|----------|-------|
| Font | `--font-ui`, 11px, weight 400, line-height 1.6 |
| Color | `--text-subtle` (50%) |
| Padding | `6px 0 8px` when visible |
| Animation | `max-height` transition, `0.25s ease` |
| Item labels | `--text-body` (70%), weight 600 via `<strong>` |

**Rule:** Explanations are educational only — they should describe what a metric means and how it affects the user. Never use info-expand for error messages or warnings.

**Rule:** Keep explanation text concise (2–3 sentences max). Traders glance, they don't read paragraphs.

---

## Order events list (pagination)

The dashboard **Order Events** section shows validator order activity. When there are more events than fit a single view, pagination keeps the popup scannable.

| Element | Treatment |
|---------|-----------|
| Page size | `8` events per page (`EVENTS_PER_PAGE` in `popup/events.js`) |
| Controls | Prev / next ghost-style icon buttons (`.events-page-btn`), same hover pattern as other ghost controls: `border-color: var(--accent-border)`, `color: var(--accent)` when enabled |
| Range label | Centered `11px`, `var(--text-faint)`, tabular nums — e.g. `1–8 of 24` |
| Container | `.events-pagination`: top border `var(--border-card)`, `margin-top` / `padding-top` `--space-2`, horizontal flex with `--space-3` gap |
| Visibility | Pagination row is `hidden` when total events ≤ page size, or when there is no list (wallet missing, error, empty) |

**Rule:** Header badge (`.events-count`) continues to show the **total** filtered event count, not the current page only.

---

## Leverage & Buying Power — Hyperstack-Side Block

A single block showing the validator-enforced leverage limits on the funded HS account. HL has no per-pair or portfolio limit (orders pass through unchanged), so a separate HL block was removed — a bar with no real ceiling was misleading. HL exposure data is still available on HL's own UI and in the injected mirror preview at order entry.

| Element | Treatment |
|---------|-----------|
| Block class | `.capacity-block .capacity-block--hs` |
| Title | `Leverage & Buying Power` |
| Basis note | `10px`, `--font-ui`, `--text-faint` — `Scaling ratio: HS balance $X ÷ HL equity $Y = Zx` (no trailing "HL trading is unrestricted" — that meaning lives in the info-expand instead) |
| Basis values | `--font-mono`, `--text-body` — inline monospace for dollar amounts and ratios |
| Bar fill (filled) | DD severity scale via JS — teal `#97FCE4` < 70%, amber `#ffb900` 70–90%, red `rgb(239,68,68)` ≥ 90% or breached. Same `capColor()` thresholds as banner DD and the mirror preview |
| Bar overlay (pending) | 45° striped gradient in the severity color of the after-fill % — pending = "would-be exposure if these limits fill", not real exposure, so it stays striped |
| Bar track | `--bar-bg` (neutral white at 6%) |
| Pending text color | Severity color of after-fill % — matches the stripe color, set inline by JS |

**Rule:** The basis note shows the scaling ratio explicitly as a formula (`HS balance ÷ HL equity = ratio`) rather than a single derived number. Surfacing the inputs lets the trader sanity-check the ratio against their own equity readings.

**Rule:** The phrase "HL trading is unrestricted" replaces the older "no HL-side cap". The trader needs to know HL orders won't be blocked at the exchange — the validator only enforces caps on the HF mirror at fill time.

**Rule:** Two rows: **Per Pair Limit** (validator's per-pair cap) and **Portfolio Limit** (validator's portfolio cap). Both are HF-scale.

**Rule:** Bars consume `hsPositionsByCoin` (validator's authoritative size × price) for filled exposure and HL's resting-order notional × mirror ratio for the pending overlay. The validator records pending only at fill time, so projected pending must come from HL clearinghouse.

**Rule:** Pending is projected against current SIGNED exposure using the same `add | reduce | flip | new` branch logic as the injected mirror preview (`content/mirror-preview.js`). Background's `extractPendingBuyNotional` only emits buy-side resting orders, so a buy pending against a short position must be treated as **reduce** (or **flip** if larger), never as additive exposure. Per-pair after-magnitude is `|currentSigned + pendingBuy|`, then clamped by `pair_cap`, `class_room`, and `portfolio_room`. The per-class and total rows aggregate per-pair after-magnitudes (each clamped at its own cap) — never the raw sum of pending notional.

**Rule:** Bar segments per branch:
- **add / new** — solid = current magnitude, overlay = (after − current) growth, stripe in severity color of after %
- **reduce** — solid = after magnitude (smaller), overlay = (current − after) closing tail in teal stripes (matches mirror preview's "fading away" cue)
- **flip** — solid = after magnitude on the new side, no overlay (the bar snaps to the new size; the side flip itself isn't visualized through 0)

**Rule:** The `± $X pending` text shows the net magnitude delta (`afterMag − currentMag`) — what the bar visually represents — with a `+` for growths and `−` for reductions, separated from the value by a single space (`+ $171.94 pending`, not `+$171.94 pending`). It is inserted *between* filled and `/ cap` so the right-hand side reads as a math-style expression on a single line: `$filled + $pending pending / $cap`. Same format on per-pair and portfolio rows. When `pair_cap` or `portfolio_room` binds the projection, append `(capped)`.

**Rule:** Per-asset row labels show the full Vanta pair name (`BTC/USDC`, `ETH/USDC`, `WTIOIL/USDC`), not the bare coin. The trader may also hold unmirrored pairs on HL (e.g. `BTC/USDT`); the explicit quote currency makes clear which exposure is reflected.

**Rule:** Per-asset rows share grid columns via `display: grid` on `.capacity-asset-list` and `display: contents` on each `.capacity-asset-row`. Without this, each row's `auto 1fr auto` would size independently and bars whose right-side text is longer (e.g. `+ $X pending`) end up narrower than bars without pending text — a smaller yellow-zone bar could appear shorter than a larger green-zone bar, breaking severity comparison. Track widths must be uniform across rows.

---

## Mirror Preview Card (Content Script)

A floating card that appears below the order size input on the Hyperliquid trading page. Shows the HL order notional, mirrored amount on the HS account, and a capacity impact bar.

| Property | Value |
|----------|-------|
| Position | Fixed, below the active size input (8px gap), clamped to viewport |
| Width | `220px` |
| Background | `#1A1814` (solid, no translucency) |
| Border | `1px solid rgba(255,255,255,0.08)` |
| Border radius | `10px` |
| Shadow | `0 8px 24px rgba(0,0,0,0.6)`, subtle white inset glow |
| Row labels | `11px`, `rgba(255,255,255,0.45)` |
| HL value | `12px / 500`, Menlo, `rgba(255,255,255,0.85)` |
| Mirror value | `12px / 600`, Menlo, `#97FCE4` (teal) |
| Mirror ratio | `10px`, Menlo, `rgba(255,255,255,0.3)`, parenthesized |
| Capacity title | `9px / 600`, uppercase, `rgba(255,255,255,0.3)` |
| Capacity pct | `11px / 600`, Menlo, color shifts with after-fill % (teal → amber → red) |
| Capacity bar | `5px` height, two segments (current + delta), DD-style severity colors |
| Capacity detail | `10px`, Menlo, `rgba(255,255,255,0.35)` |
| Transition | `opacity 0.15s ease`, `translateY 0.15s ease` |
| Pointer events | None (does not interfere with order entry) |

**Capacity bar colors (DD-aligned severity scale):**

The bar reads "are you about to breach a hard limit?", so it uses the same teal/amber/red scale as banner DD (`ddColor()`), not popup-style neutral indigo. Two segments encode direction:

| Segment | Width represents | Background |
|---------|------------------|------------|
| Solid (`.hf-mp-bar-current`) | The portion that exists both before and after the order. For add/new: current %. For reduce/flip: after %. | `capColor(solid%)` — teal `#97FCE4` < 70%, amber `#ffb900` 70–90%, red `rgb(239,68,68)` ≥ 90%. |
| Delta — adding (`.hf-mp-bar-pending`) | `afterPct − currentPct`, drawn right of the solid. Color reflects severity of after %. | `barPendingBg(after%)` — teal `rgba(151,252,228,0.4)` < 70%, amber `rgba(255,185,0,0.4)` 70–90%, red `rgba(239,68,68,0.5)` ≥ 90%. |
| Delta — reducing (`.hf-mp-bar-pending`) | `currentPct − afterPct`, drawn right of the solid. The chunk being closed. | `repeating-linear-gradient(135deg, rgba(151,252,228,0.55) 0 2px, rgba(151,252,228,0.15) 2px 4px)` — teal stripes, "fading away" cue. |

**Rule:** Direction is encoded by the delta's visual treatment (solid = adding, striped = reducing). Severity is encoded by the delta's hue (teal/amber/red by after %). Combined: a striped tail always means "you're closing"; a solid amber/red overlay always means "this order is pushing into warning/breach".

**Rule:** The card is non-interactive (`pointer-events: none`). It disappears 1.5s after the input loses focus. If mirror ratio is unavailable (data loading), the mirror row is hidden but HL order and capacity still display. Uses solid-background approach to avoid host CSS interference.

**Rule:** Pair name is rendered with the full Vanta pair label (`BTC/USDC`, `ETH/USDC`, `WTIOIL/USDC`) in both the header symbol and the per-pair limit title (`HF BTC/USDC LIMIT`). Same convention as the popup capacity bar — the explicit `/USDC` quote distinguishes the mirrored pair from any unmirrored holdings the trader may carry on HL.

---

## Side Panel

The extension supports Chrome's Side Panel API for pinning the dashboard alongside the trading page.

| Property | Value |
|----------|-------|
| Width | Fills available panel width (`width: 100%`, `min-width: 300px`) |
| Container | No border, no border-radius (panel provides its own chrome) |
| Pin button | Hidden when already in side panel context (`body[data-context="sidepanel"]`) |

**Rule:** The side panel reuses the same popup HTML/CSS/JS — no separate component library needed. The only adjustments are removing the fixed 380px width and the container's decorative border.

---

## Pin Button (Header)

A ghost icon button in the header that opens the extension as a side panel.

| Property | Value |
|----------|-------|
| Size | `28px × 28px`, centered SVG icon |
| Default | `transparent` bg, `--border-card` border, `--text-faint` icon color |
| Hover | `--accent-border` border, `--text-primary` icon color |
| Transition | `0.15s ease` on border-color and color |
| Hidden | When `chrome.sidePanel` API unavailable; when in side panel context |

---

## What This UI Should Never Have

- Gradients used decoratively (the teal glow in `.container::before` is the only allowed ambient gradient)
- Bright or white backgrounds
- Heavy drop shadows (`box-shadow` on cards)
- Rounded corners larger than `--radius-outer` (16px)
- Bold colors on more than one element in the same card/section
- Emoji used in the UI — use inline SVG icons instead (⚠ warning icon is the only remaining text symbol, acceptable in data contexts)
- Font sizes below 10px or above 22px in the popup UI
