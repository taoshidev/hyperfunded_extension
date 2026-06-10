# Hyperstack Chrome Extension

A Chrome extension for active Hyperstack traders to monitor their funded account, open positions, and challenge progress.

## Features

- **Funded Account Balance** - Real-time view of your current balance and performance
- **Challenge Progress** - Visual progress bar showing your progress toward the 8% profit target
- **Drawdown Monitoring** - Track your current drawdown against the 5% maximum
- **Open Positions** - View your active Hyperliquid positions with live P&L
- **Quick Links** - Direct access to Hyperliquid and Vanta Network dashboard
- **Push Notifications** - Get instant notifications when opening the extension showing your position details

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked"
5. Select the folder containing these extension files
6. The Hyperstack extension icon should appear in your Chrome toolbar
7. **Allow notifications** when prompted for the best experience

## Usage

Click the Hyperstack icon in your Chrome toolbar to view your dashboard. The extension displays:

- Current funded account balance with daily performance
- Challenge progress (current: 6.45% / 8% target)
- Drawdown status (current: 2.3% / 5% max)
- Open position details (BTC-PERP long example shown)
- Link to full analytics on Vanta Network

### Notifications

When you open the extension, you'll receive a push notification showing your current open position:
- Symbol and direction (LONG/SHORT)
- Current P&L with percentage
- Position size and leverage
- Entry price and current mark price

Click the notification to open Hyperliquid in a new tab.

## Files

- `manifest.json` - Extension configuration with notifications permission
- `popup.html` - Main extension interface with animated liquid background
- `popup.css` - Styling matching Hyperstack brand
- `popup.js` - Interactive functionality and notification trigger
- `background.js` - Service worker handling push notifications
- `icon16.png`, `icon48.png`, `icon128.png` - Extension icons

## Development

To modify the extension:

1. Edit the relevant files
2. Go to `chrome://extensions/`
3. Click the refresh icon on the Hyperstack extension card
4. Click the extension icon to see your changes

## Notes

This is a demo version showing sample data. In production, this would connect to the Hyperstack API to display real-time account data and send notifications for important events like:
- Reaching profit targets
- Approaching drawdown limits
- New positions opened/closed
- Daily performance updates

## Powered By

- Vanta Network
- Bittensor
- Hyperliquid
