import { randomUUID } from 'crypto';
import type { Decision, DecisionSet, Order } from '@atn-trd/shared';
import { notionalCents, toCents, floorQty, ceilQty } from '../lib/money.js';
import { logger } from '../lib/logger.js';
import type { Portfolio } from './portfolioService.js';

const log = logger.child({ component: 'risk-service' });

/**
 * Interface for fetching live prices.
 */
export interface RiskPriceFeed {
  getPrice(symbol: string): Promise<number | null>;
}

/**
 * Risk guardrails for order sizing and filtering.
 */
export interface RiskConstraints {
  maxPositionWeightPercent: number;
  maxConcurrentPositions: number;
  maxNewPositionsPerRun: number;
  minCashReservePercent: number;
  maxOrderNotionalCents: number;
  minConfidenceThreshold: number;
  symbolBlocklist: string[];
  maxVolatility: number;
  broker: 'paper' | 'live';
}

/**
 * Details of sizing computation for debugging and logging.
 */
export interface SizingDetails {
  targetWeightDecimal: number;
  targetNotionalCents: number;
  currentNotionalCents: number;
  deltaNotionalCents: number;
  priceCents: number;
  rawQty: number;
  finalQty: number;
  cappedByWeight: boolean;
  cappedByNotional: boolean;
  cappedByCash: boolean;
  cappedByPosition: boolean;
}

/**
 * Order proposal with sizing details for audit trail.
 */
export interface OrderProposal {
  order: Omit<Order, 'id'>;
  sizingDetails: SizingDetails;
}

/**
 * Rejection of a decision due to guardrails or risk checks.
 */
export interface Rejection {
  decisionId?: string;
  symbol: string;
  action: Decision['action'];
  confidence: number;
  targetWeight?: number;
  reason: string;
}

/**
 * Input to the risk evaluation service.
 */
export interface RiskServiceInput {
  decisionSet: DecisionSet;
  portfolio: Portfolio;
  runId: string;
  earningsBlackoutSymbols?: Set<string>;
  volatilityBySymbol?: Map<string, number | null>;
}

/**
 * Output: accepted orders and rejections.
 */
export interface RiskServiceOutput {
  orders: OrderProposal[];
  rejections: Rejection[];
}

/**
 * Risk service interface.
 */
export interface RiskService {
  evaluate(input: RiskServiceInput): Promise<RiskServiceOutput>;
}

/**
 * Create a risk service instance.
 */
export function createRiskService(
  constraints: RiskConstraints,
  priceFeed: RiskPriceFeed
): RiskService {
  return new RiskServiceImpl(constraints, priceFeed);
}

class RiskServiceImpl implements RiskService {
  constructor(
    private readonly constraints: RiskConstraints,
    private readonly priceFeed: RiskPriceFeed
  ) {}

