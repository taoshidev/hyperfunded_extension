# Hyperstack Extension — Claude Guidelines

## How to Work in This Project

When  suggesting any change to a color, spacing value, token, or component pattern:

1. Update the CSS first
2. Then update the relevant token or rule in `design-rules.md`
3. Then update any affected component examples in `component-library.md`
4. Tell me what changed across all three files before moving on

**Never change a value in only one place.**

## Project Overview

A Chrome extension (MV3) for active traders to monitor their Hyperstack funded trading account, open positions on Hyperliquid, and challenge progress in real-time. Built with HTML/CSS/Vanilla JS. No build step.

## Tech Stack

- **Runtime:** Chrome Extension MV3 (Manifest Version 3)
- **Frontend:** HTML5 + CSS3 + Vanilla JS (no framework)
- **Fonts:** Inter (UI), Menlo (monospace/data)
- **APIs:** Hyperliquid API, Vanta Network Dashboard

## Design Context

### Users

Active/professional traders using Hyperstack's funded challenge program. They open this extension mid-session to check P&L, challenge progress, and drawdown — fast glances under pressure. They are technically literate, data-hungry, and performance-oriented. The job to be done: get accurate status information instantly without disrupting their trading flow.

### Brand Personality

**Precise · Powerful · Elite**

Hyperstack is a performance tool for serious traders. The tone is confident and authoritative — never playful or casual. Think Bloomberg Terminal meets modern web design. Every element earns its place.

### Emotional Goal

The trader should feel **in control and confident** — like a professional with all the data they need. No anxiety, no confusion, no visual noise. The interface should reinforce that they're equipped and informed.

### Aesthetic Direction

- **Primary reference:** Hyperliquid's native UI — dense, dark, technical, data-first
- **Theme:** Dark mode native. Background is near-black (#18181b). Not a dark toggle — designed for darkness
- **Depth:** Glass-morphism via layered white overlays (2–6% opacity), never heavy shadows or gradients
- **Accent:** Teal (#00c6a7) used sparingly for positive/interactive states. Amber (#ffb900) for caution. Red for danger
- **Anti-references:** No gradients-for-gradients'-sake, no rounded bubbly layouts, no bright backgrounds, no playful emoji-heavy UIs

### Design Principles

1. **Data first, decoration never.** Every visual element must serve information clarity. If it doesn't help the user read data faster, remove it.
2. **Precision in typography.** Monospace (`Menlo`) for all financial data — numbers, symbols, prices. Inter for UI chrome. Tight letter-spacing on large values. Tabular figures throughout.
3. **Hierarchy through restraint.** Depth and emphasis come from opacity, not color. Use white at 2–8% to layer cards. Reserve teal for exactly one thing per view.
4. **Elite feel through subtlety.** Micro-interactions (0.15–0.3s ease transitions), barely-visible glows, and precise spacing separate this from generic dark UIs. Nothing should feel heavy or loud.
5. **Status at a glance.** Critical states (drawdown warnings, challenge progress) must be immediately readable without reading text. Color + position + size all encode meaning.

See [design-rules.md](design-rules.md) and [component-library.md](component-library.md) for tokens, component patterns, and typography.

## Accessibility

Standard readable contrast is sufficient. No specific WCAG target. Ensure teal on dark backgrounds meets basic legibility.
