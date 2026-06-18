# ruflo-trading-orchestrator

An **AI trading orchestration layer** that ties the repo's two trading plugins
into one end-to-end pipeline. It does **not** reimplement trading logic — it
reuses the existing substrate and wires the stages together:

```
ingest (ruflo-market-data contract)
  → normalize OHLCV
  → classify regime        (RegimeVerdict)
  → strategy signal         (SignalProposal)
  → risk gate               (RiskDecision)        ◄── BLOCKING / fail-closed
  → paper execution         (PaperBroker)
  → backtest                (BacktestResult)  ──→ optional signed artifact
```

## What it reuses (not reinvented)

| Capability | Reused from | How |
|---|---|---|
| Portfolio optimization (mean-variance, Σ·x = μ) | `ruflo-neural-trader/src/sublinear-adapter.mjs` | `optimizeWeights()` calls `sublinearAdapter.solveCG()` (native MCP solver when present, embedded local CG fallback otherwise) |
| Tamper-evident backtests | `ruflo-neural-trader/src/signed-artifact.mjs` | `signBacktest()` calls `signBacktestArtifact()` (Ed25519, CWE-347-safe verify) |
| Pipeline message contracts | `ruflo-neural-trader/src/pipeline-messages.ts` | `RegimeVerdict` / `SignalProposal` / `RiskDecision` are produced & consumed verbatim |
| OHLCV normalization contract | `ruflo-market-data` (ADR-0001) | `normalizeCandles()` implements the documented 5-dim formulas (that plugin ships no importable code) |

### Namespaces

This layer is namespace-compatible with the existing plugins and does **not**
invent parallel ones. Persisted artifacts belong in the canonical namespaces:
`market-data` / `market-patterns` (ingestion, from `ruflo-market-data`) and
`trading-strategies`, `trading-signals`, `trading-risk`, `trading-backtests`,
`trading-analysis`, `trading-portfolio` (from `ruflo-neural-trader`).

## Run it (zero config, no network, no MCP server)

```bash
cd plugins/ruflo-trading-orchestrator

node examples/end-to-end.mjs      # full pipeline demo on mock data
node --test tests/*.test.mjs      # unit tests (Node built-in runner)
bash scripts/smoke.sh             # structural + runtime contract
```

The example needs no API keys and no install: market data is mocked, and the
reused CG solver falls back to its local kernel.

## Layout

- `src/types.ts` — the typed contract (TypeScript interfaces; source of truth).
- `src/*.mjs` — zero-compile ES-module runtime (runs directly under `node`),
  matching the `.ts`-types + `.mjs`-runtime convention `ruflo-neural-trader` uses.
- `examples/end-to-end.mjs` — runnable demonstration of every stage.
- `tests/*.test.mjs` — `node --test` suites (no test framework dependency).
- `scripts/smoke.sh` — plugin smoke contract.

## Notes

- **Paper only.** Execution is simulated (`PaperBroker`). The fail-closed gate
  mirrors the neural-trader structural invariant: `PaperBroker.execute()` throws
  a `RiskGateError` unless given an `approved` `RiskDecision` whose `signalId`
  matches the proposal. A real provider/broker can be dropped in behind the
  `MarketDataProvider` interface later.
- **Cross-plugin imports.** Runtime modules import `ruflo-neural-trader/src/*.mjs`
  by relative path; both plugins live under `plugins/`.
- **Optional signing.** `signBacktest()` only signs when given a witness key, and
  the `@noble/ed25519` dependency is imported lazily by the neural-trader signer —
  so the default path has no extra dependency. To enable signing, make
  `@noble/ed25519` resolvable by `ruflo-neural-trader` (e.g. installed at the
  repo root) and pass a 32-byte hex key (`RUFLO_DEMO_WITNESS_KEY` in the example).