  async evaluate(input: RiskServiceInput): Promise<RiskServiceOutput> {
    const { decisionSet, portfolio, runId, earningsBlackoutSymbols, volatilityBySymbol } = input;

    // Early guard: zero portfolio
    if (portfolio.totalValueCents === 0) {
      const rejections: Rejection[] = decisionSet.decisions
        .filter((d) => d.action !== 'hold')
        .map((d) => ({
          decisionId: d.id,
          symbol: d.symbol,
          action: d.action,
          confidence: d.confidence,
          targetWeight: d.targetWeight,
          reason: 'portfolio has zero total value',
        }));

      log.warn('rejecting all decisions: portfolio has zero value', {
        runId,
        rejectionCount: rejections.length,
      });

      return { orders: [], rejections };
    }

    // Sort decisions: sell/trim first, then buy/add (by confidence desc), then hold
    const sortedDecisions = this.sortDecisions(decisionSet.decisions);

    const orders: OrderProposal[] = [];
    const rejections: Rejection[] = [];

    let simulatedCashCents = portfolio.cashCents;
    let newPositionsThisRun = 0;

    // Process each decision
    for (const decision of sortedDecisions) {
      if (decision.action === 'hold') {
        continue; // Skip holds silently
      }

      // Phase 1: Pre-price checks
      const prepriceRejection = this.checkPrepriceGuardrails(
        decision,
        portfolio,
        earningsBlackoutSymbols,
        newPositionsThisRun,
        volatilityBySymbol
      );

      if (prepriceRejection) {
        rejections.push(prepriceRejection);
        log.debug('decision rejected in prephase checks', {
          symbol: decision.symbol,
          reason: prepriceRejection.reason,
        });
        continue;
      }

      // Phase 2: Fetch price
      const priceCents = await this.fetchPrice(decision.symbol);
      if (priceCents === null) {
        const rejection: Rejection = {
          decisionId: decision.id,
          symbol: decision.symbol,
          action: decision.action,
          confidence: decision.confidence,
          targetWeight: decision.targetWeight,
          reason: 'price unavailable for symbol',
        };
        rejections.push(rejection);
        log.debug('decision rejected: price unavailable', { symbol: decision.symbol });
        continue;
      }

      if (priceCents <= 0) {
        const rejection: Rejection = {
          decisionId: decision.id,
          symbol: decision.symbol,
          action: decision.action,
          confidence: decision.confidence,
          targetWeight: decision.targetWeight,
          reason: 'price is invalid (zero or negative)',
        };
        rejections.push(rejection);
        log.debug('decision rejected: invalid price', { symbol: decision.symbol, priceCents });
        continue;
      }

      // Phase 3: Sizing and post-sizing checks
      const currentPosition = portfolio.positions.find((p) => p.symbol === decision.symbol);
      const currentQty = currentPosition?.qty ?? 0;
      const currentNotionalCents = currentPosition?.marketValueCents ?? 0;

      const { qty, sizingDetails, rejection } = this.computeQtyWithGuardrails(
        decision,
        priceCents,
        portfolio.totalValueCents,
        currentQty,
        currentNotionalCents,
        simulatedCashCents
      );

      if (rejection) {
        rejections.push(rejection);
        log.debug('decision rejected in sizing/guardrails', {
          symbol: decision.symbol,
          reason: rejection.reason,
        });
        continue;
      }

      // Order accepted: build OrderProposal
      const side = decision.action === 'sell' || decision.action === 'trim' ? 'sell' : 'buy';

      const order: Omit<Order, 'id'> = {
        clientOrderId: randomUUID(),
        decisionId: decision.id,
        runId,
        broker: this.constraints.broker,
        symbol: decision.symbol,
        side,
        qty,
        type: 'market',
        tif: 'day',
        status: 'pending',
      };

      const orderProposal: OrderProposal = { order, sizingDetails };
      orders.push(orderProposal);

      // Log accepted order
      const orderNotionalCents = notionalCents(qty, priceCents);
      log.debug('order accepted', {
        symbol: decision.symbol,
        side,
        qty,
        priceCents,
        notionalCents: orderNotionalCents,
      });

      // Update simulated cash for buys/adds
      if (side === 'buy') {
        simulatedCashCents -= orderNotionalCents;
      } else {
        simulatedCashCents += orderNotionalCents;
      }

      // Track new positions
      if ((decision.action === 'buy' || (decision.action === 'add' && !currentPosition)) &&
          !portfolio.positions.find((p) => p.symbol === decision.symbol)) {
        newPositionsThisRun++;
      }
    }

    log.info('risk evaluation completed', {
      runId,
      orderCount: orders.length,
      rejectionCount: rejections.length,
      newPositionsOpened: newPositionsThisRun,
    });

    return { orders, rejections };
  }

  /**
   * Sort decisions: sell/trim first, then buy/add (by confidence desc), then hold.
   */
  private sortDecisions(decisions: Decision[]): Decision[] {
    const sells = decisions.filter((d) => d.action === 'sell' || d.action === 'trim');
    const buys = decisions
      .filter((d) => d.action === 'buy' || d.action === 'add')
      .sort((a, b) => b.confidence - a.confidence);
    const holds = decisions.filter((d) => d.action === 'hold');

    return [...sells, ...buys, ...holds];
  }

