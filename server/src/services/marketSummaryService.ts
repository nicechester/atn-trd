/**
 * Market Summary HTML Generator
 *
 * Generates a static HTML file (data/market-summary.html) with:
 * - Current regime, streak, VIX, yield curve (from regime detection)
 * - Top bullish/bearish symbols by composite score (from signal collection)
 * - Recent headlines
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import type Database from 'better-sqlite3';
import { MarketRegimeRepo, type Regime } from '../repos/marketRegimeRepo.js';
import { SignalSnapshotsRepo } from '../repos/signalSnapshotsRepo.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'market-summary' });

export interface MarketSummaryData {
  regime: Regime;
  streak: number;
  vix: number | null;
  yieldCurve: number | null;
  topBullish: Array<{ symbol: string; score: number }>;
  topBearish: Array<{ symbol: string; score: number }>;
  sentiments: Array<{ text: string; symbol: string }>;
  updatedAt: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function generateHtml(data: MarketSummaryData): string {
  const bullishList = data.topBullish.length > 0
    ? data.topBullish.map(s => `<span class="badge green">${s.symbol}</span> ${s.score.toFixed(2)}`).join(' &nbsp; ')
    : '<span class="muted">None</span>';

  const bearishList = data.topBearish.length > 0
    ? data.topBearish.map(s => `<span class="badge red">${s.symbol}</span> ${s.score.toFixed(2)}`).join(' &nbsp; ')
    : '<span class="muted">None</span>';

  const sentimentsHtml = data.sentiments.length > 0
    ? data.sentiments.map(h => `<li><strong>${h.symbol}</strong>: ${escapeHtml(h.text)}</li>`).join('\n      ')
    : '<li class="muted">No recent sentiments</li>';

  const vixStr = data.vix !== null ? data.vix.toFixed(1) : 'N/A';
  const yieldStr = data.yieldCurve !== null ? `${data.yieldCurve.toFixed(2)}%` : 'N/A';
  const regimeColor = data.regime === 'RISK_ON' ? '#4ade80' : data.regime === 'RISK_OFF' ? '#f87171' : '#fbbf24';

  return `<!DOCTYPE html>
<html>
<head>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #1e293b;
      background: transparent;
      padding: 4px 0;
    }
    .section { margin-bottom: 16px; }
    .section:last-child { margin-bottom: 0; }
    .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; margin-bottom: 4px; }
    .regime { font-size: 15px; font-weight: 600; }
    .regime-value { color: ${regimeColor}; }
    .stats { color: #475569; font-size: 13px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 12px; font-weight: 600; }
    .badge.green { background: rgba(74, 222, 128, 0.15); color: #4ade80; }
    .badge.red { background: rgba(248, 113, 113, 0.15); color: #f87171; }
    .muted { color: #94a3b8; }
    ul { margin: 0; padding-left: 20px; }
    li { margin-bottom: 4px; color: #334155; font-size: 13px; }
    .footer { font-size: 11px; color: #94a3b8; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="section">
    <div class="label">Market Regime</div>
    <div class="regime"><span class="regime-value">${data.regime}</span> <span class="stats">Day ${data.streak} · VIX ${vixStr} · Yield ${yieldStr}</span></div>
  </div>

  <div class="section">
    <div class="label">Top Bullish</div>
    <div>${bullishList}</div>
  </div>

  <div class="section">
    <div class="label">Top Bearish</div>
    <div>${bearishList}</div>
  </div>

  <div class="section">
    <div class="label">Market Sentiments</div>
    <ul>
      ${sentimentsHtml}
    </ul>
  </div>

  <div class="footer">Updated: ${data.updatedAt}</div>
</body>
</html>
`;
}

export function writeMarketSummary(db: Database.Database, dataDir: string): void {
  try {
    const marketRegimeRepo = new MarketRegimeRepo(db);
    const signalSnapshotsRepo = new SignalSnapshotsRepo(db);

    // Get regime data
    const latestRegime = marketRegimeRepo.getLatest();
    const regime: Regime = latestRegime?.regime ?? 'RISK_ON';
    const streak = latestRegime ? marketRegimeRepo.getRegimeStreak(regime) : 0;
    const vix = latestRegime?.vixLevel ?? null;
    const yieldCurve = latestRegime?.yieldCurveSpread ?? null;

    // Get today's signal snapshots
    const today = new Date().toISOString().split('T')[0];
    const snapshots = signalSnapshotsRepo.listByDate(today);

    // Sort by composite score
    const withScores = snapshots
      .filter(s => s.compositeScore !== null)
      .map(s => ({ symbol: s.symbol, score: s.compositeScore! }));

    withScores.sort((a, b) => b.score - a.score);

    const topBullish = withScores.filter(s => s.score >= 0.5).slice(0, 5);
    const topBearish = withScores.filter(s => s.score < 0.5).slice(-5).reverse();

    // Get sentiments from sentiment synthesis
    const sentiments: Array<{ text: string; symbol: string }> = [];
    for (const snap of snapshots) {
      if (snap.sentimentSynthesis) {
        // Take first sentence, remove "Market sentiment for X is" prefix
        let text = snap.sentimentSynthesis.split('.')[0];
        text = text.replace(/^Market sentiment for \w+ is /i, '');
        if (text.length > 10) {
          sentiments.push({ text, symbol: snap.symbol });
        }
      }
    }

    const now = new Date();
    const updatedAt = `${now.toISOString().split('T')[0]} ${now.toTimeString().slice(0, 5)} ET`;

    const data: MarketSummaryData = {
      regime,
      streak,
      vix,
      yieldCurve,
      topBullish,
      topBearish,
      sentiments: sentiments.slice(0, 5),
      updatedAt,
    };

    const html = generateHtml(data);
    const outputPath = join(dataDir, 'market-summary.html');

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, html, 'utf-8');

    log.info('market summary written', { path: outputPath });
  } catch (err) {
    log.error('failed to write market summary', { error: err instanceof Error ? err.message : String(err) });
  }
}
