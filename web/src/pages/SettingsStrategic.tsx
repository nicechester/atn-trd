import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { useToast } from '../context/ToastContext';
import styles from './SettingsForm.module.css';

interface JobSchedule {
  name: string;
  cron: string;
  nextRun: string | null;
  enabled: boolean;
}

type FormState = {
  // Signals
  signalsEnabled: boolean;
  buyThreshold: number;
  sellThreshold: number;
  pauseThreshold: number;
  cancelThreshold: number;
  ewmaAlpha: number;
  weightSentiment: number;
  weightSentimentTrend: number;
  weightPriceMomentum: number;
  // Regime
  regimeEnabled: boolean;
  vixRiskOffThreshold: number;
  vixExtremeThreshold: number;
  confirmationDays: number;
  breadthThreshold: number;
  // Execution
  executionEnabled: boolean;
  trancheStyle: 'fixed' | 'conviction_scaled' | 'dip_buying';
  defaultTrancheCount: number;
  minDaysBetweenTranches: number;
  maxSectorExposure: number;
  // Hedging
  hedgingEnabled: boolean;
  riskOffAssetsText: string;
  cashReserveInRiskOff: number;
  autoTrimForCash: boolean;
  autoCreateHedgePlan: boolean;
  minCashForHedge: number;
  minRiskOffStreak: number;
  notificationWebhookUrl: string;
  // Income Goal
  incomeGoalEnabled: boolean;
  targetAnnualDividendDollars: number;
  targetYear: number;
};

