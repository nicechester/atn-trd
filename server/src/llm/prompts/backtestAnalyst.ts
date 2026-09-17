export const BACKTEST_ANALYST_SYSTEM_PROMPT = `You are a quantitative trading strategist analyzing backtest results.

Your task is to analyze the performance of a trading strategy and recommend parameter adjustments to improve results.

**Analysis Framework:**

1. **Performance Summary**
   - Compare strategy return vs benchmark (SPY)
   - Assess risk-adjusted returns (Sharpe, Sortino ratios)
   - Evaluate drawdown severity and recovery

2. **Trade Analysis**
   - Review win rate and average win/loss
   - Identify patterns in winning vs losing trades
   - Assess if the strategy is over-trading or under-trading

3. **Per-Symbol Attribution**
   - Which symbols contributed most to gains/losses?
   - Were there symbols that should have been avoided?

4. **Settings Evaluation**
   - Are the signal weights appropriate given the results?
   - Are buy/sell thresholds too aggressive or conservative?
   - Is position sizing (max positions, max weight) optimal?

5. **Recommendations**
   - Suggest specific parameter changes with rationale
   - Prioritize changes by expected impact
   - Consider trade-offs (e.g., higher returns vs more volatility)

**Output Format:**

Provide your analysis in clear sections with specific, actionable recommendations. Include concrete numbers when suggesting parameter changes (e.g., "increase buyThreshold from 0.7 to 0.75").

**IMPORTANT:** Do NOT use markdown tables. Use bullet lists instead for any tabular data. Tables do not render correctly in the UI.

**Parameter Constraints (recommendations MUST stay within these bounds):**
- buyThreshold: 0.50 to 0.95
- sellThreshold: 0.10 to 0.60
- pauseThreshold: 0.40 to 0.80
- cancelThreshold: 0.30 to 0.60
- Signal weights (ALL 5 must be specified, must sum to 1.0, use increments of 0.05):
  - sentiment: 0 to 1
  - sentimentTrend: 0 to 1
  - priceMomentum: 0 to 1
  - options: 0 to 1
  - fundamentals: 0 to 1
- Threshold ordering: buyThreshold > pauseThreshold > cancelThreshold`;

export function buildBacktestAnalysisPrompt(data: {
  metrics: {
    totalReturn: number;
    benchmarkReturn: number;
    sharpeRatio: number | null;
    sortinoRatio: number | null;
    maxDrawdown: number;
    winRate: number | null;
    totalTrades: number;
  };
  settings: {
    signals?: {
      weights?: Record<string, number>;
      buyThreshold?: number;
      sellThreshold?: number;
    };
    risk?: {
      maxConcurrentPositions?: number;
      maxPositionWeightPercent?: number;
    };
  };
  trades: Array<{ date: string; symbol: string; side: string; price: number }>;
  perSymbol: Record<string, { return: number | null; trades: number }> | null;
  dateRange: { start: string; end: string };
}): string {
  const { metrics, settings, trades, perSymbol, dateRange } = data;

  const fmt = (v: number | null) => v !== null ? (v * 100).toFixed(2) + '%' : 'N/A';
  const fmtNum = (v: number | null) => v !== null ? v.toFixed(2) : 'N/A';

  let prompt = `## Backtest Results Analysis Request

**Period:** ${dateRange.start} to ${dateRange.end}

### Performance Metrics
- Total Return: ${fmt(metrics.totalReturn)}
- Benchmark (SPY) Return: ${fmt(metrics.benchmarkReturn)}
- Alpha: ${fmt(metrics.totalReturn - metrics.benchmarkReturn)}
- Max Drawdown: ${fmt(metrics.maxDrawdown)}
- Sharpe Ratio: ${fmtNum(metrics.sharpeRatio)}
- Sortino Ratio: ${fmtNum(metrics.sortinoRatio)}
- Win Rate: ${fmt(metrics.winRate)}
- Total Trades: ${metrics.totalTrades}

### Strategy Settings Used
`;

  if (settings.signals?.weights) {
    prompt += `**Signal Weights (all 5 must sum to 1.0):**\n`;
    const weightOrder = ['sentiment', 'sentimentTrend', 'priceMomentum', 'options', 'fundamentals'];
    for (const key of weightOrder) {
      const val = settings.signals.weights[key] ?? 0;
      prompt += `- ${key}: ${(val * 100).toFixed(0)}%\n`;
    }
  }

  prompt += `
**Thresholds:**
- Buy Threshold: ${settings.signals?.buyThreshold ?? 'N/A'}
- Sell Threshold: ${settings.signals?.sellThreshold ?? 'N/A'}

**Risk Limits:**
- Max Concurrent Positions: ${settings.risk?.maxConcurrentPositions ?? 'N/A'}
- Max Position Weight: ${settings.risk?.maxPositionWeightPercent ?? 'N/A'}%
`;

  if (perSymbol && Object.keys(perSymbol).length > 0) {
    prompt += `\n### Per-Symbol Attribution\n`;
    const sorted = Object.entries(perSymbol)
      .filter(([sym]) => sym !== 'SPY')
      .sort((a, b) => (b[1].return ?? -999) - (a[1].return ?? -999));
    
    for (const [symbol, data] of sorted) {
      prompt += `- ${symbol}: ${data.return !== null ? fmt(data.return) : 'N/A'} (${data.trades} trades)\n`;
    }
  }

  if (trades.length > 0) {
    prompt += `\n### Trade Summary\n`;
    const buys = trades.filter(t => t.side === 'buy').length;
    const sells = trades.filter(t => t.side === 'sell').length;
    prompt += `- Buy orders: ${buys}\n`;
    prompt += `- Sell orders: ${sells}\n`;
    
    // First and last trade dates
    const sortedTrades = [...trades].sort((a, b) => a.date.localeCompare(b.date));
    prompt += `- First trade: ${sortedTrades[0].date}\n`;
    prompt += `- Last trade: ${sortedTrades[sortedTrades.length - 1].date}\n`;
  }

  prompt += `
### Analysis Request

Please analyze these backtest results and provide:
1. A brief performance assessment (2-3 sentences)
2. Key observations about what worked and what didn't
3. Specific parameter recommendations to improve performance
4. Any warnings or caveats about the strategy

Focus on actionable insights. If the strategy outperformed the benchmark, suggest how to maintain that edge while reducing risk. If it underperformed, identify the likely causes and fixes.`;

  return prompt;
}
