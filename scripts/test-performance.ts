#!/usr/bin/env npx ts-node
/**
 * Test script to fetch Alpaca portfolio history and compute performance metrics
 */

const ALPACA_API_KEY = process.env.ALPACA_API_KEY || 'PK4HXIZ7XXWCMXVDFYNVMZGDLR';
const ALPACA_API_SECRET = process.env.ALPACA_API_SECRET || '7devb2aqpa6pyvbhmeDcjKEfXYivFCooYj2BAhR17ZRL';

interface AlpacaPortfolioHistory {
  timestamp: number[];
  equity: number[];
  profit_loss: number[];
  profit_loss_pct: number[];
  base_value: number;
  timeframe: string;
}

async function fetchAlpacaHistory(): Promise<AlpacaPortfolioHistory> {
  const res = await fetch(
    'https://paper-api.alpaca.markets/v2/account/portfolio/history?period=3M&timeframe=1D',
    {
      headers: {
        'APCA-API-KEY-ID': ALPACA_API_KEY,
        'APCA-API-SECRET-KEY': ALPACA_API_SECRET,
      },
    }
  );
  if (!res.ok) throw new Error(`Alpaca API error: ${res.status}`);
  return res.json();
}

async function fetchSPYHistory(timestamps: number[]): Promise<Map<string, number>> {
  // Get SPY bars for the same period
  const startDate = new Date(timestamps[0] * 1000).toISOString().split('T')[0];
  
  const map = new Map<string, number>();
  let pageToken: string | null = null;
  
  do {
    const url = new URL('https://data.alpaca.markets/v2/stocks/SPY/bars');
    url.searchParams.set('timeframe', '1Day');
    url.searchParams.set('start', startDate);
    url.searchParams.set('limit', '1000');
    if (pageToken) url.searchParams.set('page_token', pageToken);
    
    const res = await fetch(url.toString(), {
      headers: {
        'APCA-API-KEY-ID': ALPACA_API_KEY,
        'APCA-API-SECRET-KEY': ALPACA_API_SECRET,
      },
    });
    if (!res.ok) throw new Error(`Alpaca bars API error: ${res.status}`);
    const data = await res.json();
    
    for (const bar of data.bars || []) {
      const date = bar.t.split('T')[0];
      map.set(date, bar.c); // close price
    }
    pageToken = data.next_page_token || null;
  } while (pageToken);
  
  return map;
}

function calculateDrawdown(values: number[]): number {
  let maxDrawdown = 0;
  let peak = values[0];
  for (const v of values) {
    if (v > peak) peak = v;
    const dd = (peak - v) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  return maxDrawdown;
}

async function main() {
  console.log('Fetching Alpaca portfolio history...\n');
  
  const history = await fetchAlpacaHistory();
  
  // Filter out zero-equity days (before account was funded)
  const validIndices = history.equity
    .map((e, i) => ({ e, i }))
    .filter(x => x.e > 0)
    .map(x => x.i);
  
  if (validIndices.length === 0) {
    console.log('No valid equity data found');
    return;
  }
  
  const firstValidIdx = validIndices[0];
  const timestamps = history.timestamp.slice(firstValidIdx);
  const equity = history.equity.slice(firstValidIdx);
  const baseValue = equity[0]; // First non-zero equity as base
  
  console.log('Fetching SPY benchmark data...\n');
  const spyPrices = await fetchSPYHistory(timestamps);
  
  // Build series
  const series: Array<{ date: string; strategyReturn: number; benchmarkReturn: number }> = [];
  const strategyValues: number[] = [];
  const benchmarkValues: number[] = [];
  
  let initialSPY: number | null = null;
  
  for (let i = 0; i < timestamps.length; i++) {
    const date = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
    const spyPrice = spyPrices.get(date);
    
    if (!spyPrice) continue;
    if (initialSPY === null) initialSPY = spyPrice;
    
    const strategyReturn = (equity[i] - baseValue) / baseValue;
    const benchmarkReturn = (spyPrice - initialSPY) / initialSPY;
    
    series.push({ date, strategyReturn, benchmarkReturn });
    strategyValues.push(equity[i]);
    benchmarkValues.push(spyPrice);
  }
  
  const totalStrategyReturn = (equity[equity.length - 1] - baseValue) / baseValue;
  const totalBenchmarkReturn = initialSPY ? (benchmarkValues[benchmarkValues.length - 1] - initialSPY) / initialSPY : 0;
  const strategyMaxDrawdown = calculateDrawdown(strategyValues);
  const benchmarkMaxDrawdown = calculateDrawdown(benchmarkValues);
  
  console.log('=== Performance Metrics ===\n');
  console.log(`Base Value:          $${baseValue.toFixed(2)}`);
  console.log(`Current Value:       $${equity[equity.length - 1].toFixed(2)}`);
  console.log(`Strategy Return:     ${(totalStrategyReturn * 100).toFixed(2)}%`);
  console.log(`SPY Return:          ${(totalBenchmarkReturn * 100).toFixed(2)}%`);
  console.log(`Strategy Max DD:     ${(strategyMaxDrawdown * 100).toFixed(2)}%`);
  console.log(`SPY Max DD:          ${(benchmarkMaxDrawdown * 100).toFixed(2)}%`);
  console.log(`Trading Days:        ${series.length}`);
  console.log(`\nFirst date: ${series[0]?.date}`);
  console.log(`Last date:  ${series[series.length - 1]?.date}`);
  
  // Show first/last few data points
  console.log('\n=== Sample Series (first 3, last 3) ===\n');
  const sample = [...series.slice(0, 3), { date: '...', strategyReturn: 0, benchmarkReturn: 0 }, ...series.slice(-3)];
  console.table(sample.map(s => ({
    date: s.date,
    strategy: s.date === '...' ? '...' : `${(s.strategyReturn * 100).toFixed(2)}%`,
    benchmark: s.date === '...' ? '...' : `${(s.benchmarkReturn * 100).toFixed(2)}%`,
  })));
}

main().catch(console.error);
