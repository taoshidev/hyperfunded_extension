// ─────────────────────────────────────────────────────────────────────────────
// HyperFunded – Content script for hyperfunded.co
// Bridges communication between the registration page and the extension.
// ─────────────────────────────────────────────────────────────────────────────

(() => {
  const VERSION = "1.0.0";

  // Inject marker element so the page can detect the extension
  const marker = document.createElement("div");
  marker.id = "hyperfunded-ext";
  marker.dataset.version = VERSION;
  marker.style.display = "none";
  (document.documentElement || document.body).appendChild(marker);

  // ── Recover completed registration from background verification ──────────
  // Fires after a short delay to ensure React has mounted its listeners
  setTimeout(() => {
    chrome.storage.local.get(["hlPaymentResult"], (stored) => {
      const result = stored.hlPaymentResult;
      if (!result || !result.completedAt) return;
      // Only honour results from the last 30 minutes
      if (Date.now() - result.completedAt > 30 * 60 * 1000) {
        chrome.storage.local.remove(["hlPaymentResult"]);
        return;
      }
      // Write to page localStorage so registration-flow can recover on reload
      try {
        window.localStorage.setItem(
          "hf_registration_result",
          JSON.stringify(result)
        );
      } catch {}
      // Dispatch event for live React listeners
      document.dispatchEvent(
        new CustomEvent("HYPERFUNDED_PAYMENT_STATUS", {
          detail: {
            status: result.success ? "registered" : "registration_error",
            txHash: result.txHash || "",
            hlAddress: result.hlAddress || "",
            registrationStatus: result.registrationStatus || "",
            tierName: result.tierName || "",
            accountSize: result.accountSize || 0,
            error: result.error || null,
          },
        })
      );
      chrome.storage.local.remove(["hlPaymentResult"]);
    });
  }, 1500);

  // ── Page → Extension (via window.postMessage) ─────────────────────────────

  window.addEventListener("message", (event) => {
    // Only accept messages from the same window (the page itself)
    if (event.source !== window) return;
    if (!event.data || typeof event.data.type !== "string") return;

    if (event.data.type === "HYPERFUNDED_PING") {
      document.dispatchEvent(
        new CustomEvent("HYPERFUNDED_PONG", {
          detail: { version: VERSION },
        })
      );
      return;
    }

    if (event.data.type === "HYPERFUNDED_INIT_PAYMENT") {
      const data = event.data.data;
      if (!data) return;

      chrome.runtime.sendMessage(
        { action: "initiateHLPayment", data },
        (response) => {
          if (chrome.runtime.lastError) {
            document.dispatchEvent(
              new CustomEvent("HYPERFUNDED_PAYMENT_STATUS", {
                detail: {
                  status: "error",
                  error: chrome.runtime.lastError.message,
                },
              })
            );
            return;
          }
          if (!response?.success) {
            document.dispatchEvent(
              new CustomEvent("HYPERFUNDED_PAYMENT_STATUS", {
                detail: {
                  status: "error",
                  error: response?.error || "Failed to initiate payment",
                },
              })
            );
          }
        }
      );
      return;
    }
  });

  // ── Extension → Page (via chrome.runtime.onMessage) ───────────────────────

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "hlPaymentUpdate") {
      document.dispatchEvent(
        new CustomEvent("HYPERFUNDED_PAYMENT_STATUS", {
          detail: {
            status: request.status,
            ...(request.data || {}),
          },
        })
      );
      sendResponse({ success: true });
    }
  });
})();
