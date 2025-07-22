/* ========================================================
   Configuration
   ======================================================== */
// Insert your free Alpha Vantage API key if you plan to export
// Forex or Stock data. Get one here: https://www.alphavantage.co/support/#api-key
const ALPHA_VANTAGE_API_KEY = "YOUR_ALPHA_VANTAGE_KEY_HERE"; // Replace or keep blank

/* ========================================================
   DOM Helpers
   ======================================================== */
const $ = (sel) => document.querySelector(sel);
const assetClassSelect = $("#assetClass");
const assetSearchInput = $("#assetSearch");
const assetListContainer = $("#assetList");
const selectedAssetDisplay = $("#selectedAssetDisplay");
const livePriceSpan = $("#livePrice");
const timeframeSelect = $("#timeframe");
const startDateInput = $("#startDate");
const endDateInput = $("#endDate");
const exportBtn = $("#exportBtn");
const statusP = $("#status");

/* ========================================================
   State
   ======================================================== */
let assets = []; // Populated based on asset class
let filteredAssets = [];
let selectedAsset = null; // { symbol, display }
let priceIntervalRef = null;

/* ========================================================
   Utility Functions
   ======================================================== */
function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

function timestampToISO(ts) {
  return new Date(ts).toISOString();
}

function jsonToCsv(rows) {
  const header = Object.keys(rows[0]).join(",");
  const lines = rows.map((row) => Object.values(row).join(","));
  return [header, ...lines].join("\n");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
}

function setStatus(msg, isError = false) {
  statusP.textContent = msg;
  statusP.style.color = isError ? "#b00020" : "#222";
}

/* ========================================================
   Asset List Loading
   ======================================================== */
async function loadCryptoAssets() {
  setStatus("Loading crypto assets…");
  try {
    const res = await fetch("https://api.binance.com/api/v3/exchangeInfo");
    const data = await res.json();
    const usdtPairs = data.symbols.filter((s) => s.quoteAsset === "USDT" && s.status === "TRADING");
    return usdtPairs.map((s) => ({ symbol: s.symbol, base: s.baseAsset, quote: s.quoteAsset }));
  } catch (err) {
    console.error(err);
    setStatus("Failed to fetch crypto assets", true);
    return [];
  }
}

function getStaticForexAssets() {
  // Major & minor pairs
  return [
    { symbol: "EURUSD", base: "EUR", quote: "USD" },
    { symbol: "GBPUSD", base: "GBP", quote: "USD" },
    { symbol: "USDJPY", base: "USD", quote: "JPY" },
    { symbol: "USDCHF", base: "USD", quote: "CHF" },
    { symbol: "AUDUSD", base: "AUD", quote: "USD" },
    { symbol: "USDCAD", base: "USD", quote: "CAD" },
  ];
}

function getStaticStockAssets() {
  return [
    { symbol: "AAPL", name: "Apple Inc." },
    { symbol: "GOOGL", name: "Alphabet Inc." },
    { symbol: "MSFT", name: "Microsoft Corp." },
    { symbol: "AMZN", name: "Amazon.com Inc." },
    { symbol: "TSLA", name: "Tesla Inc." },
  ];
}

async function refreshAssets() {
  const cls = assetClassSelect.value;
  selectedAsset = null;
  selectedAssetDisplay.textContent = "—";
  livePriceSpan.textContent = "—";
  clearInterval(priceIntervalRef);
  assetListContainer.innerHTML = "";
  setStatus("");

  if (cls === "crypto") {
    assets = await loadCryptoAssets();
    filteredAssets = assets;
  } else if (cls === "forex") {
    assets = getStaticForexAssets();
    filteredAssets = assets;
  } else {
    assets = getStaticStockAssets();
    filteredAssets = assets;
  }

  renderAssetList();
}

function renderAssetList() {
  const fragment = document.createDocumentFragment();
  filteredAssets.forEach((asset) => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.textContent = asset.name ? `${asset.symbol} – ${asset.name}` : asset.symbol;
    div.addEventListener("click", () => selectAsset(asset, div));
    fragment.appendChild(div);
  });
  assetListContainer.innerHTML = "";
  assetListContainer.appendChild(fragment);
}

const handleSearch = debounce(() => {
  const q = assetSearchInput.value.toLowerCase();
  filteredAssets = assets.filter((a) => {
    const s = (a.symbol + (a.name || "") + (a.base || "")).toLowerCase();
    return s.includes(q);
  });
  renderAssetList();
}, 200);

/* ========================================================
   Asset Selection & Live Price
   ======================================================== */
function selectAsset(asset, elementDiv) {
  selectedAsset = asset;
  selectedAssetDisplay.textContent = asset.symbol;
  document.querySelectorAll(".list-item").forEach((e) => e.classList.remove("selected"));
  elementDiv.classList.add("selected");

  if (priceIntervalRef) clearInterval(priceIntervalRef);
  updateLivePrice();
  priceIntervalRef = setInterval(updateLivePrice, 5000);
}

