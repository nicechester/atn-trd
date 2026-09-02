import { useEffect, useState } from 'react';
import { api, Portfolio, StrategicPlan, EnhancedWatchlistRow } from '../api/client';
import { useToast } from '../context/ToastContext';
import { centsToUSD } from '../lib/format';
import styles from './Income.module.css';

interface IncomeProjection {
  currentAnnualCents: number;
  projectedAnnualCents: number;
  projectionYears: { year: number; incomeCents: number }[];
}

function calculateProjection(
  portfolio: Portfolio,
  watchlist: EnhancedWatchlistRow[],
  plans: StrategicPlan[],
  targetYear: number,
  growthRate: number
): IncomeProjection {
  // Calculate current annual dividend income from positions
  const yieldMap = new Map(watchlist.map(w => [w.symbol, w.yieldPercent ?? 0]));
  
  let currentAnnualCents = 0;
  for (const pos of portfolio.positions) {
    const yieldPct = yieldMap.get(pos.symbol) ?? 0;
    currentAnnualCents += Math.round(pos.marketValueCents * (yieldPct / 100));
  }

  // Calculate projected income if all plans complete
  let additionalIncomeCents = 0;
  for (const plan of plans) {
    if (plan.status !== 'ACTIVE' && plan.status !== 'PAUSED') continue;
    const remainingShares = plan.targetShares - plan.executedShares;
    if (remainingShares <= 0) continue;
    
    const yieldPct = yieldMap.get(plan.symbol) ?? 0;
    // Estimate price from budget or use $100 as default
    const estPriceCents = plan.targetBudgetCents 
      ? Math.round(plan.targetBudgetCents / plan.targetShares)
      : 10000;
    additionalIncomeCents += Math.round(remainingShares * estPriceCents * (yieldPct / 100));
  }

  const projectedAnnualCents = currentAnnualCents + additionalIncomeCents;

  // Generate projection curve
  const currentYear = new Date().getFullYear();
  const years = targetYear - currentYear;
  const projectionYears: { year: number; incomeCents: number }[] = [];
  
  let income = projectedAnnualCents;
  for (let i = 0; i <= years; i++) {
    projectionYears.push({ year: currentYear + i, incomeCents: Math.round(income) });
    income *= (1 + growthRate);
  }

  return { currentAnnualCents, projectedAnnualCents, projectionYears };
}

function IncomeChart({ data, targetCents }: { data: { year: number; incomeCents: number }[]; targetCents: number }) {
  if (data.length === 0) return null;
  
  const maxIncome = Math.max(...data.map(d => d.incomeCents), targetCents);
  const chartHeight = 200;
  const chartWidth = 600;
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  const xScale = (i: number) => padding.left + (i / (data.length - 1)) * innerWidth;
  const yScale = (v: number) => padding.top + innerHeight - (v / maxIncome) * innerHeight;

  const pathD = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(d.incomeCents)}`).join(' ');
  const targetY = yScale(targetCents);

  return (
    <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className={styles.chart}>
      {/* Target line */}
      <line x1={padding.left} y1={targetY} x2={chartWidth - padding.right} y2={targetY} 
        stroke="var(--color-primary)" strokeDasharray="4 2" strokeWidth="1" />
      <text x={chartWidth - padding.right - 5} y={targetY - 5} 
        fill="var(--color-primary)" fontSize="10" textAnchor="end">Target</text>
      
      {/* Income line */}
      <path d={pathD} fill="none" stroke="var(--color-success)" strokeWidth="2" />
      
      {/* Data points */}
      {data.map((d, i) => (
        <circle key={d.year} cx={xScale(i)} cy={yScale(d.incomeCents)} r="3" fill="var(--color-success)" />
      ))}
      
      {/* X axis labels */}
      {data.filter((_, i) => i % Math.ceil(data.length / 5) === 0 || i === data.length - 1).map((d) => (
        <text key={d.year} x={xScale(data.indexOf(d))} y={chartHeight - 10} 
          fill="var(--color-text-muted)" fontSize="10" textAnchor="middle">{d.year}</text>
      ))}
      
      {/* Y axis labels */}
      {[0, 0.25, 0.5, 0.75, 1].map(pct => (
        <text key={pct} x={padding.left - 5} y={yScale(maxIncome * pct)} 
          fill="var(--color-text-muted)" fontSize="10" textAnchor="end" dominantBaseline="middle">
          ${Math.round(maxIncome * pct / 100).toLocaleString()}
        </text>
      ))}
    </svg>
  );
}

export default function IncomePage(): JSX.Element {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [projection, setProjection] = useState<IncomeProjection | null>(null);
  const [targetYear, setTargetYear] = useState(2040);
  const [targetCents, setTargetCents] = useState(15000000); // $150k
  const [growthRate] = useState(0.07);

  useEffect(() => {
    async function load() {
      try {
        const [portfolioRes, watchlistRes, plansRes, settingsRes] = await Promise.all([
          api.portfolio.get(),
          api.watchlist.listEnhanced(),
          api.plans.list(),
          api.settings.get(),
        ]);
        
        const settings = settingsRes.data;
        const tgtYear = settings.incomeGoal?.targetYear ?? 2040;
        const tgtCents = settings.incomeGoal?.targetAnnualDividendCents ?? 15000000;
        setTargetYear(tgtYear);
        setTargetCents(tgtCents);
        
        const allPlans = [...plansRes.data.active, ...plansRes.data.paused];
        const proj = calculateProjection(portfolioRes.data, watchlistRes.data, allPlans, tgtYear, growthRate);
        setProjection(proj);
      } catch (e) {
        addToast(e instanceof Error ? e.message : 'Failed to load income data', 'error');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [addToast, growthRate]);

  if (loading) return <div><p>Loading...</p></div>;
  if (!projection) return <div><p>No data available</p></div>;

  const changePercent = projection.currentAnnualCents > 0
    ? ((projection.projectedAnnualCents - projection.currentAnnualCents) / projection.currentAnnualCents * 100)
    : 0;

  return (
    <div>
      <h1>Income Projection</h1>

      <div className={styles.summary}>
        <div className={styles.summaryCard}>
          <span className={styles.label}>Current Annual Dividend Income</span>
          <span className={styles.value}>{centsToUSD(projection.currentAnnualCents)}</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.label}>Projected (if plans complete)</span>
          <span className={styles.value}>
            {centsToUSD(projection.projectedAnnualCents)}
            {changePercent > 0 && <span className={styles.change}> (+{changePercent.toFixed(0)}%)</span>}
          </span>
        </div>
      </div>

      <div className={styles.chartContainer}>
        <IncomeChart data={projection.projectionYears} targetCents={targetCents} />
      </div>

      <div className={styles.assumptions}>
        <p>Assumptions: {(growthRate * 100).toFixed(0)}% dividend growth, dividends reinvested</p>
        <p>Target: {centsToUSD(targetCents)}/yr by {targetYear}</p>
      </div>
    </div>
  );
}
