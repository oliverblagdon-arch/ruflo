import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimizeWeights } from '../src/portfolio.mjs';

test('optimizeWeights solves a 2x2 SPD system and normalizes weights', async () => {
  // A = [[2,0],[0,4]], b = [2,4] ⇒ x = [1,1] ⇒ normalized [0.5,0.5]
  const res = await optimizeWeights([2, 4], [[2, 0], [0, 4]]);
  assert.equal(res.degraded, undefined);
  assert.ok(Math.abs(res.raw[0] - 1) < 1e-6);
  assert.ok(Math.abs(res.raw[1] - 1) < 1e-6);
  assert.ok(Math.abs(res.weights[0] - 0.5) < 1e-6);
  assert.ok(Math.abs(res.weights[1] - 0.5) < 1e-6);
});

test('weights sum to ~1 for a 3-asset SPD covariance', async () => {
  const cov = [
    [0.04, 0.01, 0.004],
    [0.01, 0.09, 0.002],
    [0.004, 0.002, 0.02],
  ];
  const res = await optimizeWeights([0.08, 0.12, 0.05], cov);
  const sum = res.weights.reduce((s, w) => s + w, 0);
  assert.ok(Math.abs(sum - 1) < 1e-6, `weights sum ${sum}`);
  assert.ok(res.residual < 1e-3);
});

test('reuses the ruflo-neural-trader CG solver (local fallback when no MCP)', async () => {
  const res = await optimizeWeights([1, 1], [[1, 0], [0, 1]]);
  assert.equal(res.solver, 'local-js-cg');
  assert.equal(res.method, 'cg-local');
});

test('non-symmetric input is reported as degraded (not silently wrong)', async () => {
  const res = await optimizeWeights([1, 1], [[1, 2], [0, 1]]);
  assert.equal(res.degraded, true);
  assert.deepEqual(res.weights, []);
});
