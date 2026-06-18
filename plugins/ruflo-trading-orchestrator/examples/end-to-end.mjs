// end-to-end.mjs — runnable demo of the full trading orchestration pipeline.
//
//   node examples/end-to-end.mjs
//
// Needs no API keys, no network, no MCP server. Uses mock market data, the
// reused ruflo-neural-trader CG portfolio solver (local fallback), and the
// fail-closed paper-execution gate.

import {
  MockMarketDataProvider,
  MomentumStrategy,
  PaperBroker,
  RiskGateError,
  TradingOrchestrator,
  evaluateRisk,
  optimizeWeights,
  signBacktest,
  normalizeCandles,
} from '../src/index.mjs';

const hr = (t) => console.log(`\n${'━'.repeat(64)}\n${t}\n${'━'.repeat(64)}`);
const pct = (x) => `${(x * 100).toFixed(2)}%`;

async function main() {
  /** @type {import('../src/types.ts').RiskLimits} */
  const riskLimits = {
    maxPositionPct: 0.1,
    maxConcentrationPct: 0.25,
    maxDrawdownPct: 0.2,
    maxVar95Pct: 0.05,
  };

  const provider = new MockMarketDataProvider({ seed: 7 });
  const strategy = new MomentumStrategy({ lookback: 5, entryThreshold: 0.015, sizePct: 0.05 });
  const broker = new PaperBroker({ cashUsd: 100_000 });

  // ───────────────────────── 1. Full pipeline ─────────────────────────────
  hr('1) END-TO-END PIPELINE  (ingest → regime → signal → risk → execute → backtest)');
  const orchestrator = new TradingOrchestrator({ provider, strategy, riskLimits, broker });
  for (const symbol of ['AAPL', 'SPY', 'NVDA']) {
    const report = await orchestrator.run(symbol, 120);
    console.log(`\n${symbol}  [strategy: ${strategy.describe()}]`);
    console.log(`  regime      : ${report.regime}`);
    if (report.proposal) {
      console.log(`  signal      : ${report.proposal.side} ${pct(report.proposal.sizePct)} (signalId ${report.proposal.signalId.slice(0, 8)}…)`);
      console.log(`  risk gate   : ${report.decision.decision}` + (report.decision.reasons.length ? ` — ${report.decision.reasons.join('; ')}` : ''));
      console.log(`  execution   : ${report.trade ? `FILLED ${report.trade.qty.toFixed(2)} @ ${report.trade.price}` : 'blocked (fail-closed gate)'}`);
    } else {
      console.log('  signal      : none on latest bar');
    }
    const bt = report.backtest;
    console.log(`  backtest    : return ${pct(bt.totalReturn)} | Sharpe ${bt.sharpe.toFixed(2)} | maxDD ${pct(bt.maxDrawdown)} | ${bt.trades} trades`);
  }

  // ─────────────────── 2. Risk gate: approved vs rejected ──────────────────
  hr('2) RISK GATE  (deterministic approve + reject, then fail-closed execution)');
  const gateBroker = new PaperBroker({ cashUsd: 100_000 });

  const okProposal = mkProposal('MSFT', 'long', 0.04);
  const okDecision = evaluateRisk(okProposal, { volatility: 0.01, concentrationPct: 0, drawdownPct: 0 }, riskLimits);
  console.log(`\n  APPROVED case: size ${pct(okProposal.sizePct)}, vol 1.00% → ${okDecision.decision} (VaR ${pct(okDecision.metrics.var95)})`);
  const fill = gateBroker.execute(okProposal, okDecision, 410.0);
  console.log(`    → executed: ${fill.qty.toFixed(2)} shares @ ${fill.price}`);

  const badProposal = mkProposal('MEME', 'long', 0.2); // oversized + paired with high vol
  const badDecision = evaluateRisk(badProposal, { volatility: 0.4, concentrationPct: 0, drawdownPct: 0 }, riskLimits);
  console.log(`\n  REJECTED case: size ${pct(badProposal.sizePct)}, vol 40.00% → ${badDecision.decision}`);
  console.log(`    reasons: ${badDecision.reasons.join('; ')}`);
  try {
    gateBroker.execute(badProposal, badDecision, 5.0);
    console.log('    → executed (UNEXPECTED — gate failed!)');
  } catch (err) {
    if (err instanceof RiskGateError) console.log(`    → execution correctly BLOCKED: ${err.message}`);
    else throw err;
  }

  // ─────────────────── 3. Portfolio optimization (reuse) ───────────────────
  hr('3) PORTFOLIO OPTIMIZATION  (reuses ruflo-neural-trader CG solver)');
  const expectedReturns = [0.08, 0.12, 0.05];
  const covariance = [
    [0.040, 0.010, 0.004],
    [0.010, 0.090, 0.002],
    [0.004, 0.002, 0.020],
  ];
  const port = await optimizeWeights(expectedReturns, covariance);
  console.log(`\n  solver      : ${port.solver} (method ${port.method}, ${port.iterations} iters, residual ${port.residual.toExponential(2)})`);
  console.log(`  weights     : ${port.weights.map((w) => pct(w)).join(', ')}`);

  // ─────────────────── 4. Optional signed backtest artifact ────────────────
  hr('4) SIGNED BACKTEST ARTIFACT  (reuses ruflo-neural-trader Ed25519 signer)');
  const report = await orchestrator.run('AAPL', 120);
  const key = process.env.RUFLO_DEMO_WITNESS_KEY;
  if (key) {
    const artifact = await signBacktest(report.backtest, strategy.config, key);
    console.log(`\n  signed      : ${artifact.schema}`);
    console.log(`  witnessKey  : ${artifact.witnessPublicKey.slice(0, 24)}…`);
    console.log(`  signature   : ${artifact.witnessSignature.slice(0, 24)}…`);
  } else {
    console.log('\n  signing skipped (set RUFLO_DEMO_WITNESS_KEY=<64-hex> to produce a signed artifact)');
    // Still demonstrate the artifact body that WOULD be signed.
    const normalized = normalizeCandles(await provider.fetch('AAPL', 3));
    console.log(`  ingestion   : normalized 3 sample candles (e.g. closeNorm=${normalized[2].closeNorm.toFixed(4)})`);
  }

  console.log('\n✓ end-to-end demo complete\n');
}

/** @returns {import('../src/types.ts').SignalProposal} */
function mkProposal(symbol, side, sizePct) {
  return {
    type: 'signal-proposal/v1',
    from: 'trading-strategist',
    signalId: `demo-${symbol}-${side}`,
    timestamp: new Date().toISOString(),
    symbol,
    side,
    strategyId: 'demo',
    sizePct,
    confidence: 0.8,
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