export default function SettingsStrategic(): JSX.Element {
  const { addToast } = useToast();
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [jobSchedules, setJobSchedules] = useState<JobSchedule[]>([]);

  useEffect(() => {
    api.settings.get()
      .then(res => {
        const { signals, regime, execution, hedging, incomeGoal } = res.data;
        setForm({
          signalsEnabled: signals.enabled,
          buyThreshold: signals.buyThreshold,
          sellThreshold: signals.sellThreshold,
          pauseThreshold: signals.pauseThreshold,
          cancelThreshold: signals.cancelThreshold,
          ewmaAlpha: signals.ewmaAlpha,
          weightSentiment: signals.weights.sentiment,
          weightSentimentTrend: signals.weights.sentimentTrend,
          weightPriceMomentum: signals.weights.priceMomentum,
          regimeEnabled: regime.enabled,
          vixRiskOffThreshold: regime.vixRiskOffThreshold,
          vixExtremeThreshold: regime.vixExtremeThreshold,
          confirmationDays: regime.confirmationDays,
          breadthThreshold: regime.breadthThreshold,
          executionEnabled: execution.enabled,
          trancheStyle: execution.trancheStyle,
          defaultTrancheCount: execution.defaultTrancheCount,
          minDaysBetweenTranches: execution.minDaysBetweenTranches,
          maxSectorExposure: execution.maxSectorExposure * 100,
          hedgingEnabled: hedging.enabled,
          riskOffAssetsText: hedging.riskOffAssets.join('\n'),
          cashReserveInRiskOff: hedging.cashReserveInRiskOff * 100,
          autoTrimForCash: hedging.autoTrimForCash,
          autoCreateHedgePlan: hedging.autoCreateHedgePlan,
          minCashForHedge: hedging.minCashForHedge * 100,
          minRiskOffStreak: hedging.minRiskOffStreak,
          notificationWebhookUrl: hedging.notificationWebhookUrl,
          incomeGoalEnabled: incomeGoal.enabled,
          targetAnnualDividendDollars: Math.round(incomeGoal.targetAnnualDividendCents / 100),
          targetYear: incomeGoal.targetYear,
        });
      })
      .catch(err => addToast(err instanceof Error ? err.message : 'Failed to load settings', 'error'));

    // Fetch job schedules
    fetch('/api/scheduler/jobs', { credentials: 'include' })
      .then(res => res.json())
      .then(data => setJobSchedules(data.jobs || []))
      .catch(() => {});
  }, []);

  function validate(): string | null {
    if (!form) return 'Form not loaded';
    const weightSum = form.weightSentiment + form.weightSentimentTrend + form.weightPriceMomentum;
    if (Math.abs(weightSum - 1) > 0.01) return `Signal weights must sum to 1 (currently ${weightSum.toFixed(2)})`;
    if (form.buyThreshold <= form.pauseThreshold) return 'Buy threshold must be greater than pause threshold';
    if (form.pauseThreshold <= form.cancelThreshold) return 'Pause threshold must be greater than cancel threshold';
    if (form.vixExtremeThreshold <= form.vixRiskOffThreshold) return 'VIX extreme threshold must exceed risk-off threshold';
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;

    const error = validate();
    if (error) {
      addToast(error, 'error');
      return;
    }

    const riskOffAssets = form.riskOffAssetsText
      .split('\n').map(s => s.trim().toUpperCase()).filter(Boolean);

    setSaving(true);
    try {
      await api.settings.patch({
        signals: {
          enabled: form.signalsEnabled,
          buyThreshold: form.buyThreshold,
          sellThreshold: form.sellThreshold,
          pauseThreshold: form.pauseThreshold,
          cancelThreshold: form.cancelThreshold,
          ewmaAlpha: form.ewmaAlpha,
          weights: {
            sentiment: form.weightSentiment,
            sentimentTrend: form.weightSentimentTrend,
            priceMomentum: form.weightPriceMomentum,
          },
        },
        regime: {
          enabled: form.regimeEnabled,
          vixRiskOffThreshold: form.vixRiskOffThreshold,
          vixExtremeThreshold: form.vixExtremeThreshold,
          confirmationDays: form.confirmationDays,
          breadthThreshold: form.breadthThreshold,
        },
        execution: {
          enabled: form.executionEnabled,
          trancheStyle: form.trancheStyle,
          defaultTrancheCount: form.defaultTrancheCount,
          minDaysBetweenTranches: form.minDaysBetweenTranches,
          maxSectorExposure: form.maxSectorExposure / 100,
        },
        hedging: {
          enabled: form.hedgingEnabled,
          riskOffAssets,
          cashReserveInRiskOff: form.cashReserveInRiskOff / 100,
          autoTrimForCash: form.autoTrimForCash,
          autoCreateHedgePlan: form.autoCreateHedgePlan,
          minCashForHedge: form.minCashForHedge / 100,
          minRiskOffStreak: form.minRiskOffStreak,
          notificationWebhookUrl: form.notificationWebhookUrl,
        },
        incomeGoal: {
          enabled: form.incomeGoalEnabled,
          targetAnnualDividendCents: Math.round(form.targetAnnualDividendDollars * 100),
          targetYear: form.targetYear,
        },
      });
      addToast('Strategic settings saved', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!form) return <Card><p>Loading...</p></Card>;

  const weightSum = form.weightSentiment + form.weightSentimentTrend + form.weightPriceMomentum;
  const weightError = Math.abs(weightSum - 1) > 0.01;

  const formatNextRun = (jobName: string) => {
    const job = jobSchedules.find(j => j.name === jobName);
    if (!job?.nextRun) return null;
    const date = new Date(job.nextRun);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone.split('/').pop()?.replace('_', ' ') || 'Local';
    return date.toLocaleString() + ` (${tz})`;
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Signals */}
      <Card title="Signal Thresholds">
        <div className={`${styles.field} ${styles.checkboxField}`}>
          <input type="checkbox" checked={form.signalsEnabled}
            onChange={e => setForm({ ...form, signalsEnabled: e.target.checked })} />
          <label className={styles.label}>Enable signal-based trading</label>
          <span className={styles.hint} style={{ marginLeft: 'auto' }}>
            {form.signalsEnabled && formatNextRun('Signal Collection')
              ? `Next: ${formatNextRun('Signal Collection')}`
              : '(Daily 4:00 PM ET)'}
          </span>
        </div>
        <div className={styles.grid}>
          <div className={styles.field}>
            <label className={styles.label}>Buy Threshold</label>
            <input className={styles.input} type="number" min={0.5} max={0.95} step={0.01}
              value={form.buyThreshold} onChange={e => setForm({ ...form, buyThreshold: +e.target.value })} />
            <span className={styles.hint}>Create plan when score exceeds this</span>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Pause Threshold</label>
            <input className={styles.input} type="number" min={0.4} max={0.8} step={0.01}
              value={form.pauseThreshold} onChange={e => setForm({ ...form, pauseThreshold: +e.target.value })} />
            <span className={styles.hint}>Pause plan execution below this</span>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Cancel Threshold</label>
            <input className={styles.input} type="number" min={0.3} max={0.6} step={0.01}
              value={form.cancelThreshold} onChange={e => setForm({ ...form, cancelThreshold: +e.target.value })} />
            <span className={styles.hint}>Cancel plan below this</span>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Sell Threshold</label>
            <input className={styles.input} type="number" min={-0.8} max={-0.3} step={0.01}
              value={form.sellThreshold} onChange={e => setForm({ ...form, sellThreshold: +e.target.value })} />
            <span className={styles.hint}>Trigger sell when score drops below</span>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>EWMA Alpha</label>
            <input className={styles.input} type="number" min={0.05} max={0.3} step={0.01}
              value={form.ewmaAlpha} onChange={e => setForm({ ...form, ewmaAlpha: +e.target.value })} />
            <span className={styles.hint}>Signal smoothing (lower = smoother)</span>
          </div>
        </div>
        <h4>Signal Weights {weightError && <span className={styles.warning}>(must sum to 1, currently {weightSum.toFixed(2)})</span>}</h4>
        <div className={styles.grid}>
          <div className={styles.field}>
            <label className={styles.label}>Sentiment</label>
            <input className={styles.input} type="number" min={0} max={1} step={0.1}
              value={form.weightSentiment} onChange={e => setForm({ ...form, weightSentiment: +e.target.value })} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Sentiment Trend</label>
            <input className={styles.input} type="number" min={0} max={1} step={0.1}
              value={form.weightSentimentTrend} onChange={e => setForm({ ...form, weightSentimentTrend: +e.target.value })} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Price Momentum</label>
            <input className={styles.input} type="number" min={0} max={1} step={0.1}
              value={form.weightPriceMomentum} onChange={e => setForm({ ...form, weightPriceMomentum: +e.target.value })} />
          </div>
        </div>
      </Card>

      {/* Regime */}
      <Card title="Regime Detection">
        <div className={`${styles.field} ${styles.checkboxField}`}>
          <input type="checkbox" checked={form.regimeEnabled}
            onChange={e => setForm({ ...form, regimeEnabled: e.target.checked })} />
          <label className={styles.label}>Enable regime detection</label>
          <span className={styles.hint} style={{ marginLeft: 'auto' }}>
            {form.regimeEnabled && formatNextRun('Regime Detection')
              ? `Next: ${formatNextRun('Regime Detection')}`
              : '(Daily 4:05 PM ET)'}
          </span>
        </div>
        <div className={styles.grid}>
          <div className={styles.field}>
            <label className={styles.label}>VIX Risk-Off Threshold</label>
            <input className={styles.input} type="number" min={15} max={40} step={1}
              value={form.vixRiskOffThreshold} onChange={e => setForm({ ...form, vixRiskOffThreshold: +e.target.value })} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>VIX Extreme Threshold</label>
            <input className={styles.input} type="number" min={25} max={60} step={1}
              value={form.vixExtremeThreshold} onChange={e => setForm({ ...form, vixExtremeThreshold: +e.target.value })} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Confirmation Days</label>
            <input className={styles.input} type="number" min={1} max={10} step={1}
              value={form.confirmationDays} onChange={e => setForm({ ...form, confirmationDays: +e.target.value })} />
            <span className={styles.hint}>Days to confirm regime change</span>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Breadth Threshold</label>
            <input className={styles.input} type="number" min={0.2} max={0.6} step={0.05}
              value={form.breadthThreshold} onChange={e => setForm({ ...form, breadthThreshold: +e.target.value })} />
            <span className={styles.hint}>% stocks above 200 DMA for risk-on</span>
          </div>
        </div>
      </Card>

      {/* Execution */}
      <Card title="Execution Style">
        <div className={`${styles.field} ${styles.checkboxField}`}>
          <input type="checkbox" checked={form.executionEnabled}
            onChange={e => setForm({ ...form, executionEnabled: e.target.checked })} />
          <label className={styles.label}>Enable tranched execution</label>
          <span className={styles.hint} style={{ marginLeft: 'auto' }}>
            {form.executionEnabled && formatNextRun('Tranche Executor')
              ? `Next: ${formatNextRun('Tranche Executor')}`
              : '(Daily 4:15 PM ET)'}
          </span>
        </div>
        <div className={styles.grid}>
          <div className={styles.field}>
            <label className={styles.label}>Tranche Style</label>
            <select className={styles.select} value={form.trancheStyle}
              onChange={e => setForm({ ...form, trancheStyle: e.target.value as FormState['trancheStyle'] })}>
              <option value="fixed">Fixed (equal tranches)</option>
              <option value="conviction_scaled">Conviction Scaled</option>
              <option value="dip_buying">Dip Buying</option>
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Default Tranche Count</label>
            <input className={styles.input} type="number" min={1} max={10} step={1}
              value={form.defaultTrancheCount} onChange={e => setForm({ ...form, defaultTrancheCount: +e.target.value })} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Min Days Between Tranches</label>
            <input className={styles.input} type="number" min={1} max={30} step={1}
              value={form.minDaysBetweenTranches} onChange={e => setForm({ ...form, minDaysBetweenTranches: +e.target.value })} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Max Sector Exposure (%)</label>
            <input className={styles.input} type="number" min={10} max={50} step={5}
              value={form.maxSectorExposure} onChange={e => setForm({ ...form, maxSectorExposure: +e.target.value })} />
          </div>
        </div>
      </Card>

      {/* Hedging */}
      <Card title="Hedging">
        <div className={`${styles.field} ${styles.checkboxField}`}>
          <input type="checkbox" checked={form.hedgingEnabled}
            onChange={e => setForm({ ...form, hedgingEnabled: e.target.checked })} />
          <label className={styles.label}>Enable hedging in risk-off</label>
        </div>
        <div className={styles.grid}>
          <div className={styles.field}>
            <label className={styles.label}>Cash Reserve in Risk-Off (%)</label>
            <input className={styles.input} type="number" min={10} max={80} step={5}
              value={form.cashReserveInRiskOff} onChange={e => setForm({ ...form, cashReserveInRiskOff: +e.target.value })} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Min Cash for Hedge (%)</label>
            <input className={styles.input} type="number" min={5} max={50} step={5}
              value={form.minCashForHedge} onChange={e => setForm({ ...form, minCashForHedge: +e.target.value })} />
            <span className={styles.hint}>Cash needed before creating hedge plan</span>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Min Risk-Off Streak (days)</label>
            <input className={styles.input} type="number" min={1} max={10} step={1}
              value={form.minRiskOffStreak} onChange={e => setForm({ ...form, minRiskOffStreak: +e.target.value })} />
            <span className={styles.hint}>Consecutive risk-off days before hedging</span>
          </div>
        </div>
        <div className={styles.grid}>
          <div className={`${styles.field} ${styles.checkboxField}`}>
            <input type="checkbox" checked={form.autoTrimForCash}
              onChange={e => setForm({ ...form, autoTrimForCash: e.target.checked })} />
            <label className={styles.label}>Auto-trim positions for cash</label>
          </div>
          <div className={`${styles.field} ${styles.checkboxField}`}>
            <input type="checkbox" checked={form.autoCreateHedgePlan}
              onChange={e => setForm({ ...form, autoCreateHedgePlan: e.target.checked })} />
            <label className={styles.label}>Auto-create hedge plans</label>
          </div>
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Risk-Off Assets (one per line)</label>
          <textarea className={styles.textarea} value={form.riskOffAssetsText}
            onChange={e => setForm({ ...form, riskOffAssetsText: e.target.value })}
            placeholder="GLD&#10;TLT&#10;SHY" />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Notification Webhook URL</label>
          <input className={styles.input} type="url"
            value={form.notificationWebhookUrl}
            onChange={e => setForm({ ...form, notificationWebhookUrl: e.target.value })}
            placeholder="https://discord.com/api/webhooks/... or https://hooks.slack.com/..." />
          <span className={styles.hint}>Discord or Slack webhook for alerts (WAITING, PAUSED, EXECUTED, REGIME_CHANGE)</span>
        </div>
      </Card>

      {/* Income Goal */}
      <Card title="Income Goal">
        <div className={`${styles.field} ${styles.checkboxField}`}>
          <input type="checkbox" checked={form.incomeGoalEnabled}
            onChange={e => setForm({ ...form, incomeGoalEnabled: e.target.checked })} />
          <label className={styles.label}>Enable income goal tracking</label>
        </div>
        <div className={styles.grid}>
          <div className={styles.field}>
            <label className={styles.label}>Target Annual Dividend ($)</label>
            <input className={styles.input} type="number" min={0} step={100}
              value={form.targetAnnualDividendDollars} onChange={e => setForm({ ...form, targetAnnualDividendDollars: +e.target.value })} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Target Year</label>
            <input className={styles.input} type="number" min={2024} max={2100} step={1}
              value={form.targetYear} onChange={e => setForm({ ...form, targetYear: +e.target.value })} />
          </div>
        </div>
      </Card>

      <div className={styles.actions}>
        <button className={styles.saveBtn} type="submit" disabled={saving}>
          {saving ? 'Saving...' : 'Save Strategic Settings'}
        </button>
      </div>

      <Card title="❓ How These Settings Work">
        <dl className={styles.helpList}>
          <dt>Enable toggles</dt>
          <dd>Data collection runs regardless. Toggles control whether the system <em>acts</em> on the data (creates plans, executes trades, rotates to hedges).</dd>
          
          <dt>EWMA(Exponential Weighted Moving Average) Alpha</dt>
          <dd>Exponential smoothing factor. Lower values (0.05) = smoother, slower to react. Higher values (0.3) = more responsive to recent data. Default 0.10 means 10% weight to today, 90% to history.</dd>
          
          <dt>Signal Weights</dt>
          <dd>How to combine inputs into composite score. Must sum to 1. Sentiment = current LLM assessment (-1 to +1). Sentiment Trend = direction over rolling window. Price Momentum = technical price action.</dd>
          
          <dt>Composite Score</dt>
          <dd>Calculated as: (sentiment × weight) + (sentimentTrend × weight) + (priceMomentum × weight). Then smoothed with EWMA: <code>S'ₙ = α × Sₙ + (1-α) × S'ₙ₋₁</code>, where S'ₙ is today's smoothed score, Sₙ is today's raw score, S'ₙ₋₁ is yesterday's smoothed score, and α is the EWMA Alpha setting above. Result ranges from -1 (strong sell) to +1 (strong buy).</dd>
          
          <dt>Thresholds (Buy → Pause → Cancel)</dt>
          <dd>Buy: create a plan when score exceeds this. Pause: stop executing tranches if score drops below. Cancel: abandon plan entirely. Must be ordered: buy &gt; pause &gt; cancel.</dd>
          
          <dt>VIX Thresholds</dt>
          <dd>Risk-Off: pause growth buying, continue income. Extreme: raise cash, consider hedges. Confirmation Days prevents whipsaw on single-day spikes.</dd>
          
          <dt>Tranche Styles</dt>
          <dd>Fixed: equal-sized buys. Conviction Scaled: larger tranches for higher-conviction plans. Dip Buying: buy more when price drops from plan creation.</dd>
          
          <dt>Max Sector Exposure</dt>
          <dd>Caps how much of portfolio can be in one sector. New plans blocked if sector would exceed this.</dd>
          
          <dt>Income Goal</dt>
          <dd>Long-term dividend target. System prioritizes dividend growers that compound toward this goal rather than chasing current yield.</dd>
        </dl>
      </Card>
    </form>
  );
}
