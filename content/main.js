// Content script entry point — inject/teardown lifecycle + message listener
(() => {
  const HF = window.__HF;

  function inject() {
    if (document.getElementById(HF.state.BANNER_ID)) return;

    const banner = document.createElement("div");
    banner.id = HF.state.BANNER_ID;
    banner.innerHTML = HF.banner.getBannerHTML();

    HF.banner.applyBannerStateClasses(banner);

    (document.body || document.documentElement).prepend(banner);
    HF.banner.ensureLayoutFix();

    banner.querySelector("#hf-dashboard-link")?.addEventListener("click", (e) => {
      e.preventDefault();
      window.open("https://vanta.network/dashboard", "_blank");
    });

    HF.banner.wireDdPanel(banner);

    HF.inputBinding.startBindingLoop();
    HF.inputBinding.scheduleUpdate();
    HF.api.startBalanceChecking();
  }

  function teardown() {
    HF.state.shouldBlockTrade = false;
    HF.tradeGate.enforceTradeBlock();
    HF.tradeGate.stopTradeBlockObserver();
    HF.tradeGate.uninstallTradeGuards();
    HF.inputBinding.stopBindingLoop();
    HF.api.stopBalanceChecking();
    document.getElementById(HF.state.BANNER_ID)?.remove();
    HF.pairSupport.removeUnsupportedOverlay();
    HF.banner.removeLayoutFix();
  }

  // Expose lifecycle for navigation module
  HF.lifecycle = { inject, teardown };

  // Listen for messages from popup and background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "forceRegistrationFlow") {
      console.log("[Hyperstack] Forcing registration flow...");
      sessionStorage.setItem("hf_pending_registration", "true");
      HF.payment.processRegistrationPayment();
      sendResponse({ success: true });
    }

    if (request.action === "startRegistrationPayment") {
      console.log("[Hyperstack] Starting registration payment from website...");
      HF.payment.processRegistrationPayment();
      sendResponse({ success: true });
    }
  });
})();
