// Popup entry point
import { fmtUsd, truncateAddress } from './format.js';
import { safeSendMessage, getCachedData, loadAddress, saveAddress } from './api.js';
import { applyValidatorData } from './dashboard.js';
import { refreshEvents, renderEvents, initEventsPagination } from './events.js';
import { showDashboard, hideDashboard, showUnregistered, hideUnregistered, showEliminated, hideEliminated, setPlaceholders } from './screens.js';
import { showPositionNotification, setupNotificationClickHandler } from './notifications.js';
import { initExplainers } from './explain.js';

// ── Popup state ──────────────────────────────────────────────────────────────
const state = {
    storedAddress: null,
    traderLimits: null,
    lastValidatorResult: null,
    pairCategory: {},       // display symbol → asset class, from /trade-pairs
    pairTierLeverage: {},   // display symbol → { tier: leverage multiplier }
    hlBalance: 0,
    openTotalUsed: 0,
    openSingleUsed: 0,
    notionalByPair: {},
    filledNotionalByPair: {},
    pendingNotionalByPair: {},
    filledTotal: 0,
    pendingTotal: 0,
    // Sum of HL per-position unrealizedPnl. null until HL clearinghouse
    // returns — display "--" rather than fabricate from validator's
    // `net_leverage × account_size`.
    totalUnrealizedPnl: null,
    // HF per-coin position values, pre-computed by background as strict
    // size × price (sum of signed `q` × current HL mid price). Map:
    // { COIN_UPPER: { quantity, value, side } }. Empty until validator +
    // mid prices return.
    hfPositionsByCoin: {},
    refreshIntervalId: null,
    dashboardShown: false,
};

// ── Data fetching ────────────────────────────────────────────────────────────

async function restoreFromCache() {
    if (!state.storedAddress) return;
    const addr = state.storedAddress.toLowerCase();

    const [balanceCache, validatorCache, limitsCache, eventsCache] = await Promise.all([
        getCachedData(`cache_balance_${addr}`),
        getCachedData(`cache_validator_${addr}`),
        getCachedData(`cache_limits_${addr}`),
        getCachedData(`cache_events_${addr}`),
    ]);

    if (balanceCache?.data) {
        state.hlBalance = balanceCache.data.accountValue || 0;
        state.openTotalUsed = Number(balanceCache.data.openTotalUsed) || 0;
        state.openSingleUsed = Number(balanceCache.data.openSingleUsed) || 0;
        state.notionalByPair = balanceCache.data.notionalByPair && typeof balanceCache.data.notionalByPair === 'object'
            ? balanceCache.data.notionalByPair
            : {};
        state.filledNotionalByPair = balanceCache.data.filledNotionalByPair && typeof balanceCache.data.filledNotionalByPair === 'object'
            ? balanceCache.data.filledNotionalByPair : {};
        state.pendingNotionalByPair = balanceCache.data.pendingNotionalByPair && typeof balanceCache.data.pendingNotionalByPair === 'object'
            ? balanceCache.data.pendingNotionalByPair : {};
        state.filledTotal = Number(balanceCache.data.filledTotal) || 0;
        state.pendingTotal = Number(balanceCache.data.pendingTotal) || 0;
        const cachedUpnl = parseFloat(balanceCache.data.totalUnrealizedPnl);
        state.totalUnrealizedPnl = Number.isFinite(cachedUpnl) ? cachedUpnl : null;
        const hlBalanceEl = document.getElementById('hlBalance');
        if (hlBalanceEl) hlBalanceEl.textContent = fmtUsd(state.hlBalance);
    }

    // Limits must be in state before the cached validator render reads them
    if (limitsCache?.data) {
        state.traderLimits = limitsCache.data;
    }

    if (validatorCache?.data && validatorCache.data.status === 'success') {
        if (validatorCache.data.subaccount_status === 'eliminated') {
            hideDashboard();
            hideUnregistered();
            showEliminated();
        } else {
            state.lastValidatorResult = validatorCache.data;
            applyValidatorData(validatorCache.data, state);
        }
    }

    if (eventsCache?.data) {
        const events = eventsCache.data.events || [];
        if (events.length > 0) renderEvents(events);
    }
}

