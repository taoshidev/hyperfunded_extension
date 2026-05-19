// Registration payment flow — fills HL Send modal and watches for completion
(() => {
  const HF = window.__HF;

  let registrationInterval = null;

  function ReactSetString(input, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillSendModal(destination, amount) {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (attempts > 40) {
        clearInterval(interval);
        return;
      }

      const inputs = Array.from(document.querySelectorAll("input"));
      let destInput = null;
      let amountInput = null;

      for (const input of inputs) {
        if (input.offsetParent === null) continue;
        const placeholder = (input.placeholder || "").toLowerCase();
        if (placeholder.includes("address") || placeholder.includes("destination")) {
          destInput = input;
        } else if (placeholder.includes("amount") || placeholder.includes("0.00") || placeholder.includes("size")) {
          amountInput = input;
        }
      }

      if (destInput && amountInput) {
        clearInterval(interval);
        ReactSetString(destInput, destination);
        ReactSetString(amountInput, amount);

        chrome.runtime.sendMessage({ action: "hlPaymentFormFilled" });

        let container = document.getElementById("hf-toast-container");
        if (!container) {
          container = document.createElement("div");
          container.id = "hf-toast-container";
          container.className = "hf-toast-container";
          (document.body || document.documentElement).appendChild(container);
        }

        const toast = document.createElement("div");
        toast.className = "hf-toast hf-toast--info hf-toast-show";
        toast.innerHTML =
          '<div class="hf-toast-icon"><img src="' + chrome.runtime.getURL("icon48.png") + '" style="height: 16px; width: 16px; margin-top: 2px; opacity: 0.9;" alt="HyperFunded" /></div>' +
          '<div class="hf-toast-content">' +
            '<div class="hf-toast-title">Registration Payment</div>' +
            '<div class="hf-toast-msg">Review the transfer details and confirm to complete your payment.</div>' +
          '</div>';

        container.appendChild(toast);
        setTimeout(() => toast.remove(), 8000);

        watchForSendCompletion(destInput);
      }
    }, 500);
  }

  function watchForSendCompletion(destInput) {
    let watchAttempts = 0;
    const watchInterval = setInterval(() => {
      watchAttempts++;
      if (watchAttempts > 120) {
        clearInterval(watchInterval);
        return;
      }

      if (!document.body.contains(destInput) || destInput.offsetParent === null) {
        clearInterval(watchInterval);
        console.log("[HyperFunded] Send modal closed — payment likely submitted");
        HF.api.getUserAddress()
          .then((senderAddress) => {
            chrome.runtime.sendMessage({
              action: "hlPaymentSent",
              senderAddress: senderAddress || null,
            });
          })
          .catch(() => {
            chrome.runtime.sendMessage({ action: "hlPaymentSent" });
          });
      }
    }, 500);
  }

  async function processRegistrationPayment() {
    const stored = await new Promise(resolve =>
      chrome.storage.local.get(["pendingHLPayment"], resolve)
    );
    const payment = stored.pendingHLPayment;
    const legacyPending = sessionStorage.getItem("hf_pending_registration") === "true";

    if (!payment && !legacyPending) return;

    const destination = payment?.destination || "0x0000000000000000000000000000000000000000";
    const amount = payment?.amount || "100";

    if (registrationInterval) clearInterval(registrationInterval);

    let attempts = 0;
    registrationInterval = setInterval(() => {
      attempts++;
      if (attempts > 60) {
        clearInterval(registrationInterval);
        sessionStorage.removeItem("hf_pending_registration");
        return;
      }

      if (!location.pathname.startsWith("/portfolio")) {
        const navLink = document.querySelector('a[href="/portfolio"]');
        if (navLink) {
          navLink.click();
        } else {
          history.pushState(null, "", "/portfolio");
          window.dispatchEvent(new Event("popstate"));
          if (attempts > 4) window.location.href = "/portfolio";
        }
        return;
      }

      const buttons = Array.from(document.querySelectorAll("button"));
      const sendBtn = buttons.find(b =>
        b.textContent.trim().toLowerCase() === "send" && b.offsetParent !== null
      );

      if (sendBtn) {
        clearInterval(registrationInterval);
        sessionStorage.removeItem("hf_pending_registration");

        const connectedAddr = HF.api.detectAddressFromPage();
        if (connectedAddr) {
          chrome.runtime.sendMessage({
            action: "hlPaymentWalletDetected",
            senderAddress: connectedAddr,
          });
        }

        sendBtn.click();
        setTimeout(() => fillSendModal(destination, amount), 500);
      }
    }, 500);
  }

  HF.payment = {
    processRegistrationPayment,
  };
})();
