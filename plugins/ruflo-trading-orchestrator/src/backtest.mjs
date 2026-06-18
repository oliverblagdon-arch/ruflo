// backtest.mjs — single-symbol strategy backtest + optional signed artifact.
//
// Computes total return, annualized Sharpe and max drawdown over a candle
// series, then OPTIONALLY signs the result using the ruflo-neural-trader
// Ed25519 artifact signer (reused, not reimplemented). Signing is opt-in: it
// only runs when a witness private key is supplied, and the import of
// @noble/ed25519 happens lazily inside the neural-trader signer — so the default
// (unsigned) path needs no extra dependencies.

import { createHash } from 'node:crypto';

/**
 * Run a backtest for one strategy over one candle series.
 *
 * Position model: the strategy's signal sets a target exposure of ±sizePct
 * (long/short) or 0 (close). Each bar's return is `position * barReturn`.
 *
 * @param {import('./types.ts').Candle[]} candles oldest-first
 * @param {import('./types.ts').Strategy} strategy
 * @param {object} [opts]
 * @param {number} [opts.sizePct] exposure per signal (defaults to strategy.config.sizePct)
 * @param {string} [opts.symbol='UNKNOWN']
 * @returns {import('./types.ts').BacktestResult}
 */
export function runBacktest(candles, strategy, opts = {}) {
  const symbol = opts.symbol ?? 'UNKNOWN';
  const sizePct = opts.sizePct ?? strategy.config.sizePct;

  if (!Array.isArray(candles) || candles.length < 2) {
    return {
      symbol,
      strategyId: strategy.id,
      startTs: candles[0]?.timestamp ?? 0,
      endTs: candles[candles.length - 1]?.timestamp ?? 0,
      totalReturn: 0,
      sharpe: 0,
      maxDrawdown: 0,
      trades: 0,
      equityCurve: [1],
    };
  }

  let equity = 1;
  let position = 0; // current exposure, signed fraction
  let trades = 0;
  const equityCurve = [equity];
  const barReturns = [];

  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].close;
    const barReturn = prevClose === 0 ? 0 : (candles[i].close - prevClose) / prevClose;
    const stratReturn = position * barReturn;
    equity *= 1 + stratReturn;
    equityCurve.push(equity);
    barReturns.push(stratReturn);

    // Decide next-bar position from the signal at bar i.
    const side = strategy.generate(candles, i);
    let target = position;
    if (side === 'long') target = sizePct;
    else if (side === 'short') target = -sizePct;
    else if (side === 'close') target = 0;
    if (target !== position) {
      trades++;
      position = target;
    }
  }

  return {
    symbol,
    strategyId: strategy.id,
    startTs: candles[0].timestamp,
    endTs: candles[candles.length - 1].timestamp,
    totalReturn: equity - 1,
    sharpe: sharpeRatio(barReturns),
    maxDrawdown: maxDrawdown(equityCurve),
    trades,
    equityCurve,
  };
}

/**
 * Annualized Sharpe ratio from a series of per-bar returns (daily bars).
 * @param {number[]} returns
 * @param {number} [periodsPerYear=252]
 * @returns {number}
 */
export function sharpeRatio(returns, periodsPerYear = 252) {
  if (!returns || returns.length < 2) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (mean / std) * Math.sqrt(periodsPerYear);
}

/**
 * Worst peak-to-trough drawdown of an equity curve, as a positive fraction.
 * @param {number[]} equityCurve
 * @returns {number}
 */
export function maxDrawdown(equityCurve) {
  if (!equityCurve || equityCurve.length === 0) return 0;
  let peak = equityCurve[0];
  let maxDd = 0;
  for (const v of equityCurve) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = (peak - v) / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return maxDd;
}

/** Canonical sha256 hex of a JSON-able value. */
export function sha256Hex(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Build the SignedBacktestArtifact *body* (everything except signature fields)
 * from a backtest result. Matches the ruflo-neural-trader
 * `SignedBacktestArtifactBody` shape.
 *
 * @param {import('./types.ts').BacktestResult} result
 * @param {object} params strategy params to hash into the artifact
 * @returns {object} artifact body
 */
export function buildArtifactBody(result, params) {
  return {
    strategyId: result.strategyId,
    paramsHash: sha256Hex(params),
    dataRange: {
      from: new Date(result.startTs).toISOString(),
      to: new Date(result.endTs).toISOString(),
    },
    metrics: {
      totalReturn: result.totalReturn,
      sharpe: result.sharpe,
      maxDrawdown: result.maxDrawdown,
      trades: result.trades,
    },
    runsHash: sha256Hex(result.equityCurve),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Optionally sign a backtest result. Returns the signed artifact, or null if
 * no key is provided. Reuses ruflo-neural-trader's signBacktestArtifact.
 *
 * @param {import('./types.ts').BacktestResult} result
 * @param {object} params
 * @param {string} [privateKeyHex] 32-byte Ed25519 key; if omitted, returns null
 * @returns {Promise<object | null>}
 */
export async function signBacktest(result, params, privateKeyHex) {
  if (!privateKeyHex) return null;
  const { signBacktestArtifact } = await import(
    '../../ruflo-neural-trader/src/signed-artifact.mjs'
  );
  return signBacktestArtifact(buildArtifactBody(result, params), privateKeyHex);
}
