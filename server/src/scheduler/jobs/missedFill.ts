/**
 * Hourly job: fill accepted orders that missed their market open.
 *
 * Scans for accepted orders whose settlement date has passed and fills them
 * at the historical open price.
 */

import type Database from 'better-sqlite3';
import { OrdersRepo } from '../../repos/ordersRepo.js';
import { FillsRepo } from '../../repos/fillsRepo.js';
import { PositionsRepo, type PositionRow } from '../../repos/positionsRepo.js';
import { PortfolioRepo } from '../../repos/portfolioRepo.js';
import { PricesRepo } from '../../repos/pricesRepo.js';
import { nextTradingDateStr, toETDateStr } from '../marketCalendar.js';
import { notionalCents } from '../../lib/money.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'missed-fill' });

export async function runMissedFillJob(
  db: Database.Database,
  config: { slippageBps: number } = { slippageBps: 5 }
): Promise<{ filled: number; rejected: number; skipped: number }> {
  const ordersRepo = new OrdersRepo(db);
  const fillsRepo = new FillsRepo(db);
  const positionsRepo = new PositionsRepo(db);
  const portfolioRepo = new PortfolioRepo(db);
  const pricesRepo = new PricesRepo(db);

  const accepted = ordersRepo.list({ status: ['accepted'] });
  const todayStr = toETDateStr(new Date());

  let filled = 0, rejected = 0, skipped = 0;

  for (const order of accepted) {
    // Settlement date = next trading day after submission
    const submittedDateStr = toETDateStr(new Date(order.submittedAt));
    const settlementDateStr = nextTradingDateStr(submittedDateStr);

    // Skip if settlement date is in the future (not yet fillable)
    if (settlementDateStr > todayStr) {
      skipped++;
      continue;
    }

    // Get historical bar for settlement date
    const bar = pricesRepo.get(order.symbol, settlementDateStr);
    if (!bar) {
      log.warn('no price bar for settlement date', { orderId: order.id, symbol: order.symbol, settlementDateStr });
      skipped++;
      continue;
    }

    // Calculate fill price with slippage
    const slippageFraction = config.slippageBps / 10000;
    const fillPriceCents = order.side === 'buy'
      ? Math.round(bar.openCents * (1 + slippageFraction))
      : Math.round(bar.openCents * (1 - slippageFraction));

    // Check limit price constraint
    if (order.type === 'limit' && order.limitPriceCents !== null) {
      if (order.side === 'buy' && fillPriceCents > order.limitPriceCents) {
        skipped++;
        continue;
      }
      if (order.side === 'sell' && fillPriceCents < order.limitPriceCents) {
        skipped++;
        continue;
      }
    }

    const portfolio = portfolioRepo.read();
    if (!portfolio) {
      log.warn('portfolio not initialized');
      break;
    }

    // Validate and execute fill
    if (order.side === 'buy') {
      const totalCost = notionalCents(order.qty, fillPriceCents);
      if (totalCost > portfolio.cashCents) {
        ordersRepo.updateStatus(order.id, 'rejected', undefined, 'Insufficient cash');
        rejected++;
        continue;
      }
    } else {
      const position = positionsRepo.get(order.symbol);
      if (!position || position.qty < order.qty) {
        ordersRepo.updateStatus(order.id, 'rejected', undefined, 'Insufficient shares');
        rejected++;
        continue;
      }
    }

    // Execute fill in transaction
    db.transaction(() => {
      const now = Date.now();
      const notional = notionalCents(order.qty, fillPriceCents);

      fillsRepo.create({
        orderId: order.id,
        qty: order.qty,
        priceCents: fillPriceCents,
        feeCents: 0,
        filledAt: now,
        barDate: settlementDateStr,
      });

      const newCashCents = order.side === 'buy'
        ? portfolio.cashCents - notional
        : portfolio.cashCents + notional;
      portfolioRepo.write({ ...portfolio, cashCents: newCashCents });

      // Update position
      const position = positionsRepo.get(order.symbol);
      let newPosition: PositionRow;

      if (!position) {
        newPosition = {
          symbol: order.symbol,
          qty: order.side === 'buy' ? order.qty : -order.qty,
          avgCostCents: fillPriceCents,
          realizedPnlCents: 0,
          openedAt: now,
          updatedAt: now,
        };
      } else {
        const newQty = order.side === 'buy' ? position.qty + order.qty : position.qty - order.qty;
        if (order.side === 'buy') {
          const newAvgCostCents = Math.round(
            (position.qty * position.avgCostCents + order.qty * fillPriceCents) / newQty
          );
          newPosition = { ...position, qty: newQty, avgCostCents: newAvgCostCents, updatedAt: now };
        } else {
          const pnl = notional - notionalCents(order.qty, position.avgCostCents);
          newPosition = {
            ...position,
            qty: newQty,
            avgCostCents: newQty !== 0 ? position.avgCostCents : 0,
            realizedPnlCents: position.realizedPnlCents + pnl,
            updatedAt: now,
          };
        }
      }

      positionsRepo.upsert(newPosition);
      ordersRepo.updateStatus(order.id, 'filled');
    })();

    log.info('startup fill executed', {
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      qty: order.qty,
      fillPriceCents,
      settlementDateStr,
    });
    filled++;
  }

  log.info('startup fill job complete', { filled, rejected, skipped });
  return { filled, rejected, skipped };
}
