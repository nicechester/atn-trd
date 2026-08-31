/**
 * Market open fill job: fill accepted orders at market open price.
 *
 * Runs at 9:30 AM ET to fill orders submitted after previous market close.
 * Uses live quote for today's open price.
 */

import type Database from 'better-sqlite3';
import { OrdersRepo } from '../../repos/ordersRepo.js';
import { FillsRepo } from '../../repos/fillsRepo.js';
import { PositionsRepo, type PositionRow } from '../../repos/positionsRepo.js';
import { PortfolioRepo } from '../../repos/portfolioRepo.js';
import { PricesRepo } from '../../repos/pricesRepo.js';
import { nextTradingDateStr, toETDateStr, isMarketHours, isTradingDay } from '../marketCalendar.js';
import { notionalCents } from '../../lib/money.js';
import { logger } from '../../lib/logger.js';
import { resolveApiKey } from '../../datasources/apiKeys.js';

const log = logger.child({ component: 'market-open-fill' });

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 20_000;

/** Fetch today's open price from Finnhub quote endpoint with exponential backoff */
async function fetchTodayOpenCents(symbol: string): Promise<number | null> {
  const apiKey = resolveApiKey('FINNHUB_API_KEY');
  if (!apiKey) {
    log.warn('FINNHUB_API_KEY not set, cannot fetch live quote');
    return null;
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`);
      if (!res.ok) {
        // Retry on 5xx or 429
        if (res.status >= 500 || res.status === 429) {
          const delay = BASE_DELAY_MS * 2 ** attempt;
          log.warn('Finnhub quote request failed, retrying', { symbol, status: res.status, attempt: attempt + 1, delayMs: delay });
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        log.warn('Finnhub quote request failed', { symbol, status: res.status });
        return null;
      }
      const data = await res.json() as { o?: number };
      if (typeof data.o !== 'number' || data.o <= 0) {
        log.warn('Invalid open price from Finnhub', { symbol, data });
        return null;
      }
      return Math.round(data.o * 100);
    } catch (err) {
      const delay = BASE_DELAY_MS * 2 ** attempt;
      log.warn('Finnhub quote fetch error, retrying', { symbol, attempt: attempt + 1, delayMs: delay, error: err instanceof Error ? err.message : String(err) });
      await new Promise(r => setTimeout(r, delay));
    }
  }

  log.warn('Finnhub quote fetch failed after retries', { symbol, maxRetries: MAX_RETRIES });
  return null;
}

export async function runMarketOpenFillJob(
  db: Database.Database,
  config: { slippageBps: number } = { slippageBps: 5 }
): Promise<{ filled: number; rejected: number; skipped: number }> {
  // Skip on holidays
  if (!isTradingDay(new Date())) {
    log.info('market open fill job skipped (not a trading day)');
    return { filled: 0, rejected: 0, skipped: 0 };
  }

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

    // Get open price: historical bar for past dates, live quote for today
    let openCents: number | null = null;
    
    if (settlementDateStr === todayStr) {
      // Today's settlement - need live quote since bar doesn't exist yet
      if (!isMarketHours(new Date())) {
        log.debug('market not open yet, skipping today settlement', { symbol: order.symbol });
        skipped++;
        continue;
      }
      openCents = await fetchTodayOpenCents(order.symbol);
    } else {
      // Past settlement - use historical bar
      const bar = pricesRepo.get(order.symbol, settlementDateStr);
      openCents = bar?.openCents ?? null;
    }

    if (!openCents) {
      log.warn('no price available for settlement', { orderId: order.id, symbol: order.symbol, settlementDateStr });
      skipped++;
      continue;
    }

    // Calculate fill price with slippage
    const slippageFraction = config.slippageBps / 10000;
    const fillPriceCents = order.side === 'buy'
      ? Math.round(openCents * (1 + slippageFraction))
      : Math.round(openCents * (1 - slippageFraction));

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

    log.info('market open fill executed', {
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      qty: order.qty,
      fillPriceCents,
      settlementDateStr,
    });
    filled++;
  }

  log.info('market open fill job complete', { filled, rejected, skipped });
  return { filled, rejected, skipped };
}
