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

const ALLORIGINS = "https://api.allorigins.win/raw?url=";

const YAHOO_INTERVAL_MAP = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "60m",
  "4h": "60m", // Approximate using 1h data
  "1d": "1d",
  "1w": "1wk",
  "1M": "1mo",
};

async function fetchYahooCandles(symbol, interval, startMs, endMs) {
  const intervalParam = YAHOO_INTERVAL_MAP[interval];
  if (!intervalParam) throw new Error("Selected timeframe not supported for Yahoo Finance");
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${Math.floor(
    startMs / 1000
  )}&period2=${Math.floor(endMs / 1000)}&interval=${intervalParam}&includePrePost=false`;
  const proxied = ALLORIGINS + encodeURIComponent(url);
  const res = await fetch(proxied);
  const json = await res.json();
  if (!json.chart || !json.chart.result || !json.chart.result[0]) {
    throw new Error("Yahoo Finance response malformed or unavailable");
  }
  const result = json.chart.result[0];
  const tsArr = result.timestamp;
  const quote = result.indicators.quote[0];
  const rows = tsArr.map((ts, i) => ({
    timestamp: ts * 1000,
    open: quote.open[i],
    high: quote.high[i],
    low: quote.low[i],
    close: quote.close[i],
    volume: quote.volume[i],
  })).filter((r) => r.open != null && r.close != null);
  return rows;
}

async function fetchYahooLatestPrice(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`;
  const proxied = ALLORIGINS + encodeURIComponent(url);
  const res = await fetch(proxied);
  const json = await res.json();
  if (!json.chart || !json.chart.result || !json.chart.result[0]) return "—";
  const quote = json.chart.result[0].indicators.quote[0];
  const closes = quote.close.filter((v) => v != null);
  const last = closes[closes.length - 1];
  return last ? Number(last).toFixed(4) : "—";
}

function getStaticForexAssets() {
  return [
    { symbol: "EURUSD=X", display: "EUR/USD" },
    { symbol: "GBPUSD=X", display: "GBP/USD" },
    { symbol: "USDJPY=X", display: "USD/JPY" },
    { symbol: "USDCHF=X", display: "USD/CHF" },
    { symbol: "AUDUSD=X", display: "AUD/USD" },
    { symbol: "USDCAD=X", display: "USD/CAD" },
  ];
}

function getStaticStockAssets() {
  return [
    { symbol: "AAPL", name: "Apple Inc.", display: "AAPL" },
    { symbol: "GOOGL", name: "Alphabet Inc.", display: "GOOGL" },
    { symbol: "MSFT", name: "Microsoft Corp.", display: "MSFT" },
    { symbol: "AMZN", name: "Amazon.com Inc.", display: "AMZN" },
    { symbol: "TSLA", name: "Tesla Inc.", display: "TSLA" },
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
    const text = asset.name ? `${asset.display || asset.symbol} – ${asset.name}` : (asset.display || asset.symbol);
    div.textContent = text;
    div.addEventListener("click", () => selectAsset(asset, div));
    fragment.appendChild(div);
  });
  assetListContainer.innerHTML = "";
  assetListContainer.appendChild(fragment);
}

const handleSearch = debounce(() => {
  const q = assetSearchInput.value.toLowerCase();
  filteredAssets = assets.filter((a) => {
    const s = (
      (a.symbol || "") + (a.display || "") + (a.name || "") + (a.base || "")
    ).toLowerCase();
    return s.includes(q);
  });
  renderAssetList();
}, 200);

/* ========================================================
   Asset Selection & Live Price
   ======================================================== */
function selectAsset(asset, elementDiv) {
  selectedAsset = asset;
  selectedAssetDisplay.textContent = asset.display || asset.symbol;
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
    } else {
      price = await fetchYahooLatestPrice(selectedAsset.symbol);
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
      rows = await fetchYahooCandles(selectedAsset.symbol, interval, start, end);
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