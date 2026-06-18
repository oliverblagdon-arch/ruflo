#!/usr/bin/env bash
# Structural + runtime smoke contract for ruflo-trading-orchestrator.
# Follows the step/ok/bad convention used by the sibling ruflo-* plugins.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

step "1. plugin.json declares 0.1.0 with expected keywords"
v=$(grep -E '"version"' "$ROOT/.claude-plugin/plugin.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [[ "$v" != "0.1.0" ]]; then bad "expected 0.1.0, got '$v'"; else
  miss=""
  for k in trading orchestration risk-gate backtest namespace-routing; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. all runtime modules + type contract present"
miss=""
for f in types.ts market-data.mjs strategies.mjs risk.mjs execution.mjs portfolio.mjs backtest.mjs orchestrator.mjs index.mjs; do
  [[ -f "$ROOT/src/$f" ]] || miss="$miss src/$f"
done
[[ -f "$ROOT/examples/end-to-end.mjs" ]] || miss="$miss examples/end-to-end.mjs"
[[ -z "$miss" ]] && ok || bad "missing:$miss"

step "3. reuses ruflo-neural-trader CG solver (not reimplemented)"
grep -q "ruflo-neural-trader/src/sublinear-adapter.mjs" "$ROOT/src/portfolio.mjs" \
  && ok || bad "portfolio.mjs does not import the neural-trader sublinear-adapter"

step "4. reuses ruflo-neural-trader Ed25519 signer for backtest artifacts"
grep -q "ruflo-neural-trader/src/signed-artifact.mjs" "$ROOT/src/backtest.mjs" \
  && ok || bad "backtest.mjs does not import the neural-trader signed-artifact signer"

step "5. consumes the neural-trader pipeline-message contracts (types)"
grep -q "ruflo-neural-trader/src/pipeline-messages.ts" "$ROOT/src/types.ts" \
  && ok || bad "types.ts does not re-export the pipeline-message contracts"

step "6. execution is FAIL-CLOSED (refuses unless RiskDecision approved)"
F="$ROOT/src/execution.mjs"
if grep -q "RiskGateError" "$F" \
   && grep -q "decision.decision !== 'approved'" "$F" \
   && grep -q "decision.signalId !== proposal.signalId" "$F"; then
  ok
else
  bad "fail-closed gate checks missing in execution.mjs"
fi

step "7. references the canonical trading-* namespaces (no parallel ones)"
grep -q "trading-" "$ROOT/README.md" && grep -q "market-data" "$ROOT/README.md" \
  && ok || bad "README does not document the canonical namespaces"

step "8. test suite passes (node --test)"
if (cd "$ROOT" && node --test tests/*.test.mjs) >/tmp/orch-test.log 2>&1; then
  ok
else
  bad "tests failed — see /tmp/orch-test.log"
fi

step "9. end-to-end example runs clean"
if (cd "$ROOT" && node examples/end-to-end.mjs) >/tmp/orch-example.log 2>&1 \
   && grep -q "end-to-end demo complete" /tmp/orch-example.log; then
  ok
else
  bad "example failed — see /tmp/orch-example.log"
fi

step "10. example demonstrates both an approved and a blocked trade"
if grep -q "approved" /tmp/orch-example.log 2>/dev/null \
   && grep -q "execution correctly BLOCKED" /tmp/orch-example.log 2>/dev/null; then
  ok
else
  bad "example did not show both approve + fail-closed reject"
fi

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
