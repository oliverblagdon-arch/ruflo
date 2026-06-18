import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBacktest, sharpeRatio, maxDrawdown, sha256Hex, buildArtifactBody } from '../src/backtest.mjs';
import { MomentumStrategy } from '../src/strategies.mjs';

test('maxDrawdown computes the worst peak-to-trough drop', () => {
  // peak 1.2 → trough 0.9 ⇒ dd = (1.2-0.9)/1.2 = 0.25
  assert.ok(Math.abs(maxDrawdown([1.0, 1.2, 0.9, 1.1]) - 0.25) < 1e-12);
  assert.equal(maxDrawdown([1, 1, 1]), 0);
});

test('sharpeRatio is 0 for fewer than two returns or zero variance', () => {
  assert.equal(sharpeRatio([0.01]), 0);
  assert.equal(sharpeRatio([0.01, 0.01, 0.01]), 0);
});

test('sharpeRatio scales positive mean returns positively', () => {
  const s = sharpeRatio([0.01, 0.02, 0.015, 0.012]);
  assert.ok(s > 0);
});

test('runBacktest on a steadily rising series with momentum is profitable', () => {
  const closes = Array.from({ length: 40 }, (_, i) => 100 * 1.01 ** i);
  const candles = closes.map((close, i) => ({
    timestamp: i * 86_400_000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
  }));
  const result = runBacktest(candles, new MomentumStrategy({ lookback: 3, entryThreshold: 0.005, sizePct: 1 }), { symbol: 'UP' });
  assert.ok(result.totalReturn > 0, `expected profit, got ${result.totalReturn}`);
  assert.equal(result.equityCurve.length, candles.length);
  assert.ok(result.trades >= 1);
});

test('runBacktest handles degenerate short series', () => {
  const result = runBacktest([{ timestamp: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 }], new MomentumStrategy(), { symbol: 'X' });
  assert.equal(result.totalReturn, 0);
  assert.equal(result.trades, 0);
});

test('buildArtifactBody produces a SignedBacktestArtifactBody shape', () => {
  const result = { strategyId: 'm', startTs: 0, endTs: 86_400_000, totalReturn: 0.1, sharpe: 1.2, maxDrawdown: 0.05, trades: 3, equityCurve: [1, 1.1] };
  const body = buildArtifactBody(result, { lookback: 5 });
  assert.equal(body.strategyId, 'm');
  assert.match(body.paramsHash, /^[0-9a-f]{64}$/);
  assert.match(body.runsHash, /^[0-9a-f]{64}$/);
  assert.ok(body.dataRange.from && body.dataRange.to);
  assert.equal(body.metrics.totalReturn, 0.1);
});

test('sha256Hex is stable', () => {
  assert.equal(sha256Hex({ a: 1 }), sha256Hex({ a: 1 }));
});
