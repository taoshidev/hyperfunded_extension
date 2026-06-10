import { formatEventTime } from './format.js';
import { safeSendMessage } from './api.js';

const EVENTS_PER_PAGE = 8;

let paginatedEvents = [];
let eventsPageIndex = 0;
let paginationListenersBound = false;

function buildEventCardHtml(evt) {
    const isAccepted = evt.status === 'accepted';
    const statusClass = isAccepted ? 'event-accepted' : 'event-rejected';
    const statusLabel = isAccepted ? 'Accepted' : 'Rejected';
    const pair = evt.trade_pair || 'Unknown';
    const direction = evt.order_type || '';
    const badgeClass = direction === 'LONG' ? 'long' : direction === 'SHORT' ? 'short' : '';
    const time = formatEventTime(evt.timestamp_ms);

    let details = '';
    if (evt.error_message) {
        details = `<div class="event-error">${evt.error_message}</div>`;
    }
    if (evt.fill_hash) {
        details += `<div class="event-fill">Fill: ${evt.fill_hash.slice(0, 14)}...</div>`;
    }

    return `
            <div class="event-card ${statusClass}">
                <div class="event-header">
                    <div class="event-pair">
                        <span class="event-pair-name">${pair}</span>
                        ${direction ? `<span class="position-badge ${badgeClass}">${direction}</span>` : ''}
                    </div>
                    <span class="event-status-badge ${statusClass}">${statusLabel}</span>
                </div>
                ${details}
                <div class="event-time">${time}</div>
            </div>
        `;
}

function hideEventsPagination() {
    const pagEl = document.getElementById('eventsPagination');
    if (pagEl) pagEl.hidden = true;
}

function paintEventsPage() {
    const container = document.getElementById('eventsContainer');
    const countEl = document.getElementById('eventsCount');
    const pagEl = document.getElementById('eventsPagination');
    const labelEl = document.getElementById('eventsPageLabel');
    const prev = document.getElementById('eventsPagePrev');
    const next = document.getElementById('eventsPageNext');
    if (!container) return;

    if (!paginatedEvents.length) {
        return;
    }

    const total = paginatedEvents.length;
    const totalPages = Math.max(1, Math.ceil(total / EVENTS_PER_PAGE));
    if (eventsPageIndex >= totalPages) eventsPageIndex = totalPages - 1;
    if (eventsPageIndex < 0) eventsPageIndex = 0;

    const start = eventsPageIndex * EVENTS_PER_PAGE;
    const slice = paginatedEvents.slice(start, start + EVENTS_PER_PAGE);

    if (countEl) countEl.textContent = `${total} event${total !== 1 ? 's' : ''}`;

    container.innerHTML = slice.map(evt => buildEventCardHtml(evt)).join('');

    const showPag = total > EVENTS_PER_PAGE;
    if (pagEl) pagEl.hidden = !showPag;
    if (labelEl) {
        if (showPag) {
            const end = start + slice.length;
            labelEl.textContent = `${start + 1}–${end} of ${total}`;
        } else {
            labelEl.textContent = '';
        }
    }
    if (prev) prev.disabled = eventsPageIndex <= 0;
    if (next) next.disabled = eventsPageIndex >= totalPages - 1;
}

export function initEventsPagination() {
    if (paginationListenersBound) return;
    paginationListenersBound = true;
    const prev = document.getElementById('eventsPagePrev');
    const next = document.getElementById('eventsPageNext');
    prev?.addEventListener('click', () => {
        if (eventsPageIndex > 0) {
            eventsPageIndex -= 1;
            paintEventsPage();
        }
    });
    next?.addEventListener('click', () => {
        const totalPages = Math.max(1, Math.ceil(paginatedEvents.length / EVENTS_PER_PAGE));
        if (eventsPageIndex < totalPages - 1) {
            eventsPageIndex += 1;
            paintEventsPage();
        }
    });
}

export async function refreshEvents(storedAddress) {
    console.log('[Hyperstack Popup] refreshEvents called, storedAddress:', storedAddress);
    if (!storedAddress) {
        console.log('[Hyperstack Popup] No stored address, skipping events');
        const container = document.getElementById('eventsContainer');
        if (container) container.innerHTML = '<div class="no-more-positions">Set wallet address to see events</div>';
        const countEl = document.getElementById('eventsCount');
        if (countEl) countEl.textContent = '';
        paginatedEvents = [];
        eventsPageIndex = 0;
        hideEventsPagination();
        return;
    }
    try {
        console.log('[Hyperstack Popup] Sending fetchEvents message to background...');
        const result = await safeSendMessage({ action: 'fetchEvents', address: storedAddress, since: 0 });
        console.log('[Hyperstack Popup] fetchEvents result:', JSON.stringify(result).slice(0, 500));

        const events = result.events || [];
        console.log('[Hyperstack Popup] Rendering', events.length, 'events');
        renderEvents(events);

        if (events.length > 0) {
            let maxTs = 0;
            for (const e of events) {
                if (e.timestamp_ms > maxTs) maxTs = e.timestamp_ms;
            }
            chrome.storage.local.set({ lastEventTimestampMs: maxTs });
            chrome.storage.local.set({ recentEvents: events.slice(0, 50) });
        }
    } catch (e) {
        console.error('[Hyperstack Popup] Events fetch failed:', e.message, e);
        const cached = await new Promise(resolve => {
            chrome.storage.local.get(['recentEvents'], resolve);
        });
        console.log('[Hyperstack Popup] Cached events:', cached.recentEvents?.length ?? 0);
        if (cached.recentEvents && cached.recentEvents.length > 0) {
            renderEvents(cached.recentEvents);
        } else {
            const container = document.getElementById('eventsContainer');
            if (container) container.innerHTML = `<div class="no-more-positions">Unable to load events: ${e.message}</div>`;
            const countEl = document.getElementById('eventsCount');
            if (countEl) countEl.textContent = '';
            paginatedEvents = [];
            eventsPageIndex = 0;
            hideEventsPagination();
        }
    }
}

export function renderEvents(events) {
    const container = document.getElementById('eventsContainer');
    const countEl = document.getElementById('eventsCount');
    if (!container) return;

    if (!events || events.length === 0) {
        paginatedEvents = [];
        eventsPageIndex = 0;
        container.innerHTML = '<div class="no-more-positions">No events yet</div>';
        if (countEl) countEl.textContent = '';
        hideEventsPagination();
        return;
    }

    const filtered = events.filter(evt => !evt.error_message || !evt.error_message.toLowerCase().includes('rate limited'));
    if (filtered.length === 0) {
        paginatedEvents = [];
        eventsPageIndex = 0;
        container.innerHTML = '<div class="no-more-positions">No events yet</div>';
        if (countEl) countEl.textContent = '';
        hideEventsPagination();
        return;
    }
    paginatedEvents = filtered.sort((a, b) => b.timestamp_ms - a.timestamp_ms);
    eventsPageIndex = 0;
    paintEventsPage();
}
