import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type StrategicPlan, type PlanTranche, type MarketRegime, type PlanReviewSummary } from '../api/client';
import { Card } from '../components/Card';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { centsToUSD, formatTimestamp } from '../lib/format';
import styles from './Plans.module.css';

function RegimeBadge({ regime }: { regime: MarketRegime | null }) {
  if (!regime) return <span className={styles.regimeUnknown}>⚪ Unknown</span>;
  
  const icon = regime.regime === 'RISK_ON' ? '🟢' : regime.regime === 'RISK_OFF' ? '🔴' : '🟡';
  const className = regime.regime === 'RISK_ON' ? styles.regimeOn : regime.regime === 'RISK_OFF' ? styles.regimeOff : styles.regimeNeutral;
  
  return (
    <div className={className}>
      <span>{icon} {regime.regime.replace('_', ' ')} (Day {regime.streak})</span>
      {regime.vixLevel && <span className={styles.regimeDetail}>VIX: {regime.vixLevel.toFixed(1)}</span>}
    </div>
  );
}

function ProgressBar({ executed, total }: { executed: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (executed / total) * 100) : 0;
  return (
    <div className={styles.progressBar}>
      <div className={styles.progressFill} style={{ width: `${pct}%` }} />
      <span className={styles.progressText}>{executed}/{total}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: StrategicPlan['status'] }) {
  const className = {
    ACTIVE: styles.badgeActive,
    PAUSED: styles.badgePaused,
    COMPLETED: styles.badgeCompleted,
    CANCELLED: styles.badgeCancelled,
  }[status];
  return <span className={className}>{status}</span>;
}

function DirectionBadge({ direction }: { direction: StrategicPlan['direction'] }) {
  const icon = direction === 'ACCUMULATE' ? '📈' : direction === 'TRIM' ? '📉' : '🛡️';
  return <span className={styles.directionBadge}>{icon} {direction}</span>;
}

function PlanCard({ plan, onClick }: { plan: StrategicPlan; onClick: () => void }) {
  const daysSinceLastTranche = plan.lastTrancheAt 
    ? Math.floor((Date.now() - plan.lastTrancheAt) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div className={styles.planCard} onClick={onClick}>
      <div className={styles.planHeader}>
        <span className={styles.symbol}>{plan.symbol}</span>
        <DirectionBadge direction={plan.direction} />
        <StatusBadge status={plan.status} />
      </div>
      
      <div className={styles.planProgress}>
        <ProgressBar executed={plan.tranchesExecuted} total={plan.trancheCount} />
        <span className={styles.shares}>
          {plan.executedShares.toFixed(2)} / {plan.targetShares.toFixed(2)} shares
        </span>
      </div>

      {plan.pauseReason && (
        <div className={styles.pauseReason}>⚠️ {plan.pauseReason}</div>
      )}

      <div className={styles.planMeta}>
        {plan.entryCompositeScore !== null && (
          <span>Entry Score: {plan.entryCompositeScore.toFixed(2)}</span>
        )}
        {daysSinceLastTranche !== null && (
          <span>Last tranche: {daysSinceLastTranche}d ago</span>
        )}
        <span>Min interval: {plan.minDaysBetween}d</span>
      </div>

      {plan.creationNotes && (
        <div className={styles.creationNotes}>
          <span className={styles.notesLabel}>Created:</span> {plan.creationNotes}
        </div>
      )}
    </div>
  );
}

