// orchestrator.mjs — the end-to-end trading pipeline.
//
//   ingest (MarketDataProvider)
//     → normalize (ruflo-market-data contract)
//     → classify regime  (RegimeVerdict)
//     → strategy signal   (SignalProposal)
//     → risk gate         (RiskDecision)         ◄── BLOCKING
//     → paper execution   (PaperBroker, fail-closed)
//     → backtest          (BacktestResult)
//
// The regime / proposal / decision objects are the exact ruflo-neural-trader
// pipeline-message contracts, so the same messages could later be sent between
// the real market-analyst → trading-strategist → risk-analyst agents.

import { randomUUID } from 'node:crypto';
import { normalizeCandles } from './market-data.mjs';
import { evaluateRisk, realizedVolatility } from './risk.mjs';
import { PaperBroker, RiskGateError } from './execution.mjs';
import { runBacktest } from './backtest.mjs';

/**
 * Classify the current market regime from a candle series. Produces a
 * ruflo-neural-trader `RegimeVerdict`.
 *
 * @param {import('./types.ts').Candle[]} candles
 * @param {string} symbol
 * @returns {import('./types.ts').RegimeVerdict}
 */
export function classifyRegime(candles, symbol) {
  const n = candles.length;
  const window = Math.min(20, n - 1);
  const vol = realizedVolatility(candles.slice(-window - 1));
  const first = candles[Math.max(0, n - 1 - window)].close;
  const last = candles[n - 1].close;
  const ret = first === 0 ? 0 : (last - first) / first;

  /** @type {import('./types.ts').Regime} */
  let regime;
  if (vol > 0.02) regime = 'high-volatility';
  else if (vol < 0.005) regime = 'low-volatility';
  else if (ret > 0.03) regime = 'bull-trending';
  else if (ret < -0.03) regime = 'bear-trending';
  else regime = 'ranging';

  const confidence = Math.max(0, Math.min(1, 0.5 + Math.abs(ret) * 5));

  return {
    type: 'regime-verdict/v1',
    from: 'market-analyst',
    timestamp: new Date().toISOString(),
    regime,
    symbols: [symbol],
    confidence,
    indicators: { trailingReturn: ret, volatility: vol },
  };
}

export class TradingOrchestrator {
  /**
   * @param {object} deps
   * @param {import('./types.ts').MarketDataProvider} deps.provider
   * @param {import('./types.ts').Strategy} deps.strategy
   * @param {import('./types.ts').RiskLimits} deps.riskLimits
   * @param {PaperBroker} [deps.broker]
   */
  constructor(deps) {
    if (!deps || !deps.provider || !deps.strategy || !deps.riskLimits) {
      throw new Error('TradingOrchestrator: provider, strategy and riskLimits are required');
    }
    this.provider = deps.provider;
    this.strategy = deps.strategy;
    this.riskLimits = deps.riskLimits;
    this.broker = deps.broker ?? new PaperBroker();
  }

  /**
   * Run the full pipeline for one symbol.
   * @param {string} symbol
   * @param {number} [count=120] number of candles to ingest
   * @returns {Promise<import('./types.ts').OrchestratorReport>}
   */
  async run(symbol, count = 120) {
    // 1. Ingest + 2. normalize.
    const candles = await this.provider.fetch(symbol, count);
    const normalized = normalizeCandles(candles);
    void normalized; // computed to honor the ingestion contract; used by callers

    // 3. Regime.
    const regimeVerdict = classifyRegime(candles, symbol);

    // 4. Strategy signal on the most recent bar.
    const i = candles.length - 1;
    const side = this.strategy.generate(candles, i, regimeVerdict.regime);
    const lastClose = candles[i].close;

    /** @type {import('./types.ts').SignalProposal | null} */
    let proposal = null;
    /** @type {import('./types.ts').RiskDecision | null} */
    let decision = null;
    /** @type {import('./types.ts').Trade | null} */
    let trade = null;

    if (side) {
      proposal = {
        type: 'signal-proposal/v1',
        from: 'trading-strategist',
        signalId: randomUUID(),
        timestamp: candles[i] ? new Date(candles[i].timestamp).toISOString() : new Date().toISOString(),
        symbol,
        side,
        strategyId: this.strategy.id,
        sizePct: this.strategy.config.sizePct,
        confidence: regimeVerdict.confidence,
        regime: regimeVerdict.regime,
      };

      // 5. Risk gate.
      const equity = this.broker.equityAt({ [symbol]: lastClose });
      const pos = this.broker.positions.get(symbol);
      const concentrationPct =
        pos && equity > 0 ? Math.abs(pos.qty * lastClose) / equity : 0;
      const ctx = {
        volatility: realizedVolatility(candles),
        concentrationPct,
        drawdownPct: Math.max(
          0,
          (this.broker.initialCash - equity) / this.broker.initialCash,
        ),
      };
      decision = evaluateRisk(proposal, ctx, this.riskLimits);

      // 6. Paper execution — fail-closed.
      try {
        trade = this.broker.execute(proposal, decision, lastClose);
      } catch (err) {
        if (!(err instanceof RiskGateError)) throw err;
        trade = null; // gate blocked it; report reflects the rejection
      }
    }

    // 7. Backtest over the full series.
    const backtest = runBacktest(candles, this.strategy, { symbol });

    return {
      symbol,
      regime: regimeVerdict.regime,
      proposal,
      decision,
      trade,
      backtest,
    };
  }
}
