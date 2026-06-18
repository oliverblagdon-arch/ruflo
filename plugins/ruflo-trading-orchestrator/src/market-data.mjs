// market-data.mjs — OHLCV ingestion + normalization.
//
// Runtime mirror for the types declared in `types.ts`. Implements the
// ruflo-market-data normalization contract (that plugin is spec-only and ships
// no importable code, so the documented formulas are re-implemented here
// faithfully). Stored OHLCV belongs in the `market-data` namespace and detected
// patterns in `market-patterns` — see ruflo-market-data/docs/adrs/0001.

/**
 * Deterministic PRNG (Mulberry32). Same seed → same sequence, so the mock
 * provider and the tests are reproducible.
 * @param {number} seed
 * @returns {() => number} generator yielding floats in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Normalize raw OHLCV candles into the 5-dimension ruflo-market-data vector.
 *
 *   openNorm   = (open  - prevClose) / prevClose   (first candle: 0)
 *   highNorm   = (high  - open)      / open
 *   lowNorm    = (low   - open)      / open
 *   closeNorm  = (close - open)      / open
 *   volumeNorm = (volume - meanVol)  / stdVol      (z-score over the window)
 *
 * @param {import('./types.ts').Candle[]} candles
 * @returns {import('./types.ts').NormalizedCandle[]}
 */
export function normalizeCandles(candles) {
  if (!Array.isArray(candles) || candles.length === 0) return [];

  const vols = candles.map((c) => c.volume);
  const meanVol = vols.reduce((s, v) => s + v, 0) / vols.length;
  const variance =
    vols.reduce((s, v) => s + (v - meanVol) ** 2, 0) / vols.length;
  const stdVol = Math.sqrt(variance);

  return candles.map((c, i) => {
    const prevClose = i > 0 ? candles[i - 1].close : c.open;
    const safePrev = prevClose === 0 ? 1 : prevClose;
    const safeOpen = c.open === 0 ? 1 : c.open;
    return {
      timestamp: c.timestamp,
      openNorm: i === 0 ? 0 : (c.open - prevClose) / safePrev,
      highNorm: (c.high - c.open) / safeOpen,
      lowNorm: (c.low - c.open) / safeOpen,
      closeNorm: (c.close - c.open) / safeOpen,
      volumeNorm: stdVol === 0 ? 0 : (c.volume - meanVol) / stdVol,
    };
  });
}

/**
 * Mock market-data provider — generates a deterministic geometric random walk.
 * `drift` and `vol` are derived from a hash of the symbol so different symbols
 * trend differently (lets the example show both an approved and a rejected
 * trade without hand-tuning). Implements `MarketDataProvider`.
 */
export class MockMarketDataProvider {
  /**
   * @param {object} [opts]
   * @param {number} [opts.seed=42] base RNG seed
   * @param {number} [opts.startPrice=100] first candle's price
   * @param {number} [opts.intervalMs=86400000] spacing between candles (1d)
   */
  constructor(opts = {}) {
    this.seed = opts.seed ?? 42;
    this.startPrice = opts.startPrice ?? 100;
    this.intervalMs = opts.intervalMs ?? 86_400_000;
  }

  /**
   * @param {string} symbol
   * @param {number} count
   * @returns {Promise<import('./types.ts').Candle[]>}
   */
  async fetch(symbol, count) {
    if (typeof symbol !== 'string' || symbol.length === 0) {
      throw new Error('MockMarketDataProvider.fetch: symbol must be a non-empty string');
    }
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error('MockMarketDataProvider.fetch: count must be a positive integer');
    }

    const symSeed = hashSymbol(symbol);
    const rand = mulberry32((this.seed ^ symSeed) >>> 0);
    // Symbol-dependent drift/vol so trends differ deterministically.
    const drift = ((symSeed % 7) - 3) * 0.0015; // -0.45%..+0.45% per bar
    const vol = 0.008 + (symSeed % 5) * 0.004; // 0.8%..2.4% per bar

    const candles = [];
    let price = this.startPrice;
    const startTs = 1_700_000_000_000; // fixed epoch for reproducibility
    for (let i = 0; i < count; i++) {
      const shock = (rand() - 0.5) * 2 * vol;
      const open = price;
      const close = open * (1 + drift + shock);
      const high = Math.max(open, close) * (1 + rand() * vol * 0.5);
      const low = Math.min(open, close) * (1 - rand() * vol * 0.5);
      const volume = Math.round(1_000_000 * (0.5 + rand()));
      candles.push({
        timestamp: startTs + i * this.intervalMs,
        open: round2(open),
        high: round2(high),
        low: round2(low),
        close: round2(close),
        volume,
      });
      price = close;
    }
    return candles;
  }
}

/** Stable small-int hash of a ticker symbol. */
function hashSymbol(symbol) {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) {
    h = (Math.imul(h, 31) + symbol.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function round2(x) {
  return Math.round(x * 100) / 100;
}