function PlanDetail({ planId, onBack }: { planId: string; onBack: () => void }) {
  const [data, setData] = useState<{ plan: StrategicPlan; tranches: PlanTranche[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const { addToast } = useToast();

  useEffect(() => {
    api.plans.get(planId)
      .then(res => setData(res.data))
      .catch((e: Error) => addToast(e.message || 'Failed to load plan', 'error'))
      .finally(() => setLoading(false));
  }, [planId, addToast]);

  if (loading) return <p>Loading...</p>;
  if (!data) return <p>Plan not found</p>;

  const { plan, tranches } = data;

  return (
    <div>
      <button className={styles.backBtn} onClick={onBack}>← Back to Plans</button>
      
      <div className={styles.detailHeader}>
        <h2>{plan.symbol}</h2>
        <DirectionBadge direction={plan.direction} />
        <StatusBadge status={plan.status} />
      </div>

      <div className={styles.detailGrid}>
        <Card title="Progress">
          <ProgressBar executed={plan.tranchesExecuted} total={plan.trancheCount} />
          <p>{plan.executedShares.toFixed(2)} / {plan.targetShares.toFixed(2)} shares</p>
          {plan.targetBudgetCents && <p>Budget: {centsToUSD(plan.targetBudgetCents)}</p>}
        </Card>

        <Card title="Settings">
          <p>Min days between: {plan.minDaysBetween}</p>
          <p>Entry score: {plan.entryCompositeScore?.toFixed(2) ?? 'N/A'}</p>
          <p>Conviction: {plan.convictionAtCreation?.toFixed(2) ?? 'N/A'}</p>
        </Card>

        <Card title="Timing">
          <p>Created: {formatTimestamp(plan.createdAt)}</p>
          {plan.lastTrancheAt && <p>Last tranche: {formatTimestamp(plan.lastTrancheAt)}</p>}
          {plan.completedAt && <p>Completed: {formatTimestamp(plan.completedAt)}</p>}
        </Card>
      </div>

      {plan.creationNotes && (
        <Card title="Creation Notes">
          <p className={styles.creationNotesDetail}>{plan.creationNotes}</p>
        </Card>
      )}

      {plan.pauseReason && (
        <Card title="Pause Reason">
          <p className={styles.pauseReasonDetail}>⚠️ {plan.pauseReason}</p>
        </Card>
      )}

      <Card title="Tranches">
        {tranches.length === 0 ? (
          <p className={styles.muted}>No tranches executed yet</p>
        ) : (
          <table className={styles.trancheTable}>
            <thead>
              <tr>
                <th>#</th>
                <th>Shares</th>
                <th>Price</th>
                <th>Cost</th>
                <th>Score</th>
                <th>Regime</th>
                <th>Status</th>
                <th>Executed</th>
              </tr>
            </thead>
            <tbody>
              {tranches.map(t => (
                <tr key={t.id}>
                  <td>{t.trancheNumber}</td>
                  <td>{t.shares.toFixed(2)}</td>
                  <td>{centsToUSD(t.priceCents)}</td>
                  <td>{t.totalCostCents ? centsToUSD(t.totalCostCents) : '-'}</td>
                  <td>{t.compositeScore?.toFixed(2) ?? '-'}</td>
                  <td>{t.regime ?? '-'}</td>
                  <td><span className={styles[`tranche${t.orderStatus}`]}>{t.orderStatus}</span></td>
                  <td>{formatTimestamp(t.executedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

export default function PlansPage() {
  const { id } = useParams<{ id?: string }>();
  const [activePlans, setActivePlans] = useState<StrategicPlan[]>([]);
  const [pausedPlans, setPausedPlans] = useState<StrategicPlan[]>([]);
  const [regime, setRegime] = useState<MarketRegime | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<PlanReviewSummary | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(id || null);
  const { addToast } = useToast();
  const { canWrite } = useAuth();

  async function loadData() {
    try {
      const [plansRes, regimeRes] = await Promise.all([
        api.plans.list(),
        api.regime.current(),
      ]);
      setActivePlans(plansRes.data.active);
      setPausedPlans(plansRes.data.paused);
      setRegime(regimeRes.data);
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to load plans', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function runPlanner() {
    setRunning(true);
    setLastResult(null);
    try {
      addToast('Collecting signals...', 'info');
      const signalRes = await api.strategicJobs.collectSignals();
      addToast(`Signals collected for ${signalRes.summary.symbolsUpdated} symbols`, 'info');
      
      addToast('Running planner...', 'info');
      const planRes = await api.strategicJobs.runPlanner();
      setLastResult(planRes.summary);
      
      if (planRes.summary.plansCreated > 0) {
        addToast(`Created ${planRes.summary.plansCreated} plans!`, 'success');
      } else {
        addToast('No new plans created (see details below)', 'info');
      }
      await loadData();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Planner failed', 'error');
    } finally {
      setRunning(false);
    }
  }

  if (loading) return <p>Loading...</p>;

  if (selectedPlanId) {
    return <PlanDetail planId={selectedPlanId} onBack={() => setSelectedPlanId(null)} />;
  }

  return (
    <div>
      <div className={styles.header}>
        <h1>Strategic Plans</h1>
        <div className={styles.headerActions}>
          {canWrite && (
            <button 
              className={running ? styles.btnDisabled : styles.btnPrimary}
              onClick={runPlanner}
              disabled={running}
            >
              {running ? 'Running...' : 'Run Planner'}
            </button>
          )}
          <RegimeBadge regime={regime} />
        </div>
      </div>

      {lastResult && (
        <div className={styles.resultCard}>
          <h3>Last Planner Run</h3>
          <p>Regime: <strong>{lastResult.regime}</strong></p>
          <p>Watchlist symbols: {lastResult.watchlistCount}</p>
          <p>Positions monitored: {lastResult.positionsCount}</p>
          <p>Accumulate plans created: <strong>{lastResult.plansCreated}</strong></p>
          <p>Trim plans created: <strong>{lastResult.trimPlansCreated}</strong></p>
          <p>Existing active plans: {lastResult.existingActivePlans}</p>
          {lastResult.plansSkipped.length > 0 && (
            <details>
              <summary>Skipped ({lastResult.plansSkipped.length})</summary>
              <ul className={styles.skipList}>
                {lastResult.plansSkipped.map((s, i) => (
                  <li key={i}><strong>{s.symbol}</strong>: {s.reason}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <h2 className={styles.sectionTitle}>Active Plans ({activePlans.length})</h2>
      {activePlans.length === 0 ? (
        <p className={styles.muted}>No active plans</p>
      ) : (
        <div className={styles.planGrid}>
          {activePlans.map(plan => (
            <PlanCard key={plan.id} plan={plan} onClick={() => setSelectedPlanId(plan.id)} />
          ))}
        </div>
      )}

      <h2 className={styles.sectionTitle}>Paused Plans ({pausedPlans.length})</h2>
      {pausedPlans.length === 0 ? (
        <p className={styles.muted}>No paused plans</p>
      ) : (
        <div className={styles.planGrid}>
          {pausedPlans.map(plan => (
            <PlanCard key={plan.id} plan={plan} onClick={() => setSelectedPlanId(plan.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