async function updateLivePrice() {
  if (!selectedAsset) return;
  const cls = assetClassSelect.value;
  try {
    let price = "—";
    if (cls === "crypto") {
      const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${selectedAsset.symbol}`);
      const data = await res.json();
      price = Number(data.price).toFixed(4);
    } else if ((cls === "forex" || cls === "stock") && ALPHA_VANTAGE_API_KEY) {
      const functionName = cls === "forex" ? "CURRENCY_EXCHANGE_RATE" : "GLOBAL_QUOTE";
      const url = `https://www.alphavantage.co/query?function=${functionName}&${cls === "forex" ? `from_currency=${selectedAsset.base}&to_currency=${selectedAsset.quote}` : `symbol=${selectedAsset.symbol}`}&apikey=${ALPHA_VANTAGE_API_KEY}`;
      const res = await fetch(url);
      const data = await res.json();
      if (cls === "forex") {
        price = Number(data["Realtime Currency Exchange Rate"]["5. Exchange Rate"]).toFixed(5);
      } else {
        price = Number(data["Global Quote"]["05. price"]).toFixed(2);
      }
    }
    livePriceSpan.textContent = price;
  } catch (err) {
    console.error("Live price fetch error", err);
  }
}

/* ========================================================
   Historical Data Fetchers
   ======================================================== */
const BINANCE_INTERVAL_MS = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
  "1M": 30 * 24 * 60 * 60_000,
};

async function fetchBinanceKlines(symbol, interval, startTime, endTime) {
  const limit = 1000;
  let fetchStart = startTime;
  const all = [];
  while (fetchStart < endTime) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${fetchStart}&endTime=${endTime}&limit=${limit}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Unexpected Binance response");
    if (data.length === 0) break;
    all.push(...data);
    const lastOpenTime = data[data.length - 1][0];
    fetchStart = lastOpenTime + BINANCE_INTERVAL_MS[interval];
    // Avoid infinite loop in case API stops early
    if (data.length < limit) break;
  }
  return all.map((d) => ({
    timestamp: d[0],
    open: d[1],
    high: d[2],
    low: d[3],
    close: d[4],
    volume: d[5],
  }));
}

async function fetchAlphaVantage(cls, symbol, interval) {
  if (!ALPHA_VANTAGE_API_KEY) throw new Error("Alpha Vantage API key missing");
  const isForex = cls === "forex";
  const func = isForex ? "FX_INTRADAY" : "TIME_SERIES_INTRADAY";
  const url = `https://www.alphavantage.co/query?function=${func}&${isForex ? `from_symbol=${symbol.substring(0,3)}&to_symbol=${symbol.substring(3)}` : `symbol=${symbol}`}&interval=${interval}&outputsize=full&apikey=${ALPHA_VANTAGE_API_KEY}`;
  const res = await fetch(url);
  const json = await res.json();
  const key = Object.keys(json).find((k) => k.includes("Time Series"));
  const series = json[key];
  if (!series) throw new Error("Alpha Vantage response malformed or throttled");
  return Object.entries(series).map(([ts, v]) => ({
    timestamp: new Date(ts).getTime(),
    open: v["1. open"],
    high: v["2. high"],
    low: v["3. low"],
    close: v["4. close"],
    volume: v["5. volume"],
  }));
}

/* ========================================================
   CSV Generation Handler
   ======================================================== */
async function handleExport() {
  if (!selectedAsset) {
    setStatus("Please select an asset first", true);
    return;
  }
  const cls = assetClassSelect.value;
  const interval = timeframeSelect.value;
  const start = new Date(startDateInput.value).getTime();
  const end = new Date(endDateInput.value).getTime();
  if (isNaN(start) || isNaN(end) || start >= end) {
    setStatus("Please provide a valid date range", true);
    return;
  }
  setStatus("Fetching historical data… this may take a moment");
  exportBtn.disabled = true;
  try {
    let rows;
    if (cls === "crypto") {
      rows = await fetchBinanceKlines(selectedAsset.symbol, interval, start, end);
    } else {
      // Alpha Vantage only supports specific intervals: 1min, 5min, 15min, 30min, 60min
      const avInterval = interval === "1m" ? "1min" : interval === "5m" ? "5min" : interval === "15m" ? "15min" : interval === "1h" ? "60min" : null;
      if (!avInterval) throw new Error("Selected timeframe not supported by Alpha Vantage");
      rows = await fetchAlphaVantage(cls, selectedAsset.symbol, avInterval);
      // Filter by date range
      rows = rows.filter((r) => r.timestamp >= start && r.timestamp <= end);
    }
    // Sort ascending by time
    rows.sort((a, b) => a.timestamp - b.timestamp);
    if (rows.length === 0) throw new Error("No data returned for the specified range");

    // Data integrity check (for crypto where we know interval ms)
    if (cls === "crypto") {
      const intervalMs = BINANCE_INTERVAL_MS[interval];
      for (let i = 1; i < rows.length; i++) {
        if (rows[i].timestamp - rows[i - 1].timestamp !== intervalMs) {
          console.warn("Gap detected between", new Date(rows[i - 1].timestamp), new Date(rows[i].timestamp));
        }
      }
    }

    const csv = jsonToCsv(rows.map((r) => ({
      time: timestampToISO(r.timestamp),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    })));

    downloadBlob(new Blob([csv], { type: "text/csv" }), `${selectedAsset.symbol}_${interval}.csv`);
    setStatus("CSV generated and download should begin shortly");
  } catch (err) {
    console.error(err);
    setStatus("Error: " + err.message, true);
  } finally {
    exportBtn.disabled = false;
  }
}

/* ========================================================
   Event Listeners
   ======================================================== */
assetClassSelect.addEventListener("change", refreshAssets);
assetSearchInput.addEventListener("input", handleSearch);
exportBtn.addEventListener("click", handleExport);

/* Auto-load */
refreshAssets();