  /**
   * Check all pre-price guardrails (checks 1-9).
   */
  private checkPrepriceGuardrails(
    decision: Decision,
    portfolio: Portfolio,
    earningsBlackoutSymbols: Set<string> | undefined,
    newPositionsThisRun: number,
    volatilityBySymbol: Map<string, number | null> | undefined
  ): Rejection | null {
    // Check 1: Blocklist
    if (this.constraints.symbolBlocklist.some((s) => s.toUpperCase() === decision.symbol.toUpperCase())) {
      return {
        decisionId: decision.id,
        symbol: decision.symbol,
        action: decision.action,
        confidence: decision.confidence,
        targetWeight: decision.targetWeight,
        reason: 'symbol is on the blocklist',
      };
    }

    // Check 2: Confidence threshold
    if (decision.confidence < this.constraints.minConfidenceThreshold) {
      return {
        decisionId: decision.id,
        symbol: decision.symbol,
        action: decision.action,
        confidence: decision.confidence,
        targetWeight: decision.targetWeight,
        reason: `confidence ${decision.confidence.toFixed(2)} below threshold ${this.constraints.minConfidenceThreshold.toFixed(2)}`,
      };
    }

    // Check 3: Earnings blackout
    if (earningsBlackoutSymbols?.has(decision.symbol)) {
      return {
        decisionId: decision.id,
        symbol: decision.symbol,
        action: decision.action,
        confidence: decision.confidence,
        targetWeight: decision.targetWeight,
        reason: 'symbol is in earnings blackout window',
      };
    }

    // Check 4: Volatility limit (buys/adds only; exits fail open on missing data)
    if ((decision.action === 'buy' || decision.action === 'add') && volatilityBySymbol) {
      const symbolVolatility = volatilityBySymbol.get(decision.symbol);
      if (symbolVolatility !== null && symbolVolatility !== undefined && symbolVolatility > this.constraints.maxVolatility) {
        return {
          decisionId: decision.id,
          symbol: decision.symbol,
          action: decision.action,
          confidence: decision.confidence,
          targetWeight: decision.targetWeight,
          reason: `volatility ${symbolVolatility.toFixed(4)} exceeds max ${this.constraints.maxVolatility.toFixed(4)}`,
        };
      }
    }

    // Check 5: No position to sell
    const currentPosition = portfolio.positions.find((p) => p.symbol === decision.symbol);
    if ((decision.action === 'sell' || decision.action === 'trim') && !currentPosition) {
      return {
        decisionId: decision.id,
        symbol: decision.symbol,
        action: decision.action,
        confidence: decision.confidence,
        targetWeight: decision.targetWeight,
        reason: 'no position to sell',
      };
    }

    // Check 6: Buy/add missing targetWeight
    if ((decision.action === 'buy' || decision.action === 'add') && decision.targetWeight === undefined) {
      return {
        decisionId: decision.id,
        symbol: decision.symbol,
        action: decision.action,
        confidence: decision.confidence,
        targetWeight: decision.targetWeight,
        reason: 'buy/add decision missing targetWeight',
      };
    }

    // Check 7: Trim missing targetWeight
    if (decision.action === 'trim' && decision.targetWeight === undefined) {
      return {
        decisionId: decision.id,
        symbol: decision.symbol,
        action: decision.action,
        confidence: decision.confidence,
        targetWeight: decision.targetWeight,
        reason: 'trim decision missing targetWeight',
      };
    }

    // Check 8: Max concurrent positions
    const isNewPosition =
      (decision.action === 'buy' || (decision.action === 'add' && !currentPosition)) &&
      !portfolio.positions.find((p) => p.symbol === decision.symbol);

    if (
      isNewPosition &&
      portfolio.positions.length + newPositionsThisRun >= this.constraints.maxConcurrentPositions
    ) {
      return {
        decisionId: decision.id,
        symbol: decision.symbol,
        action: decision.action,
        confidence: decision.confidence,
        targetWeight: decision.targetWeight,
        reason: `would exceed max concurrent positions (${this.constraints.maxConcurrentPositions})`,
      };
    }

    // Check 9: Max new positions per run
    if (isNewPosition && newPositionsThisRun >= this.constraints.maxNewPositionsPerRun) {
      return {
        decisionId: decision.id,
        symbol: decision.symbol,
        action: decision.action,
        confidence: decision.confidence,
        targetWeight: decision.targetWeight,
        reason: `would exceed max new positions per run (${this.constraints.maxNewPositionsPerRun})`,
      };
    }

    return null;
  }

