import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCandles, MockMarketDataProvider } from '../src/market-data.mjs';

test('normalizeCandles applies the ruflo-market-data formulas', () => {
  const candles = [
    { timestamp: 1, open: 100, high: 110, low: 95, close: 105, volume: 1000 },
    { timestamp: 2, open: 105, high: 115, low: 100, close: 110, volume: 2000 },
  ];
  const norm = normalizeCandles(candles);

  // First candle: openNorm is 0 by contract.
  assert.equal(norm[0].openNorm, 0);
  // closeNorm = (close - open) / open
  assert.ok(Math.abs(norm[0].closeNorm - (105 - 100) / 100) < 1e-12);
  // highNorm = (high - open) / open
  assert.ok(Math.abs(norm[0].highNorm - (110 - 100) / 100) < 1e-12);
  // lowNorm = (low - open) / open
  assert.ok(Math.abs(norm[0].lowNorm - (95 - 100) / 100) < 1e-12);

  // Second candle openNorm = (open - prevClose) / prevClose
  assert.ok(Math.abs(norm[1].openNorm - (105 - 105) / 105) < 1e-12);
});

test('normalizeCandles returns [] for empty input', () => {
  assert.deepEqual(normalizeCandles([]), []);
});

test('volumeNorm is a z-score (mean-zero across the window)', () => {
  const candles = [
    { timestamp: 1, open: 10, high: 11, low: 9, close: 10, volume: 100 },
    { timestamp: 2, open: 10, high: 11, low: 9, close: 10, volume: 200 },
    { timestamp: 3, open: 10, high: 11, low: 9, close: 10, volume: 300 },
  ];
  const norm = normalizeCandles(candles);
  const sum = norm.reduce((s, c) => s + c.volumeNorm, 0);
  assert.ok(Math.abs(sum) < 1e-9, 'z-scores should sum to ~0');
});

test('MockMarketDataProvider is deterministic for a given seed', async () => {
  const a = await new MockMarketDataProvider({ seed: 99 }).fetch('AAPL', 30);
  const b = await new MockMarketDataProvider({ seed: 99 }).fetch('AAPL', 30);
  assert.deepEqual(a, b);
  assert.equal(a.length, 30);
  // OHLC integrity: high >= max(open, close), low <= min(open, close).
  for (const c of a) {
    assert.ok(c.high >= Math.max(c.open, c.close) - 1e-9);
    assert.ok(c.low <= Math.min(c.open, c.close) + 1e-9);
    assert.ok(c.volume > 0);
  }
});

test('MockMarketDataProvider validates inputs', async () => {
  const p = new MockMarketDataProvider();
  await assert.rejects(() => p.fetch('', 10));
  await assert.rejects(() => p.fetch('AAPL', 0));
  await assert.rejects(() => p.fetch('AAPL', -5));
});
