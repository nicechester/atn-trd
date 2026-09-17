#!/usr/bin/env npx tsx
/**
 * Prefetch ALFRED vintage macro data from FRED API.
 * 
 * Fetches historical VIX and yield curve data for each trading day in the backtest range.
 * Stores in SQLite for fast point-in-time lookups during backtesting.
 * 
 * Usage:
 *   FRED_API_KEY=xxx npx tsx server/src/scripts/prefetchAlfred.ts
 * 
 * Options:
 *   --start-date  Start date (default: 2011-01-01, before FNSPID news data)
 *   --end-date    End date (default: 2023-12-31)
 *   --output      Output path (default: $BACKTEST_DATA_DIR/alfred/alfred.db)
 *   --series      Comma-separated series IDs (default: VIXCLS,T10Y2Y)
 */

import Database from 'better-sqlite3';
import { parseArgs } from 'node:util';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const FRED_BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';
const RATE_LIMIT_MS = 600; // ~100 req/min to stay under FRED's 120/min limit

interface Observation {
  date: string;
  value: number;
  realtimeStart: string;
  realtimeEnd: string;
}

async function fetchSeriesVintage(
  apiKey: string,
  seriesId: string,
  vintageDate: string
): Promise<Observation | null> {
  const url = new URL(FRED_BASE_URL);
  url.searchParams.set('series_id', seriesId);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('realtime_start', vintageDate);
  url.searchParams.set('realtime_end', vintageDate);
  url.searchParams.set('sort_order', 'desc');
  url.searchParams.set('limit', '1');

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`FRED API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as {
    observations?: Array<{
      date: string;
      value: string;
      realtime_start: string;
      realtime_end: string;
    }>;
  };

  const obs = data.observations?.[0];
  if (!obs || obs.value === '.' || obs.value === '') {
    return null;
  }

  const value = parseFloat(obs.value);
  if (!Number.isFinite(value)) {
    return null;
  }

  return {
    date: obs.date,
    value,
    realtimeStart: obs.realtime_start,
    realtimeEnd: obs.realtime_end,
  };
}

function generateTradingDays(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  const current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end) {
    const dayOfWeek = current.getDay();
    // Skip weekends (0 = Sunday, 6 = Saturday)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      days.push(current.toISOString().split('T')[0]);
    }
    current.setDate(current.getDate() + 1);
  }

  return days;
}

function initDatabase(dbPath: string): Database.Database {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS macro_vintage (
      series_id TEXT NOT NULL,
      vintage_date TEXT NOT NULL,
      observation_date TEXT NOT NULL,
      value REAL NOT NULL,
      realtime_start TEXT,
      realtime_end TEXT,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (series_id, vintage_date)
    );

    CREATE INDEX IF NOT EXISTS idx_macro_vintage_series_date 
    ON macro_vintage(series_id, vintage_date);
  `);

  return db;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const { values } = parseArgs({
    options: {
      'start-date': { type: 'string', default: '2011-01-01' },
      'end-date': { type: 'string', default: '2023-12-31' },
      'output': { type: 'string' },
      'series': { type: 'string', default: 'VIXCLS,T10Y2Y' },
      'resume': { type: 'boolean', default: false },
    },
  });

  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    console.error('Error: FRED_API_KEY environment variable required');
    console.error('Get a free key at: https://fred.stlouisfed.org/docs/api/api_key.html');
    process.exit(1);
  }

  const backtestDataDir = process.env.BACKTEST_DATA_DIR || '/Volumes/JetDrive/atn-trd';
  const outputPath = values.output || `${backtestDataDir}/alfred/alfred.db`;
  const seriesIds = values.series!.split(',').map(s => s.trim().toUpperCase());
  const startDate = values['start-date']!;
  const endDate = values['end-date']!;
  const resume = values.resume;

  console.log('ALFRED Vintage Data Prefetch');
  console.log('============================');
  console.log(`Series: ${seriesIds.join(', ')}`);
  console.log(`Date range: ${startDate} to ${endDate}`);
  console.log(`Output: ${outputPath}`);
  console.log(`Resume mode: ${resume}`);
  console.log('');

  const db = initDatabase(outputPath);

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO macro_vintage 
    (series_id, vintage_date, observation_date, value, realtime_start, realtime_end, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const checkStmt = db.prepare(`
    SELECT 1 FROM macro_vintage WHERE series_id = ? AND vintage_date = ?
  `);

  const tradingDays = generateTradingDays(startDate, endDate);
  const totalRequests = tradingDays.length * seriesIds.length;

  console.log(`Trading days: ${tradingDays.length}`);
  console.log(`Total requests: ${totalRequests}`);
  console.log(`Estimated time: ${Math.ceil(totalRequests * RATE_LIMIT_MS / 1000 / 60)} minutes`);
  console.log('');

  let completed = 0;
  let skipped = 0;
  let errors = 0;
  let nullValues = 0;

  for (const vintageDate of tradingDays) {
    for (const seriesId of seriesIds) {
      // Check if already fetched (resume mode)
      if (resume) {
        const existing = checkStmt.get(seriesId, vintageDate);
        if (existing) {
          skipped++;
          completed++;
          continue;
        }
      }

      try {
        const obs = await fetchSeriesVintage(apiKey, seriesId, vintageDate);

        if (obs) {
          insertStmt.run(
            seriesId,
            vintageDate,
            obs.date,
            obs.value,
            obs.realtimeStart,
            obs.realtimeEnd,
            Date.now()
          );
        } else {
          nullValues++;
        }

        completed++;

        // Progress update every 100 requests
        if (completed % 100 === 0) {
          const pct = ((completed / totalRequests) * 100).toFixed(1);
          console.log(`Progress: ${completed}/${totalRequests} (${pct}%) - ${seriesId} @ ${vintageDate}`);
        }

        // Rate limiting
        await sleep(RATE_LIMIT_MS);
      } catch (err) {
        errors++;
        console.error(`Error fetching ${seriesId} @ ${vintageDate}:`, err instanceof Error ? err.message : err);

        // Back off on errors
        await sleep(RATE_LIMIT_MS * 5);
      }
    }
  }

  db.close();

  console.log('');
  console.log('Complete!');
  console.log(`  Fetched: ${completed - skipped - nullValues}`);
  console.log(`  Skipped (resume): ${skipped}`);
  console.log(`  Null values: ${nullValues}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Output: ${outputPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
