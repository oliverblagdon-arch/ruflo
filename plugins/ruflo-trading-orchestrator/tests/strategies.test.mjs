import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MomentumStrategy, MeanReversionStrategy } from '../src/strategies.mjs';

/** Build a candle series from a list of close prices. */
function series(closes) {
  return closes.map((close, i) => ({
    timestamp: i,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
  }));
}

test('MomentumStrategy goes long on a rising series', () => {
  const s = new MomentumStrategy({ lookback: 3, entryThreshold: 0.02 });
  const candles = series([100, 102, 104, 110]);
  assert.equal(s.generate(candles, 3), 'long');
});

test('MomentumStrategy goes short on a falling series', () => {
  const s = new MomentumStrategy({ lookback: 3, entryThreshold: 0.02 });
  const candles = series([100, 98, 96, 90]);
  assert.equal(s.generate(candles, 3), 'short');
});

test('MomentumStrategy returns null before enough history', () => {
  const s = new MomentumStrategy({ lookback: 5 });
  const candles = series([100, 101, 102]);
  assert.equal(s.generate(candles, 2), null);
});

test('MeanReversionStrategy goes long when price dips below its mean', () => {
  const s = new MeanReversionStrategy({ lookback: 3, entryThreshold: 0.01 });
  // mean of close[1..3] (100,100,90) ≈ 96.67; last 90 is ~6.9% below → long
  const candles = series([100, 100, 100, 90]);
  assert.equal(s.generate(candles, 3), 'long');
});

test('MeanReversionStrategy goes short when price spikes above its mean', () => {
  const s = new MeanReversionStrategy({ lookback: 3, entryThreshold: 0.01 });
  // mean of close[1..3] (100,100,115) = 105; last 115 is ~9.5% above → short
  const candles = series([100, 100, 100, 115]);
  assert.equal(s.generate(candles, 3), 'short');
});

test('strategy describe() and config are exposed', () => {
  const s = new MomentumStrategy({ id: 'mo', sizePct: 0.03 });
  assert.equal(s.id, 'mo');
  assert.equal(s.config.sizePct, 0.03);
  assert.match(s.describe(), /Momentum/);
});
