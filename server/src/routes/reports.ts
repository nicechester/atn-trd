import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { getDatabase } from '../db/index.js';
import { getSynthesisLlm } from '../llm/rateLimitedLlm.js';
import { logger } from '../lib/logger.js';

interface ReportRow {
  id: string;
  period_start: string;
  period_end: string;
  title: string;
  content: string;
  tokens_used: number | null;
  created_at: number;
}

export async function listReportsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const db = getDatabase();
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const rows = db.prepare(`
      SELECT id, period_start, period_end, title, tokens_used, created_at
      FROM reports ORDER BY created_at DESC LIMIT ?
    `).all(limit) as Omit<ReportRow, 'content'>[];

    res.json({
      ok: true,
      data: rows.map(r => ({
        id: r.id,
        periodStart: r.period_start,
        periodEnd: r.period_end,
        title: r.title,
        tokensUsed: r.tokens_used,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
}

export async function getReportHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const db = getDatabase();
    const row = db.prepare(`SELECT * FROM reports WHERE id = ?`).get(req.params.id) as ReportRow | undefined;

    if (!row) {
      res.status(404).json({ ok: false, error: 'Report not found' });
      return;
    }

    res.json({
      ok: true,
      data: {
        id: row.id,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        title: row.title,
        content: row.content,
        tokensUsed: row.tokens_used,
        createdAt: row.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function generateReportHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { periodDays = 14 } = req.body;
    const db = getDatabase();

    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - periodDays * 24 * 60 * 60 * 1000);
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    const startTs = Math.floor(startDate.getTime() / 1000);

    logger.info('generating report', { periodDays, startDate: startDateStr, endDate: endDateStr });

    // Gather data from various sources
    const data = gatherReportData(db, startTs, startDateStr, endDateStr);

    // Build prompt
    const prompt = buildReportPrompt(data, startDateStr, endDateStr);

    // Call LLM
    const llm = getSynthesisLlm();
    const response = await llm.invoke(prompt);
    const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

    const tokensUsed = response.usage_metadata?.total_tokens ?? null;

    // Generate title
    const title = `Portfolio Report: ${startDateStr} to ${endDateStr}`;

    // Save report
    const id = randomUUID();
    db.prepare(`
      INSERT INTO reports (id, period_start, period_end, title, content, tokens_used)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, startDateStr, endDateStr, title, content, tokensUsed);

    logger.info('report generated', { id, tokensUsed });

    res.json({
      ok: true,
      data: {
        id,
        periodStart: startDateStr,
        periodEnd: endDateStr,
        title,
        content,
        tokensUsed,
        createdAt: Math.floor(Date.now() / 1000),
      },
    });
  } catch (err) {
    next(err);
  }
}

interface ReportData {
  portfolioSnapshots: Array<{ asOfDate: string; totalValueCents: number; cashCents: number }>;
  signalSnapshots: Array<{ symbol: string; snapshotDate: string; compositeScore: number | null; sentimentScore: number | null }>;
  plans: Array<{ symbol: string; direction: string; status: string; targetShares: number; executedShares: number; createdAt: number }>;
  tranches: Array<{ symbol: string; trancheNumber: number; shares: number; priceCents: number; orderStatus: string }>;
  regimeHistory: Array<{ asOfDate: string; regime: string; riskScore: number }>;
  jobStats: { total: number; succeeded: number; failed: number; byType: Record<string, number> };
  positions: Array<{ symbol: string; qty: number; avgCostCents: number; sector: string | null }>;
  sectorExposure: Array<{ sector: string; valueCents: number; percent: number }>;
}

function gatherReportData(db: any, startTs: number, startDateStr: string, endDateStr: string): ReportData {
  // Portfolio snapshots
  const portfolioSnapshots = db.prepare(`
    SELECT as_of_date, total_value_cents, cash_cents
    FROM portfolio_snapshots
    WHERE as_of_date >= ? AND as_of_date <= ?
    ORDER BY as_of_date
  `).all(startDateStr, endDateStr) as Array<{ as_of_date: string; total_value_cents: number; cash_cents: number }>;

  // Signal snapshots (latest per symbol per day, limited)
  const signalSnapshots = db.prepare(`
    SELECT symbol, snapshot_date, composite_score, sentiment_score
    FROM signal_snapshots
    WHERE snapshot_date >= ? AND snapshot_date <= ?
    ORDER BY snapshot_date DESC
    LIMIT 200
  `).all(startDateStr, endDateStr) as Array<{ symbol: string; snapshot_date: string; composite_score: number | null; sentiment_score: number | null }>;

  // Strategic plans created in period
  const plans = db.prepare(`
    SELECT symbol, direction, status, target_shares, executed_shares, created_at
    FROM strategic_plans
    WHERE created_at >= ?
    ORDER BY created_at DESC
  `).all(startTs) as Array<{ symbol: string; direction: string; status: string; target_shares: number; executed_shares: number; created_at: number }>;

  // Plan tranches executed in period
  const tranches = db.prepare(`
    SELECT p.symbol, t.tranche_number, t.shares, t.price_cents, t.order_status
    FROM plan_tranches t
    JOIN strategic_plans p ON t.plan_id = p.id
    WHERE t.executed_at >= ?
    ORDER BY t.executed_at DESC
  `).all(startTs) as Array<{ symbol: string; tranche_number: number; shares: number; price_cents: number; order_status: string }>;

  // Market regime history
  const regimeHistory = db.prepare(`
    SELECT as_of_date, regime, risk_score
    FROM market_regime
    WHERE as_of_date >= ? AND as_of_date <= ?
    ORDER BY as_of_date
  `).all(startDateStr, endDateStr) as Array<{ as_of_date: string; regime: string; risk_score: number }>;

  // Job statistics
  const jobRows = db.prepare(`
    SELECT trigger, status, COUNT(*) as cnt
    FROM agent_runs
    WHERE started_at >= ?
    GROUP BY trigger, status
  `).all(startTs) as Array<{ trigger: string; status: string; cnt: number }>;

  const jobStats = { total: 0, succeeded: 0, failed: 0, byType: {} as Record<string, number> };
  for (const row of jobRows) {
    jobStats.total += row.cnt;
    if (row.status === 'succeeded') jobStats.succeeded += row.cnt;
    if (row.status === 'failed') jobStats.failed += row.cnt;
    jobStats.byType[row.trigger] = (jobStats.byType[row.trigger] || 0) + row.cnt;
  }

  // Current positions with sector
  const positions = db.prepare(`
    SELECT p.symbol, p.qty, p.avg_cost_cents, sc.sector
    FROM positions p
    LEFT JOIN symbol_categories sc ON p.symbol = sc.symbol
    WHERE p.qty > 0
  `).all() as Array<{ symbol: string; qty: number; avg_cost_cents: number; sector: string | null }>;

  // Calculate sector exposure
  const latestPrices = db.prepare(`
    SELECT symbol, adj_close_cents FROM prices
    WHERE (symbol, bar_date) IN (
      SELECT symbol, MAX(bar_date) FROM prices GROUP BY symbol
    )
  `).all() as Array<{ symbol: string; adj_close_cents: number }>;
  const priceMap = new Map(latestPrices.map(p => [p.symbol, p.adj_close_cents]));

  const sectorValues = new Map<string, number>();
  let totalPositionValue = 0;
  for (const pos of positions) {
    const price = priceMap.get(pos.symbol) ?? pos.avg_cost_cents;
    const value = pos.qty * price;
    totalPositionValue += value;
    const sector = pos.sector ?? 'Unknown';
    sectorValues.set(sector, (sectorValues.get(sector) ?? 0) + value);
  }

  const sectorExposure = Array.from(sectorValues.entries())
    .map(([sector, valueCents]) => ({
      sector,
      valueCents,
      percent: totalPositionValue > 0 ? valueCents / totalPositionValue : 0,
    }))
    .sort((a, b) => b.percent - a.percent);

  return {
    portfolioSnapshots: portfolioSnapshots.map(r => ({ asOfDate: r.as_of_date, totalValueCents: r.total_value_cents, cashCents: r.cash_cents })),
    signalSnapshots: signalSnapshots.map(r => ({ symbol: r.symbol, snapshotDate: r.snapshot_date, compositeScore: r.composite_score, sentimentScore: r.sentiment_score })),
    plans: plans.map(r => ({ symbol: r.symbol, direction: r.direction, status: r.status, targetShares: r.target_shares, executedShares: r.executed_shares, createdAt: r.created_at })),
    tranches: tranches.map(r => ({ symbol: r.symbol, trancheNumber: r.tranche_number, shares: r.shares, priceCents: r.price_cents, orderStatus: r.order_status })),
    regimeHistory: regimeHistory.map(r => ({ asOfDate: r.as_of_date, regime: r.regime, riskScore: r.risk_score })),
    jobStats,
    positions: positions.map(r => ({ symbol: r.symbol, qty: r.qty, avgCostCents: r.avg_cost_cents, sector: r.sector })),
    sectorExposure,
  };
}

function buildReportPrompt(data: ReportData, startDate: string, endDate: string): string {
  const { portfolioSnapshots, signalSnapshots, plans, tranches, regimeHistory, jobStats, positions, sectorExposure } = data;

  // Calculate portfolio performance
  let portfolioPerf = 'No portfolio data available.';
  if (portfolioSnapshots.length >= 2) {
    const first = portfolioSnapshots[0];
    const last = portfolioSnapshots[portfolioSnapshots.length - 1];
    const returnPct = ((last.totalValueCents - first.totalValueCents) / first.totalValueCents * 100).toFixed(2);
    portfolioPerf = `Starting value: $${(first.totalValueCents / 100).toLocaleString()}, Ending value: $${(last.totalValueCents / 100).toLocaleString()}, Return: ${returnPct}%`;
  }

  // Summarize signals by symbol
  const signalsBySymbol = new Map<string, { scores: number[]; latest: number | null }>();
  for (const s of signalSnapshots) {
    if (s.compositeScore !== null) {
      if (!signalsBySymbol.has(s.symbol)) signalsBySymbol.set(s.symbol, { scores: [], latest: null });
      const entry = signalsBySymbol.get(s.symbol)!;
      entry.scores.push(s.compositeScore);
      if (entry.latest === null) entry.latest = s.compositeScore;
    }
  }
  const signalSummary = Array.from(signalsBySymbol.entries())
    .map(([sym, { scores, latest }]) => {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      return `${sym}: avg=${avg.toFixed(2)}, latest=${latest?.toFixed(2)}, samples=${scores.length}`;
    })
    .join('\n');

  // Regime summary
  const regimeCounts = { RISK_ON: 0, RISK_OFF: 0, NEUTRAL: 0 };
  for (const r of regimeHistory) {
    if (r.regime in regimeCounts) regimeCounts[r.regime as keyof typeof regimeCounts]++;
  }
  const regimeSummary = `RISK_ON: ${regimeCounts.RISK_ON} days, RISK_OFF: ${regimeCounts.RISK_OFF} days, NEUTRAL: ${regimeCounts.NEUTRAL} days`;

  // Plans summary
  const plansSummary = plans.length > 0
    ? plans.map(p => `${p.symbol} ${p.direction} (${p.status}): ${p.executedShares}/${p.targetShares} shares`).join('\n')
    : 'No plans created in this period.';

  // Tranches summary
  const tranchesSummary = tranches.length > 0
    ? `${tranches.length} tranches executed across ${new Set(tranches.map(t => t.symbol)).size} symbols`
    : 'No tranches executed.';

  // Positions summary
  const positionsSummary = positions.length > 0
    ? positions.map(p => `${p.symbol} (${p.sector ?? 'Unknown'}): ${p.qty} shares @ $${(p.avgCostCents / 100).toFixed(2)} avg`).join('\n')
    : 'No positions.';

  // Sector exposure summary
  const sectorSummary = sectorExposure.length > 0
    ? sectorExposure.map(s => `${s.sector}: ${(s.percent * 100).toFixed(1)}% ($${(s.valueCents / 100).toLocaleString()})`).join('\n')
    : 'No sector data.';

  return `You are a financial analyst assistant. Generate a comprehensive portfolio report for the period ${startDate} to ${endDate}.

## Data Summary

### Portfolio Performance
${portfolioPerf}

### Current Positions
${positionsSummary}

### Sector Exposure
${sectorSummary}

### Signal Trends (Composite Scores by Symbol)
${signalSummary || 'No signal data available.'}

### Market Regime
${regimeSummary}
${regimeHistory.length > 0 ? `Latest regime: ${regimeHistory[regimeHistory.length - 1].regime}` : ''}

### Strategic Plans
${plansSummary}

### Tranche Execution
${tranchesSummary}

### Job Statistics
Total jobs: ${jobStats.total}, Succeeded: ${jobStats.succeeded}, Failed: ${jobStats.failed}
By type: ${Object.entries(jobStats.byType).map(([k, v]) => `${k}: ${v}`).join(', ')}

## Instructions

Write a professional investment report with the following sections:
1. **Executive Summary** - Key highlights and overall assessment
2. **Portfolio Performance** - Analysis of returns and value changes
3. **Signal Analysis** - Notable sentiment trends and score changes
4. **Market Regime** - Impact of regime on strategy
5. **Plan Execution** - Summary of strategic plans and their progress
6. **Observations & Recommendations** - Key insights and suggested actions

Keep the report concise but insightful. Use specific numbers from the data. Format in Markdown.`;
}
