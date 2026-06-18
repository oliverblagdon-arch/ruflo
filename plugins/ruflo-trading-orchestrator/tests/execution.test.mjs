import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaperBroker, RiskGateError } from '../src/execution.mjs';

function proposal(signalId = 'sig-1', side = 'long', sizePct = 0.05) {
  return {
    type: 'signal-proposal/v1',
    from: 'trading-strategist',
    signalId,
    timestamp: new Date().toISOString(),
    symbol: 'AAPL',
    side,
    strategyId: 'momentum',
    sizePct,
    confidence: 0.7,
  };
}

function decision(signalId, decision, adjustedSizePct) {
  return {
    type: 'risk-decision/v1',
    from: 'risk-analyst',
    signalId,
    timestamp: new Date().toISOString(),
    decision,
    reasons: decision === 'rejected' ? ['VaR breach'] : [],
    ...(adjustedSizePct !== undefined ? { adjustedSizePct } : {}),
  };
}

test('fail-closed: refuses with no decision', () => {
  const b = new PaperBroker();
  assert.throws(() => b.execute(proposal(), null, 100), RiskGateError);
  assert.equal(b.trades.length, 0);
});

test('fail-closed: refuses a rejected decision', () => {
  const b = new PaperBroker();
  assert.throws(() => b.execute(proposal('s1'), decision('s1', 'rejected'), 100), RiskGateError);
});

test('fail-closed: refuses a decision for a different signalId', () => {
  const b = new PaperBroker();
  assert.throws(() => b.execute(proposal('s1'), decision('s2', 'approved'), 100), RiskGateError);
});

test('executes an approved, matching proposal and updates cash', () => {
  const b = new PaperBroker({ cashUsd: 100_000 });
  const trade = b.execute(proposal('s1', 'long', 0.05), decision('s1', 'approved'), 100);
  assert.equal(trade.signalId, 's1');
  assert.ok(trade.qty > 0);
  assert.ok(b.cashUsd < 100_000); // spent cash buying
  assert.equal(b.getPositions().length, 1);
});

test('short fills produce a negative position and increase cash', () => {
  const b = new PaperBroker({ cashUsd: 100_000 });
  const trade = b.execute(proposal('s1', 'short', 0.05), decision('s1', 'approved'), 100);
  assert.ok(trade.qty < 0);
  assert.ok(b.cashUsd > 100_000); // received cash shorting
});

test('honors risk-analyst adjustedSizePct', () => {
  const b = new PaperBroker({ cashUsd: 100_000 });
  const full = new PaperBroker({ cashUsd: 100_000 });
  b.execute(proposal('s1', 'long', 0.5), decision('s1', 'approved', 0.1), 100);
  full.execute(proposal('s2', 'long', 0.1), decision('s2', 'approved'), 100);
  // shrunk-from-0.5-to-0.1 should match an original-0.1 proposal
  assert.ok(Math.abs(b.trades[0].qty - full.trades[0].qty) < 1e-6);
});

test('equityAt marks positions to market', () => {
  const b = new PaperBroker({ cashUsd: 100_000 });
  b.execute(proposal('s1', 'long', 0.1), decision('s1', 'approved'), 100);
  const up = b.equityAt({ AAPL: 110 });
  const flat = b.equityAt({ AAPL: 100 });
  assert.ok(up > flat); // long gains when price rises
});
