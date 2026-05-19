import { fetchEvents } from './api.js';
import { setCachedResponse } from './cache.js';

export async function pollEventsForStoredAddress() {
  try {
    const stored = await chrome.storage.local.get(['hlAddress', 'lastEventTimestampMs']);
    const hlAddress = stored.hlAddress;
    if (!hlAddress) return;

    const since = stored.lastEventTimestampMs || 0;
    const data = await fetchEvents(hlAddress, since);
    const events = data.events || [];

    if (events.length === 0) return;

    let maxTs = since;
    for (const evt of events) {
      if (evt.timestamp_ms > maxTs) maxTs = evt.timestamp_ms;
    }

    const newEvents = events.filter(e => e.timestamp_ms > since);
    for (const evt of newEvents) {
      showEventNotification(evt);
    }

    await chrome.storage.local.set({ lastEventTimestampMs: maxTs });

    const existingData = await chrome.storage.local.get(['recentEvents']);
    let allEvents = existingData.recentEvents || [];
    allEvents = newEvents.concat(allEvents).slice(0, 50);
    await chrome.storage.local.set({ recentEvents: allEvents });
  } catch (e) {
    console.error('[Hyperstack BG] Event poll failed:', e.message);
  }
}

export function showEventNotification(evt) {
  const status = evt.status === 'accepted' ? 'Accepted' : 'Rejected';
  const pair = evt.trade_pair || 'Unknown';
  const direction = evt.order_type || '';

  const title = `Order ${status}: ${pair} ${direction}`;
  let message = `Status: ${status}`;
  if (evt.error_message) {
    message += `\nError: ${evt.error_message}`;
  }
  if (evt.fill_hash) {
    message += `\nFill: ${evt.fill_hash.slice(0, 10)}...`;
  }

  chrome.notifications.create(`hyperfunded-event-${evt.timestamp_ms}`, {
    type: 'basic',
    iconUrl: 'icon128.png',
    title,
    message,
    priority: evt.status === 'rejected' ? 2 : 1,
    requireInteraction: evt.status === 'rejected'
  }, (id) => {
    if (chrome.runtime.lastError) {
      console.error('Event notification error:', chrome.runtime.lastError);
    }
  });
}