async function refreshBalance() {
    if (!state.storedAddress) return;
    try {
        const response = await safeSendMessage({ action: 'fetchBalance', address: state.storedAddress });

        state.hlBalance = response.accountValue || 0;
        state.openTotalUsed = Number(response.openTotalUsed) || 0;
        state.openSingleUsed = Number(response.openSingleUsed) || 0;
        state.notionalByPair = response.notionalByPair && typeof response.notionalByPair === 'object'
            ? response.notionalByPair
            : {};
        state.filledNotionalByPair = response.filledNotionalByPair && typeof response.filledNotionalByPair === 'object'
            ? response.filledNotionalByPair : {};
        state.pendingNotionalByPair = response.pendingNotionalByPair && typeof response.pendingNotionalByPair === 'object'
            ? response.pendingNotionalByPair : {};
        state.filledTotal = Number(response.filledTotal) || 0;
        state.pendingTotal = Number(response.pendingTotal) || 0;
        const upnl = parseFloat(response.totalUnrealizedPnl);
        state.totalUnrealizedPnl = Number.isFinite(upnl) ? upnl : null;
        const hlBalanceEl = document.getElementById('hlBalance');
        if (hlBalanceEl) hlBalanceEl.textContent = fmtUsd(state.hlBalance);
    } catch (e) {
        console.error('Balance fetch failed:', e);
    }
}

async function refreshValidatorData() {
    if (!state.storedAddress) return;
    try {
        const result = await safeSendMessage({ action: 'fetchValidatorData', address: state.storedAddress });
        console.log('[Hyperstack Popup] Validator data:', JSON.stringify(result).slice(0, 1000));

        if (result.status !== 'success') {
            console.warn('[Hyperstack Popup] Validator returned non-success status:', result.status);
            if (!state.dashboardShown) {
                hideDashboard();
                showUnregistered();
            }
            return;
        }

        if (result.subaccount_status === 'eliminated') {
            hideDashboard();
            hideUnregistered();
            showEliminated();
            return;
        }

        state.lastValidatorResult = result;
        applyValidatorData(result, state);
    } catch (e) {
        console.error('[Hyperstack Popup] Validator data fetch failed:', e.message, e);
        if (!state.dashboardShown) {
            hideDashboard();
            showUnregistered();
        }
    }
}

async function refreshTraderLimits() {
    if (!state.storedAddress) return;
    try {
        const result = await safeSendMessage({ action: 'fetchTraderLimits', address: state.storedAddress });
        console.log('[Hyperstack Popup] Trader limits:', JSON.stringify(result).slice(0, 500));
        state.traderLimits = result;
    } catch (e) {
        console.error('Trader limits fetch failed:', e);
    }
}

async function refreshTradePairs() {
    if (!state.storedAddress) return;
    try {
        const result = await safeSendMessage({ action: 'fetchTradePairs' });
        const pairs = (result.allowed || result.allowed_trade_pairs || []).filter(
            p => p.trade_pair_source === 'hyperliquid' && !p.trade_pair_id.toLowerCase().startsWith('xyz:')
        );
        if (pairs.length === 0) return;
        const hadPairs = Object.keys(state.pairTierLeverage).length > 0;
        const category = {}, tierLeverage = {};
        pairs.forEach(p => {
            const symbol = p.trade_pair_id.replace(/USDC?$/, '').toUpperCase();
            category[symbol] = p.trade_pair_category || null;
            tierLeverage[symbol] = p.subaccount_positional_leverage_by_tier || null;
        });
        state.pairCategory = category;
        state.pairTierLeverage = tierLeverage;
        // First pair data after render: re-render so caps don't sit on the
        // deprecated class-level fallback until the next refresh tick
        if (!hadPairs && state.lastValidatorResult) {
            applyValidatorData(state.lastValidatorResult, state);
        }
    } catch (e) {
        console.error('Trade pairs fetch failed:', e);
    }
}

