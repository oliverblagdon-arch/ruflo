/**
 * Typed contract for the trading orchestration layer.
 *
 * This file is the source-of-truth for the orchestrator's type shapes. The
 * runtime implementations live in the sibling `*.mjs` files (zero-compile ES
 * modules, run directly under `node`), following the same dual-file convention
 * `ruflo-neural-trader` uses for its `src/*.ts` + `src/*.mjs` pairs.
 *
 * The agent-pipeline message shapes (`RegimeVerdict`, `SignalProposal`,
 * `RiskDecision`) are re-exported from `ruflo-neural-trader` — the orchestrator
 * produces and consumes those exact contracts rather than inventing parallel
 * ones.
 */

export type {
  RegimeVerdict,
  SignalProposal,
  RiskDecision,
  PipelineMessage,
} from '../../ruflo-neural-trader/src/pipeline-messages.ts';

import type { RegimeVerdict } from '../../ruflo-neural-trader/src/pipeline-messages.ts';

/** Direction of a trade action (matches `SignalProposal.side`). */
export type Side = 'long' | 'short' | 'close';

/** Market regime label (matches `RegimeVerdict.regime`). */
export type Regime = RegimeVerdict['regime'];

/* ----------------------------------------------------------------------- */
/* Market data (ruflo-market-data contract)                                */
/* ----------------------------------------------------------------------- */

/** Raw OHLCV candle — the ruflo-market-data ingestion shape. */
export interface Candle {
  /** Unix epoch milliseconds. */
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Normalized OHLCV vector — the 5-dimension ruflo-market-data normalization:
 *   openNorm   = (open  - prevClose) / prevClose
 *   highNorm   = (high  - open)      / open
 *   lowNorm    = (low   - open)      / open
 *   closeNorm  = (close - open)      / open
 *   volumeNorm = z-score of volume over the window
 */
export interface NormalizedCandle {
  timestamp: number;
  openNorm: number;
  highNorm: number;
  lowNorm: number;
  closeNorm: number;
  volumeNorm: number;
}

/** Pluggable source of OHLCV candles (mock for the scaffold; real feed later). */
export interface MarketDataProvider {
  /** Fetch `count` most-recent candles for `symbol`, oldest-first. */
  fetch(symbol: string, count: number): Promise<Candle[]>;
}

/* ----------------------------------------------------------------------- */
/* Strategy + signals                                                      */
/* ----------------------------------------------------------------------- */

/** Tuning parameters for an example strategy. */
export interface StrategyConfig {
  id: string;
  /** Number of trailing candles the strategy inspects. */
  lookback: number;
  /** Entry threshold (fractional move / deviation that triggers a signal). */
  entryThreshold: number;
  /** Default proposed size as a fraction of the portfolio (0.02 = 2%). */
  sizePct: number;
}

/** A signal generator over a candle series. */
export interface Strategy {
  readonly id: string;
  readonly config: StrategyConfig;
  /** Human-readable one-liner. */
  describe(): string;
  /**
   * Inspect the series up to and including index `i` and return a side, or
   * `null` for no action. `regime` is the upstream market-analyst verdict.
   */
  generate(candles: Candle[], i: number, regime?: Regime): Side | null;
}

/* ----------------------------------------------------------------------- */
/* Risk + execution                                                        */
/* ----------------------------------------------------------------------- */

/** Hard limits the risk gate enforces. All values are fractions (0.1 = 10%). */
export interface RiskLimits {
  /** Max size of a single new position as a fraction of the portfolio. */
  maxPositionPct: number;
  /** Max fraction of the portfolio a single symbol may represent post-trade. */
  maxConcentrationPct: number;
  /** Reject if recent drawdown exceeds this fraction. */
  maxDrawdownPct: number;
  /** Reject if the parametric 95% VaR of the new position exceeds this. */
  maxVar95Pct: number;
}

/** A held position. */
export interface Position {
  symbol: string;
  /** Signed quantity — positive long, negative short. */
  qty: number;
  /** Average entry price. */
  avgPrice: number;
}

/** A filled paper trade. */
export interface Trade {
  timestamp: number;
  symbol: string;
  side: Side;
  qty: number;
  price: number;
  /** Correlates back to the SignalProposal that produced it. */
  signalId: string;
}

/* ----------------------------------------------------------------------- */
/* Backtest                                                                */
/* ----------------------------------------------------------------------- */

/** Summary metrics from a single-symbol backtest. */
export interface BacktestResult {
  symbol: string;
  strategyId: string;
  startTs: number;
  endTs: number;
  /** Total return over the window as a fraction (0.12 = +12%). */
  totalReturn: number;
  /** Annualized Sharpe ratio (daily bars, sqrt(252) scaling). */
  sharpe: number;
  /** Worst peak-to-trough drawdown as a positive fraction. */
  maxDrawdown: number;
  /** Number of fills executed. */
  trades: number;
  /** Equity curve, one point per candle. */
  equityCurve: number[];
}

/** Result of a full orchestrator run. */
export interface OrchestratorReport {
  symbol: string;
  regime: Regime;
  proposal: import('../../ruflo-neural-trader/src/pipeline-messages.ts').SignalProposal | null;
  decision: import('../../ruflo-neural-trader/src/pipeline-messages.ts').RiskDecision | null;
  trade: Trade | null;
  backtest: BacktestResult;
}
