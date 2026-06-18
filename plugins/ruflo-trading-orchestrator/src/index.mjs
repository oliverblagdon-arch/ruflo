// index.mjs — public barrel for the trading orchestration layer.
//
// Type contracts live in `types.ts`; these are the runtime exports.

export { MockMarketDataProvider, normalizeCandles, mulberry32 } from './market-data.mjs';
export { MomentumStrategy, MeanReversionStrategy } from './strategies.mjs';
export { evaluateRisk, var95, kellySize, realizedVolatility } from './risk.mjs';
export { PaperBroker, RiskGateError } from './execution.mjs';
export { optimizeWeights } from './portfolio.mjs';
export {
  runBacktest,
  sharpeRatio,
  maxDrawdown,
  buildArtifactBody,
  signBacktest,
  sha256Hex,
} from './backtest.mjs';
export { TradingOrchestrator, classifyRegime } from './orchestrator.mjs';