function updateData() {
    refreshBalance();
    refreshValidatorData();
    refreshTraderLimits();
    refreshTradePairs();
    // refreshEvents(state.storedAddress);  // Order Events section commented out — re-enable with HTML in popup.html / sidepanel.html
}

// ── Wallet UI helpers ────────────────────────────────────────────────────────

function showWalletCollapsed(address) {
    const collapsed = document.getElementById('walletCollapsed');
    const config = document.getElementById('walletConfig');
    const display = document.getElementById('walletAddressDisplay');
    if (display) display.textContent = truncateAddress(address);
    if (collapsed) collapsed.style.display = 'flex';
    if (config) config.style.display = 'none';
}

function showWalletExpanded() {
    hideUnregistered();
    hideEliminated();
    const collapsed = document.getElementById('walletCollapsed');
    const config = document.getElementById('walletConfig');
    const addressInput = document.getElementById('walletAddress');
    const disconnectBtn = document.getElementById('walletDisconnect');
    if (collapsed) collapsed.style.display = 'none';
    if (config) config.style.display = '';
    if (disconnectBtn) disconnectBtn.style.display = state.storedAddress ? '' : 'none';
    if (addressInput) { addressInput.focus(); addressInput.select(); }
}

function disconnectWallet() {
    if (state.storedAddress) {
        const addr = state.storedAddress.toLowerCase();
        chrome.storage.local.remove([
            `cache_balance_${addr}`, `cache_validator_${addr}`,
            `cache_limits_${addr}`, `cache_events_${addr}`
        ]);
    }
    chrome.storage.local.remove(['hlAddress', 'lastEventTimestampMs', 'recentEvents']);
    state.storedAddress = null;
    state.traderLimits = null;
    state.lastValidatorResult = null;
    state.openTotalUsed = 0;
    state.openSingleUsed = 0;
    state.notionalByPair = {};
    state.totalUnrealizedPnl = null;
    state.hfPositionsByCoin = {};
    if (state.refreshIntervalId) {
        clearInterval(state.refreshIntervalId);
        state.refreshIntervalId = null;
    }
    hideDashboard();
    hideUnregistered();
    hideEliminated();
    const addressInput = document.getElementById('walletAddress');
    if (addressInput) addressInput.value = '';
    const walletStatus = document.getElementById('walletStatus');
    if (walletStatus) { walletStatus.textContent = ''; walletStatus.className = 'wallet-status'; }
    const disconnectBtn = document.getElementById('walletDisconnect');
    if (disconnectBtn) disconnectBtn.style.display = 'none';
    showWalletExpanded();
    const settingsScreen = document.getElementById('settingsScreen');
    if (settingsScreen) settingsScreen.style.display = 'none';
    const hlBalanceHeader = document.getElementById('hlBalanceHeader');
    if (hlBalanceHeader) hlBalanceHeader.textContent = '$0.00';
}