  /**
   * Fetch price from price feed, converting to cents.
   */
  private async fetchPrice(symbol: string): Promise<number | null> {
    const price = await this.priceFeed.getPrice(symbol);
    if (price === null || price === undefined) {
      return null;
    }
    return toCents(price);
  }

  /**
   * Compute order qty with all guardrails and return sizing details.
   * Returns { qty, sizingDetails, rejection }.
   */
  private computeQtyWithGuardrails(
    decision: Decision,
    priceCents: number,
    totalValueCents: number,
    currentQty: number,
    currentNotionalCents: number,
    simulatedCashCents: number
  ): {
    qty: number;
    sizingDetails: SizingDetails;
    rejection: Rejection | null;
  } {
    let qty = 0;
    let targetNotionalCents = 0;
    let deltaNotionalCents = 0;
    let rawQty = 0;
    let cappedByWeight = false;
    let cappedByNotional = false;
    let cappedByCash = false;
    let cappedByPosition = false;

    // Compute initial qty based on action
    if (decision.action === 'buy' || decision.action === 'add') {
      const targetWeight = decision.targetWeight!; // Already validated in prephase
      targetNotionalCents = Math.round(targetWeight * totalValueCents);
      deltaNotionalCents = targetNotionalCents - currentNotionalCents;
      rawQty = deltaNotionalCents / priceCents;
      qty = floorQty(rawQty);
    } else if (decision.action === 'sell') {
      qty = currentQty;
      targetNotionalCents = 0;
      deltaNotionalCents = currentNotionalCents;
      rawQty = qty;
    } else if (decision.action === 'trim') {
      const targetWeight = decision.targetWeight!; // Already validated in prephase
      targetNotionalCents = Math.round(targetWeight * totalValueCents);
      deltaNotionalCents = currentNotionalCents - targetNotionalCents;
      rawQty = deltaNotionalCents / priceCents;
      qty = ceilQty(rawQty);

      // No-shorting cap for trim
      qty = Math.min(qty, currentQty);
      if (qty < ceilQty(rawQty)) {
        cappedByPosition = true;
      }
    }

    // No-shorting cap for sell
    if (decision.action === 'sell') {
      qty = Math.min(qty, currentQty);
      if (qty < currentQty) {
        cappedByPosition = true;
      }
    }

    const targetWeightDecimal = decision.targetWeight ?? 0;
    const finalQty = qty;

    // Check 11: Zero qty
    if (qty <= 0) {
      const rejection: Rejection = {
        decisionId: decision.id,
        symbol: decision.symbol,
        action: decision.action,
        confidence: decision.confidence,
        targetWeight: decision.targetWeight,
        reason: 'computed order qty is zero after sizing',
      };

      const sizingDetails: SizingDetails = {
        targetWeightDecimal,
        targetNotionalCents,
        currentNotionalCents,
        deltaNotionalCents,
        priceCents,
        rawQty,
        finalQty,
        cappedByWeight,
        cappedByNotional,
        cappedByCash,
        cappedByPosition,
      };

      return { qty: 0, sizingDetails, rejection };
    }

    // Check 12: Max position weight (buys/adds only)
    if (decision.action === 'buy' || decision.action === 'add') {
      const maxAllowedNotionalCents = Math.floor(
        (this.constraints.maxPositionWeightPercent / 100) * totalValueCents
      );
      const projectedNotionalCents = currentNotionalCents + qty * priceCents;

      if (projectedNotionalCents > maxAllowedNotionalCents) {
        const cappedQty = floorQty((maxAllowedNotionalCents - currentNotionalCents) / priceCents);

        if (cappedQty <= 0) {
          const rejection: Rejection = {
            decisionId: decision.id,
            symbol: decision.symbol,
            action: decision.action,
            confidence: decision.confidence,
            targetWeight: decision.targetWeight,
            reason: `position already at or above max weight (${this.constraints.maxPositionWeightPercent}%)`,
          };

          const sizingDetails: SizingDetails = {
            targetWeightDecimal,
            targetNotionalCents,
            currentNotionalCents,
            deltaNotionalCents,
            priceCents,
            rawQty,
            finalQty: qty,
            cappedByWeight: true,
            cappedByNotional,
            cappedByCash,
            cappedByPosition,
          };

          return { qty: 0, sizingDetails, rejection };
        }

        qty = cappedQty;
        cappedByWeight = true;
      }
    }

    // Check 13: Max order notional (all sides)
    const orderNotionalCents = qty * priceCents;
    if (orderNotionalCents > this.constraints.maxOrderNotionalCents) {
      const cappedQty = floorQty(this.constraints.maxOrderNotionalCents / priceCents);

      if (cappedQty <= 0) {
        const rejection: Rejection = {
          decisionId: decision.id,
          symbol: decision.symbol,
          action: decision.action,
          confidence: decision.confidence,
          targetWeight: decision.targetWeight,
          reason: 'order notional exceeds limit and qty is zero after cap',
        };

        const sizingDetails: SizingDetails = {
          targetWeightDecimal,
          targetNotionalCents,
          currentNotionalCents,
          deltaNotionalCents,
          priceCents,
          rawQty,
          finalQty: qty,
          cappedByWeight,
          cappedByNotional: true,
          cappedByCash,
          cappedByPosition,
        };

        return { qty: 0, sizingDetails, rejection };
      }

      qty = cappedQty;
      cappedByNotional = true;
    }

    // Check 14: Cash reserve (buys/adds only)
    if (decision.action === 'buy' || decision.action === 'add') {
      const requiredReserveCents = Math.ceil((this.constraints.minCashReservePercent / 100) * totalValueCents);
      const availableCashCents = simulatedCashCents - requiredReserveCents;
      const orderNotionalCents2 = qty * priceCents;

      if (orderNotionalCents2 > availableCashCents) {
        const cappedQty = floorQty(availableCashCents / priceCents);

        if (cappedQty <= 0) {
          const rejection: Rejection = {
            decisionId: decision.id,
            symbol: decision.symbol,
            action: decision.action,
            confidence: decision.confidence,
            targetWeight: decision.targetWeight,
            reason: 'insufficient cash after reserve requirement',
          };

          const sizingDetails: SizingDetails = {
            targetWeightDecimal,
            targetNotionalCents,
            currentNotionalCents,
            deltaNotionalCents,
            priceCents,
            rawQty,
            finalQty: qty,
            cappedByWeight,
            cappedByNotional,
            cappedByCash: true,
            cappedByPosition,
          };

          return { qty: 0, sizingDetails, rejection };
        }

        qty = cappedQty;
        cappedByCash = true;
      }
    }

    // Final check: zero qty after all caps
    if (qty <= 0) {
      const rejection: Rejection = {
        decisionId: decision.id,
        symbol: decision.symbol,
        action: decision.action,
        confidence: decision.confidence,
        targetWeight: decision.targetWeight,
        reason: 'computed order qty is zero after sizing',
      };

      const sizingDetails: SizingDetails = {
        targetWeightDecimal,
        targetNotionalCents,
        currentNotionalCents,
        deltaNotionalCents,
        priceCents,
        rawQty,
        finalQty: qty,
        cappedByWeight,
        cappedByNotional,
        cappedByCash,
        cappedByPosition,
      };

      return { qty: 0, sizingDetails, rejection };
    }

    // Success: return qty with sizing details
    const sizingDetails: SizingDetails = {
      targetWeightDecimal,
      targetNotionalCents,
      currentNotionalCents,
      deltaNotionalCents,
      priceCents,
      rawQty,
      finalQty: qty,
      cappedByWeight,
      cappedByNotional,
      cappedByCash,
      cappedByPosition,
    };

    return { qty, sizingDetails, rejection: null };
  }
}
