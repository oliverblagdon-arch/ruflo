// execution.mjs — simulated (paper) execution with a FAIL-CLOSED risk gate.
//
// PaperBroker.execute mirrors the neural-trader structural invariant: the
// trading-strategist MUST NOT call the broker without a RiskDecision with
// `decision: 'approved'` matching the proposal's signalId. Here that invariant
// is enforced in code — execute() throws on a missing, rejected, or mismatched
// decision. No real broker or network is involved; fills are simulated.

/** Error thrown when the risk gate blocks an execution. */
export class RiskGateError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'RiskGateError';
  }
}

export class PaperBroker {
  /**
   * @param {object} [opts]
   * @param {number} [opts.cashUsd=100000] starting cash
   */
  constructor(opts = {}) {
    this.cashUsd = opts.cashUsd ?? 100_000;
    this.initialCash = this.cashUsd;
    /** @type {Map<string, import('./types.ts').Position>} */
    this.positions = new Map();
    /** @type {import('./types.ts').Trade[]} */
    this.trades = [];
  }

  /**
   * Execute a proposal at `price`, but ONLY if `decision` approves it.
   *
   * @param {import('./types.ts').SignalProposal} proposal
   * @param {import('./types.ts').RiskDecision | null | undefined} decision
   * @param {number} price fill price
   * @returns {import('./types.ts').Trade} the recorded fill
   * @throws {RiskGateError} if the gate does not approve this exact proposal
   */
  execute(proposal, decision, price) {
    // ---- FAIL-CLOSED GATE ------------------------------------------------
    if (!decision) {
      throw new RiskGateError(
        `PaperBroker: refusing to execute signalId=${proposal.signalId} — no risk-analyst RiskDecision present`,
      );
    }
    if (decision.signalId !== proposal.signalId) {
      throw new RiskGateError(
        `PaperBroker: refusing to execute signalId=${proposal.signalId} — RiskDecision is for a different signalId=${decision.signalId}`,
      );
    }
    if (decision.decision !== 'approved') {
      throw new RiskGateError(
        `PaperBroker: refusing to execute signalId=${proposal.signalId} — RiskDecision is '${decision.decision}' (${decision.reasons.join('; ')})`,
      );
    }
    // ---------------------------------------------------------------------

    if (!(price > 0)) {
      throw new Error(`PaperBroker.execute: price must be > 0 (got ${price})`);
    }

    // Risk-analyst may have shrunk the size.
    const sizePct = decision.adjustedSizePct ?? proposal.sizePct;
    const notional = this.equityAt({ [proposal.symbol]: price }) * sizePct;
    const signedQty =
      proposal.side === 'short' ? -(notional / price) : notional / price;

    this.applyFill(proposal.symbol, signedQty, price);

    /** @type {import('./types.ts').Trade} */
    const trade = {
      timestamp: Date.parse(proposal.timestamp) || Date.now(),
      symbol: proposal.symbol,
      side: proposal.side,
      qty: signedQty,
      price,
      signalId: proposal.signalId,
    };
    this.trades.push(trade);
    return trade;
  }

  /**
   * Apply a fill to cash + positions (average-price accounting).
   * @param {string} symbol
   * @param {number} signedQty
   * @param {number} price
   */
  applyFill(symbol, signedQty, price) {
    this.cashUsd -= signedQty * price;
    const existing = this.positions.get(symbol);
    if (!existing) {
      this.positions.set(symbol, { symbol, qty: signedQty, avgPrice: price });
      return;
    }
    const newQty = existing.qty + signedQty;
    if (newQty === 0) {
      this.positions.delete(symbol);
      return;
    }
    // Weighted average price only when adding in the same direction.
    const sameDirection = Math.sign(existing.qty) === Math.sign(signedQty);
    existing.avgPrice = sameDirection
      ? (existing.avgPrice * existing.qty + price * signedQty) / newQty
      : existing.avgPrice;
    existing.qty = newQty;
  }

  /**
   * Mark-to-market equity given a price map.
   * @param {Record<string, number>} prices symbol → current price
   * @returns {number}
   */
  equityAt(prices) {
    let equity = this.cashUsd;
    for (const pos of this.positions.values()) {
      const px = prices[pos.symbol] ?? pos.avgPrice;
      equity += pos.qty * px;
    }
    return equity;
  }

  /** @returns {import('./types.ts').Position[]} */
  getPositions() {
    return [...this.positions.values()];
  }
}
