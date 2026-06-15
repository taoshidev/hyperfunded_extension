// Shared mutable state for all content script modules
(() => {
  const HF = window.__HF;

  // const IS_TESTNET = location.hostname === "app.hyperliquid-testnet.xyz";
  const IS_TESTNET = true;
  const HL_APP_ORIGIN = IS_TESTNET
    ? "https://app.hyperliquid-testnet.xyz"
    : "https://app.hyperliquid.xyz";

  const ACCOUNT = {
    hlBalance: 0,
    hlEquity: 0,
    fundedSize: 0,
    accountBalance: null,
    dailyOpenRatio: null,
    eodHwmRatio: null,
    challengeTarget: 10,
    challengeCurrent: 0,
    drawdownCurrent: 0,
    daily_loss_pct: 0,
    eod_trailing_loss_pct: 0,
    intraday_usage_pct: 0,
    eod_usage_pct: 0,
    intraday_threshold_pct: null,  // from validator; null → display "--", never a fallback
    eod_threshold_pct: null,
    validatorEquity: 0,
    openSingleUsed: 0,
    openTotalUsed: 0,
    exposureSource: "none",
    maxPositionPerPair: 0,
    maxPortfolio: 0,
    tier: null,             // leverage tier 1-4 from /limits; null if unavailable
    maxByAssetClass: {},    // per-class caps in HS USD, scaled to live balance
    notionalByPair: {},
    filledNotionalByPair: {},
    pendingNotionalByPair: {},
    filledTotal: 0,
    pendingTotal: 0,
    signedNotionalByPair: {},
    // Aggregate unrealized PnL across all HL open positions (sum of HL's
    // per-position unrealizedPnl). null until HL clearinghouse has loaded —
    // downstream displays "--" rather than fabricating a value from the
    // validator's `net_leverage × account_size`.
    totalUnrealizedPnl: null,
    // HS-side actual position values, derived strictly as size × price:
    //   size  = sum of signed `q` (quantity) across the position's filled orders
    //   price = current HL mid price for the coin
    // Map: { COIN_UPPER: { quantity, value, side } }
    //   quantity: signed coin units
    //   value:    abs(quantity × price), USD
    //   side:     'long' | 'short'
    // Populated by fetchValidatorData when both validator positions and
    // midPrices are available. Empty until then.
    hsPositionsByCoin: {},
    inChallenge: false,
    isRegistered: false,
    registrationChecked: false,
  };

  HF.state = {
    IS_TESTNET,
    HL_APP_ORIGIN,
    ACCOUNT,
    midPrices: {},
    SUPPORTED_SYMBOLS: ["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA"],
    hlCoinToDisplay: {},
    pairCategory: {},       // display symbol (e.g. "GOLD") → asset class, from /trade-pairs
    pairTierLeverage: {},   // display symbol → { tier: leverage multiplier }
    validatorDataLoaded: false,
    limitsLoaded: false,
    pairsLoaded: false,
    currentBalance: null,
    balanceVerified: false,
    balanceCheckTimer: null,
    shouldBlockTrade: false,
    forcedTradeBlock: false,
    forcedTradeBlockReason: null,
    lastEditedInput: null,
    pendingNotional: 0,
    BANNER_ID: "hf-banner",
    LAYOUT_STYLE_ID: "hf-layout-fix",
    BANNER_HEIGHT: 38,
    UNSUPPORTED_OVERLAY_ID: "hf-unsupported-overlay",
    BALANCE_CHECK_INTERVAL: 3000,
  };
})();
