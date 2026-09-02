import { useEffect, useState } from 'react';
import { api } from '../api/client';
import styles from './DailyActivityLog.module.css';

interface ActivityItem {
  icon: string;
  message: string;
  status: 'done' | 'waiting' | 'info';
}

export function DailyActivityLog(): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [summary, setSummary] = useState<string>('');

  useEffect(() => {
    async function load() {
      try {
        const [regimeRes, plansRes, watchlistRes] = await Promise.all([
          api.regime.current(),
          api.plans.list(),
          api.watchlist.listEnhanced(),
        ]);

        const items: ActivityItem[] = [];
        const regime = regimeRes.data;
        const plans = [...plansRes.data.active, ...plansRes.data.paused];
        const watchlist = watchlistRes.data;

        // Signal collection status
        items.push({
          icon: '✓',
          message: `Signal collection complete (${watchlist.length} symbols)`,
          status: 'done',
        });

        // Regime check
        if (regime) {
          items.push({
            icon: '✓',
            message: `Regime check: ${regime.regime} (day ${regime.streak})`,
            status: 'done',
          });
        }

        // Plan statuses
        const activePlans = plans.filter(p => p.status === 'ACTIVE');
        const pausedPlans = plans.filter(p => p.status === 'PAUSED');

        for (const plan of activePlans.slice(0, 3)) {
          const daysSinceLastTranche = plan.lastTrancheAt 
            ? Math.floor((Date.now() - plan.lastTrancheAt) / (1000 * 60 * 60 * 24))
            : plan.minDaysBetween;
          const daysUntilNext = Math.max(0, plan.minDaysBetween - daysSinceLastTranche);
          
          items.push({
            icon: '○',
            message: `${plan.symbol}: Waiting (${daysUntilNext > 0 ? `${daysUntilNext} days until next tranche` : 'ready for tranche'})`,
            status: 'waiting',
          });
        }

        for (const plan of pausedPlans.slice(0, 2)) {
          items.push({
            icon: '○',
            message: `${plan.symbol}: Paused (${plan.pauseReason || 'score below threshold'})`,
            status: 'waiting',
          });
        }

        // Summary
        const totalDivImpact = activePlans.reduce((sum, p) => {
          const w = watchlist.find(w => w.symbol === p.symbol);
          const yieldPct = w?.yieldPercent ?? 0;
          const remainingShares = p.targetShares - p.executedShares;
          const estValue = remainingShares * 10000; // $100 per share estimate
          return sum + Math.round(estValue * (yieldPct / 100));
        }, 0);

        setSummary(
          activePlans.length === 0
            ? 'No active plans. Portfolio stable.'
            : `No trades today. Portfolio +$${Math.round(totalDivImpact / 100).toLocaleString()} div/yr when plans complete.`
        );

        setActivities(items);
      } catch {
        setActivities([{ icon: '!', message: 'Failed to load activity', status: 'info' }]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <div className={styles.container}><p className={styles.loading}>Loading...</p></div>;

  const today = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>Today's Activity</span>
        <span className={styles.date}>{today}</span>
      </div>
      <div className={styles.list}>
        {activities.map((item, i) => (
          <div key={i} className={`${styles.item} ${styles[item.status]}`}>
            <span className={styles.icon}>{item.icon}</span>
            <span className={styles.message}>{item.message}</span>
          </div>
        ))}
      </div>
      {summary && (
        <>
          <hr className={styles.divider} />
          <div className={styles.summary}>{summary}</div>
        </>
      )}
    </div>
  );
}
