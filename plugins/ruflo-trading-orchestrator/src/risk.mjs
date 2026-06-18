// risk.mjs — the risk gate.
//
// `evaluateRisk` turns a SignalProposal + portfolio context into a RiskDecision
// (both ruflo-neural-trader pipeline contracts). This mirrors the role of the
// neural-trader `risk-analyst` agent: it is the BLOCKING GATE between a proposed
// trade and execution. The PaperBroker (execution.mjs) refuses any proposal
// that does not carry a matching `approved` RiskDecision.

/**
 * Annualization-free, one-bar parametric 95% VaR of a new position, as a
 * fraction of the portfolio: sizePct * volatility * z(0.95).
 * @param {number} sizePct position size as portfolio fraction
 * @param {number} volatility per-bar return stdev (fraction)
 * @returns {number}
 */
export function var95(sizePct, volatility) {
  const Z_95 = 1.645;
  return Math.abs(sizePct) * Math.abs(volatility) * Z_95;
}

/**
 * Fractional-Kelly position size. Returns a fraction in [0, cap].
 * @param {number} winProb probability of a winning trade [0,1]
 * @param {number} winLoss payoff ratio (avg win / avg loss), > 0
 * @param {number} [fraction=0.5] Kelly fraction (half-Kelly by default)
 * @param {number} [cap=0.1] hard cap on the returned size
 * @returns {number}
 */
export function kellySize(winProb, winLoss, fraction = 0.5, cap = 0.1) {
  if (winLoss <= 0) return 0;
  const edge = winProb - (1 - winProb) / winLoss;
  const kelly = Math.max(0, edge) * fraction;
  return Math.min(kelly, cap);
}

/**
 * @typedef {object} RiskContext
 * @property {number} volatility per-bar return stdev for the symbol (fraction)
 * @property {number} concentrationPct current portfolio weight of this symbol (fraction)
 * @property {number} drawdownPct current portfolio drawdown (positive fraction)
 */

/**
 * Evaluate a proposal against hard limits and return a RiskDecision.
 *
 * Order of checks:
 *   1. `close` proposals always approve (they reduce risk).
 *   2. Circuit breaker: reject if current drawdown exceeds the limit.
 *   3. Sizing: if sizePct exceeds maxPositionPct, shrink it (adjustedSizePct)
 *      rather than reject outright.
 *   4. Concentration: reject if post-trade weight would breach the limit.
 *   5. VaR: reject if the (possibly shrunk) position's 95% VaR breaches the limit.
 *
 * @param {import('./types.ts').SignalProposal} proposal
 * @param {RiskContext} ctx
 * @param {import('./types.ts').RiskLimits} limits
 * @returns {import('./types.ts').RiskDecision}
 */
export function evaluateRisk(proposal, ctx, limits) {
  const now = new Date().toISOString();
  /** @returns {import('./types.ts').RiskDecision} */
  const decide = (decision, reasons, extra = {}) => ({
    type: 'risk-decision/v1',
    from: 'risk-analyst',
    signalId: proposal.signalId,
    timestamp: now,
    decision,
    reasons,
    metrics: {
      var95: var95(extra.sizePct ?? proposal.sizePct, ctx.volatility),
      concentrationPct: ctx.concentrationPct + (extra.sizePct ?? proposal.sizePct),
      drawdownPct: ctx.drawdownPct,
    },
    ...(extra.adjustedSizePct !== undefined
      ? { adjustedSizePct: extra.adjustedSizePct }
      : {}),
  });

  // 1. Risk-reducing close orders always pass.
  if (proposal.side === 'close') {
    return decide('approved', []);
  }

  // 2. Circuit breaker.
  if (ctx.drawdownPct > limits.maxDrawdownPct) {
    return decide('rejected', [
      `drawdown ${(ctx.drawdownPct * 100).toFixed(1)}% exceeds limit ${(limits.maxDrawdownPct * 100).toFixed(1)}%`,
    ]);
  }

  // 3. Sizing — shrink instead of reject when the only problem is size.
  let sizePct = proposal.sizePct;
  let adjustedSizePct;
  if (sizePct > limits.maxPositionPct) {
    adjustedSizePct = limits.maxPositionPct;
    sizePct = adjustedSizePct;
  }

  const reasons = [];

  // 4. Concentration (post-trade).
  const projectedConcentration = ctx.concentrationPct + sizePct;
  if (projectedConcentration > limits.maxConcentrationPct) {
    reasons.push(
      `post-trade concentration ${(projectedConcentration * 100).toFixed(1)}% exceeds limit ${(limits.maxConcentrationPct * 100).toFixed(1)}%`,
    );
  }

  // 5. VaR.
  const v = var95(sizePct, ctx.volatility);
  if (v > limits.maxVar95Pct) {
    reasons.push(
      `95% VaR ${(v * 100).toFixed(2)}% exceeds limit ${(limits.maxVar95Pct * 100).toFixed(2)}%`,
    );
  }

  if (reasons.length > 0) {
    return decide('rejected', reasons, { sizePct, adjustedSizePct });
  }
  return decide('approved', [], { sizePct, adjustedSizePct });
}

/**
 * Compute per-bar return volatility (stdev) from a candle series.
 * @param {import('./types.ts').Candle[]} candles
 * @returns {number}
 */
export function realizedVolatility(candles) {
  if (!Array.isArray(candles) || candles.length < 2) return 0;
  const rets = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    if (prev !== 0) rets.push((candles[i].close - prev) / prev);
  }
  if (rets.length === 0) return 0;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance);
}
