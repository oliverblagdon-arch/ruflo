// strategies.mjs — example signal generators.
//
// Each strategy implements the `Strategy` interface from types.ts: given a
// candle series and an index, it returns a Side ('long' | 'short' | 'close')
// or null for no action. The orchestrator wraps the returned side into a
// `SignalProposal` (ruflo-neural-trader pipeline contract).

/**
 * Simple percentage return of close prices from index `i-lookback` to `i`.
 * @param {import('./types.ts').Candle[]} candles
 * @param {number} i
 * @param {number} lookback
 * @returns {number} fractional return, or 0 if insufficient history
 */
function trailingReturn(candles, i, lookback) {
  const j = i - lookback;
  if (j < 0) return 0;
  const past = candles[j].close;
  if (past === 0) return 0;
  return (candles[i].close - past) / past;
}

/** Mean of close prices over [i-lookback+1, i]. */
function trailingMean(candles, i, lookback) {
  const start = Math.max(0, i - lookback + 1);
  let sum = 0;
  let n = 0;
  for (let k = start; k <= i; k++) {
    sum += candles[k].close;
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

/**
 * Momentum: go long when trailing return exceeds +threshold, short when it
 * falls below -threshold. Trend-following — favored in trending regimes.
 * @implements {import('./types.ts').Strategy}
 */
export class MomentumStrategy {
  /** @param {Partial<import('./types.ts').StrategyConfig>} [config] */
  constructor(config = {}) {
    /** @type {import('./types.ts').StrategyConfig} */
    this.config = {
      id: config.id ?? 'momentum',
      lookback: config.lookback ?? 5,
      entryThreshold: config.entryThreshold ?? 0.02,
      sizePct: config.sizePct ?? 0.02,
    };
    this.id = this.config.id;
  }

  describe() {
    return `Momentum(lookback=${this.config.lookback}, threshold=${this.config.entryThreshold})`;
  }

  /**
   * @param {import('./types.ts').Candle[]} candles
   * @param {number} i
   * @param {import('./types.ts').Regime} [regime]
   * @returns {import('./types.ts').Side | null}
   */
  generate(candles, i, regime) {
    if (i < this.config.lookback) return null;
    const ret = trailingReturn(candles, i, this.config.lookback);
    if (ret > this.config.entryThreshold) return 'long';
    if (ret < -this.config.entryThreshold) return 'short';
    return null;
  }
}

/**
 * Mean-reversion: go long when price is below its moving average by more than
 * threshold (expecting a bounce), short when above. Favored in ranging regimes.
 * @implements {import('./types.ts').Strategy}
 */
export class MeanReversionStrategy {
  /** @param {Partial<import('./types.ts').StrategyConfig>} [config] */
  constructor(config = {}) {
    /** @type {import('./types.ts').StrategyConfig} */
    this.config = {
      id: config.id ?? 'mean-reversion',
      lookback: config.lookback ?? 10,
      entryThreshold: config.entryThreshold ?? 0.015,
      sizePct: config.sizePct ?? 0.02,
    };
    this.id = this.config.id;
  }

  describe() {
    return `MeanReversion(lookback=${this.config.lookback}, threshold=${this.config.entryThreshold})`;
  }

  /**
   * @param {import('./types.ts').Candle[]} candles
   * @param {number} i
   * @param {import('./types.ts').Regime} [regime]
   * @returns {import('./types.ts').Side | null}
   */
  generate(candles, i, regime) {
    if (i < this.config.lookback) return null;
    const ma = trailingMean(candles, i, this.config.lookback);
    if (ma === 0) return null;
    const dev = (candles[i].close - ma) / ma;
    if (dev < -this.config.entryThreshold) return 'long';
    if (dev > this.config.entryThreshold) return 'short';
    return null;
  }
}

export { trailingReturn, trailingMean };
