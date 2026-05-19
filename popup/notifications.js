import { getHlAppUrl } from './api.js';

function updateStatus(message, type = 'info') {
    const statusDiv = document.getElementById('notificationStatus');
    if (statusDiv) {
        statusDiv.textContent = message;
        statusDiv.className = `notification-status ${type}`;
    }
}

export async function checkNotificationPermission() {
    console.log('Checking notification permission...');

    if (!('Notification' in window)) {
        updateStatus('Notifications not supported', 'error');
        console.error('Notification API not available');
        return false;
    }

    console.log('Current permission:', Notification.permission);

    if (Notification.permission === 'granted') {
        updateStatus('Notifications enabled', 'success');
        return true;
    } else if (Notification.permission === 'denied') {
        updateStatus('Notifications blocked! Check Chrome settings', 'error');
        console.error('Notification permission denied');
        return false;
    } else {
        updateStatus('Requesting notification permission...', 'info');
        try {
            const permission = await Notification.requestPermission();
            console.log('Permission request result:', permission);

            if (permission === 'granted') {
                updateStatus('Permission granted', 'success');
                return true;
            } else {
                updateStatus('Permission denied', 'error');
                return false;
            }
        } catch (error) {
            console.error('Error requesting permission:', error);
            updateStatus('Error requesting permission', 'error');
            return false;
        }
    }
}

function tryWebNotification(position) {
    console.log('Trying Web Notification API as fallback');
    updateStatus('Using Web Notifications...', 'info');

    try {
        const notification = new Notification(`${position.symbol} ${position.type} Position`, {
            body: `PnL: ${position.pnl} (${position.pnlPercent})\nSize: ${position.size} at ${position.leverage}\nEntry: ${position.entry} → Mark: ${position.mark}`,
            icon: 'icon128.png',
            requireInteraction: false
        });

        console.log('Web notification created:', notification);
        updateStatus('Notification sent! (Web API)', 'success');

        notification.onclick = () => {
            chrome.tabs.create({ url: getHlAppUrl() });
        };

        setTimeout(() => { notification.close(); }, 8000);
        setTimeout(() => { updateStatus('', 'info'); }, 3000);
    } catch (error) {
        console.error('Web Notification error:', error);
        updateStatus('Web Notification error: ' + error.message, 'error');
    }
}

export async function showPositionNotification() {
    console.log('showPositionNotification called');

    const hasPermission = await checkNotificationPermission();
    if (!hasPermission) {
        console.error('No notification permission');
        return;
    }

    updateStatus('Creating notification...', 'info');

    const position = {
        symbol: 'BTC-PERP',
        type: 'LONG',
        size: '0.15 BTC',
        entry: '$98,450.00',
        mark: '$100,013.33',
        pnl: '+$234.50',
        leverage: '5x',
        pnlPercent: '+1.59%'
    };

    const notificationOptions = {
        type: 'basic',
        iconUrl: 'icon128.png',
        title: `${position.symbol} ${position.type} Position`,
        message: `PnL: ${position.pnl} (${position.pnlPercent})\nSize: ${position.size} at ${position.leverage}\nEntry: ${position.entry} → Mark: ${position.mark}`,
        priority: 2,
        requireInteraction: false
    };

    console.log('Creating notification with chrome.notifications API:', notificationOptions);

    if (chrome.notifications) {
        chrome.notifications.create('hyperfunded-position-' + Date.now(), notificationOptions, (notificationId) => {
            if (chrome.runtime.lastError) {
                console.error('Chrome notifications error:', chrome.runtime.lastError);
                updateStatus('Chrome API error: ' + chrome.runtime.lastError.message, 'error');
                tryWebNotification(position);
                return;
            }

            console.log('Chrome notification created:', notificationId);
            updateStatus('Notification sent!', 'success');

            setTimeout(() => { updateStatus('', 'info'); }, 3000);
            setTimeout(() => {
                chrome.notifications.clear(notificationId, (wasCleared) => {
                    console.log('Notification cleared:', wasCleared);
                });
            }, 8000);
        });
    } else {
        tryWebNotification(position);
    }
}

export function setupNotificationClickHandler() {
    if (chrome.notifications) {
        chrome.notifications.onClicked.addListener((notificationId) => {
            if (notificationId.startsWith('hyperfunded-position')) {
                chrome.tabs.create({ url: getHlAppUrl() });
            }
        });
    }
}