// ── Initialization ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async function() {
    console.log('Hyperstack extension loaded');
    initExplainers();
    // initEventsPagination();  // Order Events section commented out

    const addressInput = document.getElementById('walletAddress');
    const saveBtn = document.getElementById('walletSave');
    const walletStatus = document.getElementById('walletStatus');
    const walletCollapsed = document.getElementById('walletCollapsed');

    state.storedAddress = await loadAddress();
    if (state.storedAddress) {
        if (addressInput) addressInput.value = state.storedAddress;
        showWalletCollapsed(state.storedAddress);
    }

    if (walletCollapsed) {
        walletCollapsed.addEventListener('click', showWalletExpanded);
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const val = (addressInput?.value || '').trim().toLowerCase();
            if (!/^0x[a-f0-9]{40}$/.test(val)) {
                if (walletStatus) {
                    walletStatus.textContent = 'Invalid address';
                    walletStatus.className = 'wallet-status wallet-status--err';
                }
                return;
            }
            await saveAddress(val);
            state.storedAddress = val;
            showWalletCollapsed(val);
            refreshBalance();
            refreshValidatorData();
            refreshTraderLimits();
            refreshTradePairs();
        });
    }

    const unregisteredChangeBtn = document.getElementById('unregisteredChangeAddr');
    if (unregisteredChangeBtn) {
        unregisteredChangeBtn.addEventListener('click', () => {
            hideUnregistered();
            showWalletExpanded();
        });
    }

    const eliminatedChangeBtn = document.getElementById('eliminatedChangeAddr');
    if (eliminatedChangeBtn) {
        eliminatedChangeBtn.addEventListener('click', () => {
            hideEliminated();
            showWalletExpanded();
        });
    }

    const walletDisconnectBtn = document.getElementById('walletDisconnect');
    if (walletDisconnectBtn) {
        walletDisconnectBtn.addEventListener('click', disconnectWallet);
    }
    const settingsDisconnectBtn = document.getElementById('settingsDisconnect');
    if (settingsDisconnectBtn) {
        settingsDisconnectBtn.addEventListener('click', disconnectWallet);
    }

    const settingsHlSaveBtn = document.getElementById('settingsHlSave');
    const settingsHlInput = document.getElementById('settingsHlAddress');
    if (settingsHlInput && state.storedAddress) settingsHlInput.value = state.storedAddress;
    if (settingsHlSaveBtn) {
        settingsHlSaveBtn.addEventListener('click', async () => {
            const val = (settingsHlInput?.value || '').trim().toLowerCase();
            if (!/^0x[a-f0-9]{40}$/.test(val)) {
                settingsHlSaveBtn.textContent = 'Invalid';
                setTimeout(() => { settingsHlSaveBtn.textContent = 'Save'; }, 1500);
                return;
            }
            await saveAddress(val);
            state.storedAddress = val;
            showWalletCollapsed(val);
            refreshBalance();
            refreshValidatorData();
            refreshTraderLimits();
            refreshTradePairs();
            settingsHlSaveBtn.textContent = 'Saved';
            setTimeout(() => { settingsHlSaveBtn.textContent = 'Save'; }, 1500);
        });
    }

    const testRegBtn = document.getElementById('testRegFlowBtn');
    if (testRegBtn) {
        testRegBtn.addEventListener('click', async () => {
            chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                if (tabs[0]) {
                    chrome.tabs.sendMessage(tabs[0].id, { action: "forceRegistrationFlow" });
                } else {
                    console.error('No active tab found');
                }
            });
        });
    }

    const analyticsLink = document.querySelector('.analytics-link');
    if (analyticsLink) {
        analyticsLink.addEventListener('click', function(e) {
            e.preventDefault();
            chrome.tabs.create({ url: 'https://hyperstack.trade/dashboard' });
        });
    }

    // Pin to side panel
    const pinSideBtn = document.getElementById('pinSideBtn');
    if (pinSideBtn && chrome.sidePanel) {
        pinSideBtn.addEventListener('click', async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab) {
                    await chrome.sidePanel.open({ tabId: tab.id });
                    window.close();
                }
            } catch (e) {
                console.error('[Hyperstack] Side panel open failed:', e);
            }
        });
    } else if (pinSideBtn) {
        pinSideBtn.style.display = 'none';
    }

    // Restore cached data instantly, then refresh live
    console.log('[Hyperstack Popup] Starting data refresh, storedAddress:', state.storedAddress);
    state.dashboardShown = false;
    await restoreFromCache();
    refreshBalance();
    refreshValidatorData();
    refreshTraderLimits();
    refreshTradePairs();
    // refreshEvents(state.storedAddress);  // Order Events section commented out
    state.refreshIntervalId = setInterval(updateData, 10000);
});

// Clean up interval when popup closes
window.addEventListener('unload', () => {
    if (state.refreshIntervalId) {
        clearInterval(state.refreshIntervalId);
        state.refreshIntervalId = null;
    }
});

// Notification click handler
setupNotificationClickHandler();
