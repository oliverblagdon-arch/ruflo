// portfolio.mjs — mean-variance portfolio weights.
//
// Reuses the ruflo-neural-trader Conjugate-Gradient solver (sublinear-adapter)
// rather than reimplementing one. The adapter dispatches to the native
// mcp__ruflo-sublinear__solve tool when available and transparently falls back
// to its embedded local CG kernel otherwise — so this runs with no MCP server.
//
// Mean-variance: solve Σ·x = μ for raw weights, then normalize to sum to 1.

import { sublinearAdapter } from '../../ruflo-neural-trader/src/sublinear-adapter.mjs';

/**
 * @typedef {object} PortfolioWeights
 * @property {number[]} weights normalized weights (sum ≈ 1)
 * @property {number[]} raw raw solution before normalization
 * @property {number} iterations CG iterations executed
 * @property {number} residual final solver residual
 * @property {string} method solver method tag ('cg-local' | 'cg-sublinear-native')
 * @property {string} solver solver identifier
 * @property {boolean} [degraded] true if the solver rejected the inputs
 * @property {string} [reason] degradation reason
 */

/**
 * Optimize portfolio weights via mean-variance (Σ·x = μ).
 *
 * @param {number[]} expectedReturns μ — expected return per asset
 * @param {number[][]} covariance Σ — symmetric positive-definite covariance
 * @param {object} [opts]
 * @param {number} [opts.tolerance=1e-6]
 * @param {number} [opts.maxIterations=200]
 * @returns {Promise<PortfolioWeights>}
 */
export async function optimizeWeights(expectedReturns, covariance, opts = {}) {
  const result = await sublinearAdapter.solveCG(covariance, expectedReturns, {
    tolerance: opts.tolerance ?? 1e-6,
    maxIterations: opts.maxIterations ?? 200,
  });

  if (result.degraded) {
    return {
      weights: [],
      raw: [],
      iterations: result.iterations,
      residual: result.residual,
      method: result.method,
      solver: result.solver,
      degraded: true,
      reason: result.reason,
    };
  }

  const raw = result.solution;
  const sum = raw.reduce((s, w) => s + w, 0);
  const weights = sum === 0 ? raw.map(() => 0) : raw.map((w) => w / sum);

  return {
    weights,
    raw,
    iterations: result.iterations,
    residual: result.residual,
    method: result.method,
    solver: result.solver,
  };
}
