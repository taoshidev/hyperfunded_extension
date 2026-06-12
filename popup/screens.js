import { fmtUsd } from './format.js';

export function setPlaceholders() {
    const ids = ['fundedBalance', 'fundedChange', 'challengeValue', 'challengeLabel',
                 'dailyDrawdownValue', 'trailingDrawdownValue', 'drawdownLabel',
                 'hsBasisRatio', 'hsBasisValue', 'hsBasisHlEquity',
                 'hsCapacityUsed', 'hsCapacityMax'];
    for (const id of ids) {
        const el = document.getElementById(id);
        if (el) el.textContent = '--';
    }
    const container = document.getElementById('positionsContainer');
    if (container) container.innerHTML = '<div class="no-more-positions">Data unavailable</div>';
}

export function showDashboard() {
    hideUnregistered();
    hideEliminated();
    const el = document.getElementById('dashboardContent');
    if (el) el.style.display = '';
    const badge = document.querySelector('.status-badge');
    if (badge) badge.style.display = '';
}

export function hideDashboard() {
    const el = document.getElementById('dashboardContent');
    if (el) el.style.display = 'none';
    const badge = document.querySelector('.status-badge');
    if (badge) badge.style.display = 'none';
    setPlaceholders();
}

export function showUnregistered() {
    hideUnregistered();
    hideEliminated();
    const el = document.getElementById('unregisteredScreen');
    if (el) el.style.display = '';
    const walletConfig = document.getElementById('walletConfig');
    if (walletConfig) walletConfig.style.display = 'none';
}

export function hideUnregistered() {
    const el = document.getElementById('unregisteredScreen');
    if (el) el.style.display = 'none';
}

export function showEliminated() {
    hideEliminated();
    const el = document.getElementById('eliminatedScreen');
    if (el) el.style.display = '';
    const walletConfig = document.getElementById('walletConfig');
    if (walletConfig) walletConfig.style.display = 'none';
}

export function hideEliminated() {
    const el = document.getElementById('eliminatedScreen');
    if (el) el.style.display = 'none';
}
