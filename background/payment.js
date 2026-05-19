import { HL_APP_URL } from './config.js';

const TRUSTED_API_ORIGINS = [
  'https://hyperfunded.co',
  'https://www.hyperfunded.co',
  'http://localhost:4568',
  'http://localhost:3000',
  "https://testnet.hyperfunded.co",
  "https://www.testnet.hyperfunded.co",
  "https://staging.hyperfunded.co",
  "https://www.staging.hyperfunded.co",
];

async function notifySourceTab(tabId, status, data) {
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, {
      action: 'hlPaymentUpdate',
      status,
      data: data || {},
    });
  } catch {
    // Tab may be closed — result is persisted in storage for recovery
  }
}

export async function attemptBackgroundVerification() {
  const stored = await chrome.storage.local.get([
    'pendingHLPayment', 'hlPaymentSourceTabId',
  ]);
  const payment = stored.pendingHLPayment;

  if (!payment || !payment.apiOrigin || !payment.verifyStartedAt) {
    chrome.alarms.clear('hl-verify-poll');
    return;
  }

  if (!TRUSTED_API_ORIGINS.includes(payment.apiOrigin)) {
    console.error('[HyperFunded BG] Untrusted API origin:', payment.apiOrigin);
    await chrome.storage.local.remove(['pendingHLPayment']);
    chrome.alarms.clear('hl-verify-poll');
    return;
  }

  if (Date.now() - payment.verifyStartedAt > 300_000) {
    console.warn('[HyperFunded BG] Background verification timed out');
    await chrome.storage.local.set({
      hlPaymentResult: {
        success: false,
        error: 'Verification timed out. If you completed the transfer, contact support.',
        completedAt: Date.now(),
      },
    });
    await chrome.storage.local.remove(['pendingHLPayment', 'hlPaymentSourceTabId']);
    chrome.alarms.clear('hl-verify-poll');
    notifySourceTab(stored.hlPaymentSourceTabId, 'registration_error', {
      error: 'Verification timed out',
    });
    return;
  }

  const qs = new URLSearchParams({
    destination: payment.destination,
    amount: String(payment.amount),
    _ts: String(Date.now()),
  });
  if (payment.senderAddress) {
    qs.set('sender', payment.senderAddress);
  }

  let data;
  try {
    const res = await fetch(`${payment.apiOrigin}/api/verify-hl-payment?${qs}`);
    if (!res.ok) return;
    data = await res.json();
  } catch (e) {
    console.warn('[HyperFunded BG] Verify poll error:', e.message);
    return;
  }

  if (!data?.verified) return;

  let regResult;
  let regOk = false;
  try {
    const regRes = await fetch(`${payment.apiOrigin}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        minerSlug: payment.minerSlug,
        hlAddress: payment.hlAddress,
        accountSize: payment.accountSize,
        payoutAddress: payment.payoutAddress,
        email: payment.email,
        tierIndex: payment.tierIndex,
        paymentMethod: 'hyperliquid',
        hlTransferHash: data.txHash,
        hlTransferSender: payment.senderAddress,
      }),
    });
    regOk = regRes.ok || regRes.status === 409;
    regResult = await regRes.json().catch(() => null);
  } catch (e) {
    console.error('[HyperFunded BG] Register error:', e.message);
    return;
  }

  await chrome.storage.local.set({
    hlPaymentResult: {
      success: regOk,
      txHash: data.txHash,
      hlAddress: payment.hlAddress,
      registrationStatus: regResult?.status || (regOk ? 'registered' : 'error'),
      tierName: payment.tierName || '',
      accountSize: payment.accountSize || 0,
      error: regOk ? null : (regResult?.error || 'Registration failed'),
      completedAt: Date.now(),
    },
  });

  await chrome.storage.local.remove(['pendingHLPayment', 'hlPaymentSourceTabId']);
  chrome.alarms.clear('hl-verify-poll');

  notifySourceTab(stored.hlPaymentSourceTabId, regOk ? 'registered' : 'registration_error', {
    txHash: data.txHash,
    hlAddress: payment.hlAddress,
    registrationStatus: regResult?.status || 'registered',
  });

  console.info('[HyperFunded BG] Background registration complete', {
    txHash: data.txHash,
    status: regResult?.status,
  });
}

/**
 * Handles payment-related messages. Returns true if it handled the message
 * (caller should return true for async response), false if unrecognized.
 */
export function handlePaymentMessage(request, sender, sendResponse) {
  if (request.action === 'initiateHLPayment') {
    (async () => {
      try {
        const data = request.data;
        const tabUrl = sender.tab?.url || '';
        const apiOrigin = tabUrl ? new URL(tabUrl).origin : '';

        await chrome.storage.local.set({
          pendingHLPayment: {
            destination: data.destination,
            amount: data.amount,
            tierName: data.tierName,
            hlAddress: data.hlAddress,
            payoutAddress: data.payoutAddress,
            email: data.email,
            minerSlug: data.minerSlug || '',
            accountSize: data.accountSize || 0,
            tierIndex: data.tierIndex ?? 0,
            apiOrigin,
            initiatedAt: Date.now(),
          },
          hlPaymentSourceTabId: sender.tab?.id || null,
        });

        const hlTabs = await chrome.tabs.query({ url: [HL_APP_URL + '/*'] });
        let hlTab;
        if (hlTabs.length > 0) {
          hlTab = hlTabs[0];
          await chrome.tabs.update(hlTab.id, { active: true, url: HL_APP_URL + '/portfolio' });
        } else {
          hlTab = await chrome.tabs.create({ url: HL_APP_URL + '/portfolio' });
        }

        const tabReadyPromise = new Promise((resolve) => {
          function onUpdated(tabId, changeInfo) {
            if (tabId === hlTab.id && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(onUpdated);
              resolve();
            }
          }
          chrome.tabs.onUpdated.addListener(onUpdated);
          setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(onUpdated);
            resolve();
          }, 15000);
        });

        await tabReadyPromise;
        await new Promise(r => setTimeout(r, 1000));

        try {
          await chrome.tabs.sendMessage(hlTab.id, { action: 'startRegistrationPayment' });
        } catch (e) {
          console.warn('[HyperFunded BG] Failed to message HL tab, retrying...', e.message);
          await new Promise(r => setTimeout(r, 2000));
          await chrome.tabs.sendMessage(hlTab.id, { action: 'startRegistrationPayment' });
        }

        const sourceTabId = sender.tab?.id;
        if (sourceTabId) {
          try {
            await chrome.tabs.sendMessage(sourceTabId, {
              action: 'hlPaymentUpdate',
              status: 'navigating',
            });
          } catch (e) {
            console.warn('[HyperFunded BG] Could not notify source tab:', e.message);
          }
        }

        sendResponse({ success: true });
      } catch (err) {
        console.error('[HyperFunded BG] initiateHLPayment error:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.action === 'hlPaymentFormFilled') {
    (async () => {
      try {
        const stored = await chrome.storage.local.get(['hlPaymentSourceTabId']);
        const sourceTabId = stored.hlPaymentSourceTabId;
        if (sourceTabId) {
          await chrome.tabs.sendMessage(sourceTabId, {
            action: 'hlPaymentUpdate',
            status: 'awaiting_confirmation',
          });
        }
        sendResponse({ success: true });
      } catch (err) {
        console.error('[HyperFunded BG] hlPaymentFormFilled relay error:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.action === 'hlPaymentWalletDetected') {
    (async () => {
      try {
        const stored = await chrome.storage.local.get(['hlPaymentSourceTabId', 'pendingHLPayment']);
        const sourceTabId = stored.hlPaymentSourceTabId;

        if (stored.pendingHLPayment && request.senderAddress) {
          await chrome.storage.local.set({
            pendingHLPayment: {
              ...stored.pendingHLPayment,
              senderAddress: request.senderAddress,
            },
          });
        }

        if (sourceTabId) {
          try {
            await chrome.tabs.sendMessage(sourceTabId, {
              action: 'hlPaymentUpdate',
              status: 'wallet_detected',
              data: {
                senderAddress: request.senderAddress || null,
              },
            });
          } catch (e) {
            console.warn('[HyperFunded BG] Could not notify source tab:', e.message);
          }
        }
        sendResponse({ success: true });
      } catch (err) {
        console.error('[HyperFunded BG] hlPaymentWalletDetected relay error:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.action === 'hlPaymentSent') {
    (async () => {
      try {
        const stored = await chrome.storage.local.get(['hlPaymentSourceTabId', 'pendingHLPayment']);
        const sourceTabId = stored.hlPaymentSourceTabId;
        const senderAddress = request.senderAddress || null;

        if (stored.pendingHLPayment) {
          await chrome.storage.local.set({
            pendingHLPayment: {
              ...stored.pendingHLPayment,
              senderAddress: senderAddress || stored.pendingHLPayment.senderAddress,
              verifyStartedAt: Date.now(),
            },
          });
        }

        if (sourceTabId) {
          try {
            await chrome.tabs.sendMessage(sourceTabId, {
              action: 'hlPaymentUpdate',
              status: 'sent',
              data: { senderAddress },
            });
          } catch (e) {
            console.warn('[HyperFunded BG] Could not notify source tab:', e.message);
          }
        }

        attemptBackgroundVerification();
        chrome.alarms.create('hl-verify-poll', { periodInMinutes: 0.5 });

        sendResponse({ success: true });
      } catch (err) {
        console.error('[HyperFunded BG] hlPaymentSent error:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  return false;
}
