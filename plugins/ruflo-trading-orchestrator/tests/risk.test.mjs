import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRisk, var95, kellySize, realizedVolatility } from '../src/risk.mjs';

/** @type {import('../src/types.ts').RiskLimits} */
const limits = {
  maxPositionPct: 0.1,
  maxConcentrationPct: 0.25,
  maxDrawdownPct: 0.2,
  maxVar95Pct: 0.05,
};

function proposal(sizePct, side = 'long') {
  return {
    type: 'signal-proposal/v1',
    from: 'trading-strategist',
    signalId: 'sig-1',
    timestamp: new Date().toISOString(),
    symbol: 'AAPL',
    side,
    strategyId: 'momentum',
    sizePct,
    confidence: 0.7,
  };
}

test('var95 = size * vol * 1.645', () => {
  assert.ok(Math.abs(var95(0.1, 0.2) - 0.1 * 0.2 * 1.645) < 1e-12);
});

test('approves a proposal within all limits', () => {
  const d = evaluateRisk(proposal(0.04), { volatility: 0.01, concentrationPct: 0, drawdownPct: 0 }, limits);
  assert.equal(d.decision, 'approved');
  assert.deepEqual(d.reasons, []);
  assert.equal(d.signalId, 'sig-1');
});

test('rejects when VaR exceeds the limit', () => {
  const d = evaluateRisk(proposal(0.1), { volatility: 0.4, concentrationPct: 0, drawdownPct: 0 }, limits);
  assert.equal(d.decision, 'rejected');
  assert.ok(d.reasons.some((r) => r.includes('VaR')));
});

test('rejects when post-trade concentration exceeds the limit', () => {
  const d = evaluateRisk(proposal(0.05), { volatility: 0.005, concentrationPct: 0.23, drawdownPct: 0 }, limits);
  assert.equal(d.decision, 'rejected');
  assert.ok(d.reasons.some((r) => r.includes('concentration')));
});

test('circuit breaker rejects when drawdown exceeds the limit', () => {
  const d = evaluateRisk(proposal(0.02), { volatility: 0.005, concentrationPct: 0, drawdownPct: 0.25 }, limits);
  assert.equal(d.decision, 'rejected');
  assert.ok(d.reasons.some((r) => r.includes('drawdown')));
});

test('oversized proposal is shrunk to maxPositionPct (not auto-rejected)', () => {
  const d = evaluateRisk(proposal(0.5), { volatility: 0.001, concentrationPct: 0, drawdownPct: 0 }, limits);
  assert.equal(d.decision, 'approved');
  assert.equal(d.adjustedSizePct, limits.maxPositionPct);
});

test('close orders always approve', () => {
  const d = evaluateRisk(proposal(0.9, 'close'), { volatility: 0.9, concentrationPct: 0.9, drawdownPct: 0.9 }, limits);
  assert.equal(d.decision, 'approved');
});

test('kellySize caps and floors correctly', () => {
  assert.equal(kellySize(0.4, 1), 0); // no edge → 0
  assert.ok(kellySize(0.9, 2) <= 0.1); // capped
});

test('realizedVolatility is 0 for a flat series', () => {
  const flat = [100, 100, 100, 100].map((c, i) => ({ timestamp: i, open: c, high: c, low: c, close: c, volume: 1 }));
  assert.equal(realizedVolatility(flat), 0);
});
