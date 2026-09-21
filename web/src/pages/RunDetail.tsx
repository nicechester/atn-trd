import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { runs as runsApi, type RunDetailData, type AgentRunRow, type DecisionRow, type AgentMessageRow, type ResearchArtifactRow, type RunCoverageData, type PlanReviewSummary, type SignalCollectionSummary, type WatchlistCurationSummary, type TrancheExecutionSummary, type ScreenerSelectionRow, type SignalSnapshotRow } from '../api/client';
import { centsToUSD, formatTimestamp, formatDuration, formatQty } from '../lib/format';
import { useToast } from '../context/ToastContext';
import CoverageHeatmap from '../components/CoverageHeatmap';
import { RejectedDecisions } from '../components/RejectedDecisions';
import styles from './RunDetail.module.css';

type JobType = 'trading_cycle' | 'signal_collection' | 'plan_review' | 'tranche_execution' | 'watchlist_curation';

const JOB_TYPE_LABELS: Record<JobType, string> = {
  trading_cycle: 'Trading Cycle',
  signal_collection: 'Signal Collection',
  plan_review: 'Plan Review',
  tranche_execution: 'Tranche Execution',
  watchlist_curation: 'Watchlist Curation',
};

function inferJobType(run: AgentRunRow): JobType {
  if (run.trigger === 'signal_collection') return 'signal_collection';
  if (run.trigger === 'plan_review') return 'plan_review';
  if (run.trigger === 'tranche_execution') return 'tranche_execution';
  if (run.trigger === 'watchlist_curation') return 'watchlist_curation';
  if (run.summaryJson) {
    try {
      const summary = JSON.parse(run.summaryJson);
      if ('symbolsUpdated' in summary && 'symbols' in summary && !('regime' in summary)) return 'signal_collection';
      if ('plansCreated' in summary || 'watchlistCount' in summary) return 'plan_review';
      if ('tranchesExecuted' in summary) return 'tranche_execution';
      if ('symbolsAdded' in summary) return 'watchlist_curation';
    } catch {}
  }
  return 'trading_cycle';
}

function badgeClass(status: AgentRunRow['status'], s: Record<string, string>) {
  if (status === 'succeeded') return s.badgeGreen;
  if (status === 'failed') return s.badgeRed;
  if (status === 'running') return s.badgeYellow;
  return s.badgeGray;
}

function actionBadge(action: DecisionRow['action'], s: Record<string, string>) {
  if (action === 'buy' || action === 'add') return s.badgeGreen;
  if (action === 'sell' || action === 'trim') return s.badgeRed;
  return s.badgeGray;
}

function roleBadge(role: AgentMessageRow['role'], s: Record<string, string>) {
  if (role === 'system') return `${s.roleBadge} ${s.roleSystem}`;
  if (role === 'human') return `${s.roleBadge} ${s.roleHuman}`;
  if (role === 'ai') return `${s.roleBadge} ${s.roleAi}`;
  return `${s.roleBadge} ${s.roleTool}`;
}

function renderPlanReviewSummary(s: PlanReviewSummary) {
  // Group skipped by type for better display
  const plansSkipped = s.plansSkipped || [];
  const watchlistSkipped = plansSkipped.filter(sk => !sk.reason.startsWith('position:'));
  const positionSkipped = plansSkipped.filter(sk => sk.reason.startsWith('position:'));

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)' }}>
        <div><div className={styles.fieldLabel}>Regime</div><div className={styles.fieldValue}>{s.regime}</div></div>
        <div><div className={styles.fieldLabel}>Watchlist</div><div className={styles.fieldValue}>{s.watchlistCount} symbols</div></div>
        <div><div className={styles.fieldLabel}>Positions</div><div className={styles.fieldValue}>{s.positionsCount} monitored</div></div>
        <div><div className={styles.fieldLabel}>Accumulate Plans</div><div className={styles.fieldValue}>{s.plansCreated}</div></div>
        <div><div className={styles.fieldLabel}>Trim Plans</div><div className={styles.fieldValue}>{s.trimPlansCreated}</div></div>
        <div><div className={styles.fieldLabel}>Existing Active</div><div className={styles.fieldValue}>{s.existingActivePlans}</div></div>
      </div>

      {/* Pruned symbols */}
      {s.symbolsPruned && s.symbolsPruned.length > 0 && (
        <div style={{ marginBottom: 'var(--spacing-md)', padding: 'var(--spacing-sm)', background: 'var(--color-warning-bg, #fef3c7)', borderRadius: '4px' }}>
          <div style={{ fontWeight: 500, fontSize: '0.875rem', marginBottom: '4px' }}>🗑️ Pruned from Watchlist</div>
          <div style={{ fontSize: '0.875rem' }}>{s.symbolsPruned.join(', ')}</div>
        </div>
      )}

      {/* Watchlist skipped (waiting for buy threshold) */}
      {watchlistSkipped.length > 0 && (
        <details style={{ marginBottom: 'var(--spacing-sm)' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
            ⏳ Waiting ({watchlistSkipped.length}) - below buy threshold
          </summary>
          <ul style={{ margin: 'var(--spacing-sm) 0 0 var(--spacing-md)', fontSize: '0.875rem' }}>
            {watchlistSkipped.map((sk, i) => <li key={i}><strong>{sk.symbol}</strong>: {sk.reason}</li>)}
          </ul>
        </details>
      )}

      {/* Position skipped (not selling) */}
      {positionSkipped.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
            ✅ Holding ({positionSkipped.length}) - above sell threshold
          </summary>
          <ul style={{ margin: 'var(--spacing-sm) 0 0 var(--spacing-md)', fontSize: '0.875rem' }}>
            {positionSkipped.map((sk, i) => <li key={i}><strong>{sk.symbol}</strong>: {sk.reason.replace('position: ', '')}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function renderSignalCollectionSummary(s: SignalCollectionSummary, signalSnapshots: SignalSnapshotRow[]) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)' }}>
        <div><div className={styles.fieldLabel}>Symbols Updated</div><div className={styles.fieldValue}>{s.symbolsUpdated}</div></div>
        <div><div className={styles.fieldLabel}>Errors</div><div className={styles.fieldValue}>{s.errors}</div></div>
        {s.tokensUsed > 0 && <div><div className={styles.fieldLabel}>Tokens Used</div><div className={styles.fieldValue}>{s.tokensUsed.toLocaleString()}</div></div>}
      </div>
      {signalSnapshots.length > 0 && (
        <div style={{ marginTop: 'var(--spacing-md)' }}>
          <div className={styles.fieldLabel}>Signal Analysis</div>
          {signalSnapshots.map(snap => {
            // Compute options score from IV percentile and put/call ratio (same logic as server)
            const optionsScore = (snap.ivPercentile !== null || snap.putCallRatio !== null)
              ? ((snap.ivPercentile ?? 0) * 0.6 + (snap.putCallRatio !== null ? (1 - Math.min(snap.putCallRatio, 2) / 2) : 0) * 0.4)
              : null;
            // Compute fundamentals score from valuation and growth
            const fundamentalsScore = (snap.valuationScore !== null || snap.growthScore !== null)
              ? ((snap.valuationScore ?? 0) + (snap.growthScore ?? 0)) / 2
              : null;
            return (
            <div key={snap.id} style={{ padding: 'var(--spacing-sm)', marginTop: 'var(--spacing-xs)', background: 'var(--color-bg-secondary)', borderRadius: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', marginBottom: '4px', flexWrap: 'wrap' }}>
                <strong>{snap.symbol}</strong>
                {snap.compositeEwma !== null && (
                  <span style={{ fontSize: '0.75rem', color: snap.compositeEwma >= 0.5 ? 'var(--color-success)' : 'var(--color-error)' }}>
                    score: {(snap.compositeEwma * 100).toFixed(0)}%
                  </span>
                )}
                {snap.sentimentScore !== null && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    sentiment: {snap.sentimentScore >= 0 ? '+' : ''}{snap.sentimentScore.toFixed(2)}
                  </span>
                )}
                {optionsScore !== null && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    options: {optionsScore >= 0 ? '+' : ''}{optionsScore.toFixed(2)}
                  </span>
                )}
                {fundamentalsScore !== null && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    fundamentals: {fundamentalsScore >= 0 ? '+' : ''}{fundamentalsScore.toFixed(2)}
                  </span>
                )}
              </div>
              {snap.sentimentSynthesis && (
                <div style={{ fontSize: '0.875rem', fontStyle: 'italic' }}>{snap.sentimentSynthesis}</div>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function renderWatchlistCurationSummary(s: WatchlistCurationSummary, screenerSelections: ScreenerSelectionRow[]) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)' }}>
        <div><div className={styles.fieldLabel}>Total in Watchlist</div><div className={styles.fieldValue}>{s.totalInWatchlist}</div></div>
        <div><div className={styles.fieldLabel}>Screener Picks</div><div className={styles.fieldValue}>{s.screenerSelections}</div></div>
      </div>
      {s.symbolsAdded.length > 0 && (
        <div><div className={styles.fieldLabel}>Added</div><div className={styles.fieldValue}>{s.symbolsAdded.join(', ')}</div></div>
      )}
      {s.symbolsUpdated.length > 0 && (
        <div><div className={styles.fieldLabel}>Updated</div><div className={styles.fieldValue}>{s.symbolsUpdated.join(', ')}</div></div>
      )}
      {screenerSelections.length > 0 && (
        <div style={{ marginTop: 'var(--spacing-md)' }}>
          <div className={styles.fieldLabel}>AI Selections</div>
          {screenerSelections.map(sel => (
            <div key={sel.id} style={{ padding: 'var(--spacing-sm)', marginTop: 'var(--spacing-xs)', background: 'var(--color-bg-secondary)', borderRadius: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', marginBottom: '4px' }}>
                <strong>{sel.symbol}</strong>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>conviction: {Math.round(sel.conviction * 100)}%</span>
              </div>
              <div style={{ fontSize: '0.875rem' }}>{sel.rationale}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function renderTrancheExecutionSummary(s: TrancheExecutionSummary) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)' }}>
        <div><div className={styles.fieldLabel}>Regime</div><div className={styles.fieldValue}>{s.regime}</div></div>
        <div><div className={styles.fieldLabel}>Active Plans</div><div className={styles.fieldValue}>{s.activePlans}</div></div>
        <div><div className={styles.fieldLabel}>Tranches Executed</div><div className={styles.fieldValue}>{s.tranchesExecuted}</div></div>
        <div><div className={styles.fieldLabel}>Plans Paused</div><div className={styles.fieldValue}>{s.plansPaused}</div></div>
        <div><div className={styles.fieldLabel}>Plans Resumed</div><div className={styles.fieldValue}>{s.plansResumed}</div></div>
        <div><div className={styles.fieldLabel}>Auto Trim Plans</div><div className={styles.fieldValue}>{s.autoTrimPlans}</div></div>
      </div>
      {s.autoHedgePlan && (
        <div><div className={styles.fieldLabel}>Auto Hedge</div><div className={styles.fieldValue}>{s.autoHedgePlan.symbol}: {s.autoHedgePlan.shares} shares</div></div>
      )}
      {s.tranchesSkipped.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>Skipped ({s.tranchesSkipped.length})</summary>
          <ul style={{ margin: 'var(--spacing-sm) 0 0 var(--spacing-md)', fontSize: '0.875rem' }}>
            {s.tranchesSkipped.map((sk, i) => <li key={i}><strong>{sk.symbol}</strong>: {sk.reason}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<RunDetailData | null>(null);
  const [coverage, setCoverage] = useState<RunCoverageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [detailsBeforePrint, setDetailsBeforePrint] = useState<Set<string>>(new Set());
  const pageRef = useRef<HTMLDivElement>(null);
  const { addToast } = useToast();

  useEffect(() => {
    if (!id) return;
    runsApi.get(id)
      .then(res => setDetail(res.data))
      .catch(e => addToast(e instanceof Error ? e.message : 'Failed to load run', 'error'))
      .finally(() => setLoading(false));

    // Fetch coverage in parallel (optional, doesn't block rendering)
    runsApi.getCoverage(id)
      .then(res => setCoverage(res.data))
      .catch(e => console.warn('Failed to load coverage:', e instanceof Error ? e.message : 'Unknown error'));
  }, [id]);

  useEffect(() => {
    const handleBeforePrint = () => {
      // Save current state
      setDetailsBeforePrint(new Set(expanded));

      // Open all details and expand all messages
      const allDetails = pageRef.current?.querySelectorAll('details');
      if (allDetails) {
        allDetails.forEach(detail => {
          detail.open = true;
        });
      }

      // Expand all truncated messages
      setExpanded(new Set(detail?.messages.map(m => m.id) || []));
    };

    const handleAfterPrint = () => {
      // Restore prior state
      setExpanded(detailsBeforePrint);

      // Close details back to their prior state
      const allDetails = pageRef.current?.querySelectorAll('details');
      if (allDetails) {
        allDetails.forEach(detail => {
          const summary = detail.querySelector('summary');
          if (summary) {
            // Check if this was originally open by matching against saved state
            const key = (summary.textContent || '').slice(0, 50);
            // For safety, we close non-explicitly expanded ones
            if (detail.parentElement?.className.includes('section')) {
              detail.open = false;
            }
          }
        });
      }
    };

    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);

    // Safari fallback using matchMedia
    const printMediaQuery = window.matchMedia('print');
    let wasPrinting = false;
    printMediaQuery.addEventListener('change', (e) => {
      if (e.matches && !wasPrinting) {
        wasPrinting = true;
        handleBeforePrint();
      } else if (!e.matches && wasPrinting) {
        wasPrinting = false;
        handleAfterPrint();
      }
    });

    return () => {
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
      printMediaQuery.removeEventListener('change', () => {});
    };
  }, [detail?.messages, detailsBeforePrint]);

  function toggleExpanded(msgId: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  }

  function generateRunMarkdown(
    run: AgentRunRow,
    summary: PlanReviewSummary | SignalCollectionSummary | WatchlistCurationSummary | TrancheExecutionSummary | null,
    assessments: any[],
    decisions: any[],
    orders: any[],
    messages: AgentMessageRow[],
    artifacts: ResearchArtifactRow[],
    coverage: RunCoverageData | null,
    tokenUsage: Record<string, unknown> | null,
    jobType: JobType,
    screenerSelections: ScreenerSelectionRow[],
    signalSnapshots: SignalSnapshotRow[],
    rejections: any[]
  ): string {
    const lines: string[] = [];

    lines.push(`# Run Detail: ${run.id}`);
    lines.push('');

    // Header info
    lines.push('## Run Information');
    lines.push(`- **Status:** ${run.status}`);
    lines.push(`- **Job Type:** ${JOB_TYPE_LABELS[jobType]}`);
    lines.push(`- **Trigger:** ${run.trigger}`);
    lines.push(`- **Started:** ${formatTimestamp(run.startedAt)}`);
    lines.push(`- **Duration:** ${formatDuration(run.startedAt, run.finishedAt)}`);
    if (run.error) lines.push(`- **Error:** ${run.error}`);
    if (run.skipReason) lines.push(`- **Skip Reason:** ${run.skipReason}`);
    lines.push('');

    // Token usage
    if (tokenUsage) {
      lines.push('## LLM Telemetry');
      const totalTokens = (tokenUsage as any)?.total_tokens;
      const promptTokens = (tokenUsage as any)?.prompt_tokens;
      const completionTokens = (tokenUsage as any)?.completion_tokens;
      const models = (tokenUsage as any)?.models;
      const tokens = (tokenUsage as any)?.tokens;
      const cost = (tokenUsage as any)?.cost;
      const latency = (tokenUsage as any)?.latency_ms;

      if (promptTokens !== undefined) {
        lines.push(`- **Prompt Tokens:** ${promptTokens?.toLocaleString()}`);
        lines.push(`- **Completion Tokens:** ${completionTokens?.toLocaleString()}`);
        lines.push(`- **Total Tokens:** ${totalTokens?.toLocaleString()}`);
      }
      if (models) {
        lines.push(`- **Analyst Model:** ${models.analyst}`);
        lines.push(`- **Portfolio Manager Model:** ${models.portfolioManager}`);
      }
      if (cost) {
        lines.push(`- **Analyst Cost:** $${cost.analyst?.toFixed(4)}`);
        lines.push(`- **Portfolio Manager Cost:** $${cost.portfolioManager?.toFixed(4)}`);
        lines.push(`- **Total Cost:** $${cost.total?.toFixed(4)}`);
      }
      if (latency) {
        lines.push(`- **Analyst Latency:** ${latency.analyst}ms`);
        lines.push(`- **Portfolio Manager Latency:** ${latency.portfolioManager}ms`);
        lines.push(`- **Total Latency:** ${latency.total}ms`);
      }
      lines.push('');
    }

    // Strategic Run Summary
    if (jobType === 'plan_review' && summary) {
      const s = summary as PlanReviewSummary;
      lines.push('## Plan Review Summary');
      lines.push(`- **Regime:** ${s.regime}`);
      lines.push(`- **Watchlist:** ${s.watchlistCount} symbols`);
      lines.push(`- **Monitored Positions:** ${s.positionsCount}`);
      lines.push(`- **Accumulate Plans:** ${s.plansCreated}`);
      lines.push(`- **Trim Plans:** ${s.trimPlansCreated}`);
      lines.push(`- **Existing Active Plans:** ${s.existingActivePlans}`);

      if (s.symbolsPruned && s.symbolsPruned.length > 0) {
        lines.push(`- **Pruned Symbols:** ${s.symbolsPruned.join(', ')}`);
      }
      lines.push('');
    } else if (jobType === 'signal_collection' && summary) {
      const s = summary as SignalCollectionSummary;
      lines.push('## Signal Collection Summary');
      lines.push(`- **Symbols Updated:** ${s.symbolsUpdated}`);
      lines.push(`- **Errors:** ${s.errors}`);
      if (s.tokensUsed > 0) {
        lines.push(`- **Tokens Used:** ${s.tokensUsed.toLocaleString()}`);
      }

      if (signalSnapshots.length > 0) {
        lines.push('');
        lines.push('### Signal Analysis');
        signalSnapshots.forEach(snap => {
          lines.push(`- **${snap.symbol}**`);
          if (snap.compositeEwma !== null) {
            lines.push(`  - Composite Score: ${(snap.compositeEwma * 100).toFixed(0)}%`);
          }
          if (snap.sentimentScore !== null) {
            lines.push(`  - Sentiment: ${snap.sentimentScore >= 0 ? '+' : ''}${snap.sentimentScore.toFixed(2)}`);
          }
          if (snap.sentimentSynthesis) {
            lines.push(`  - ${snap.sentimentSynthesis}`);
          }
        });
      }
      lines.push('');
    } else if (jobType === 'watchlist_curation' && summary) {
      const s = summary as WatchlistCurationSummary;
      lines.push('## Watchlist Curation Summary');
      lines.push(`- **Total in Watchlist:** ${s.totalInWatchlist}`);
      lines.push(`- **Screener Picks:** ${s.screenerSelections}`);
      if (s.symbolsAdded.length > 0) {
        lines.push(`- **Added:** ${s.symbolsAdded.join(', ')}`);
      }
      if (s.symbolsUpdated.length > 0) {
        lines.push(`- **Updated:** ${s.symbolsUpdated.join(', ')}`);
      }

      if (screenerSelections.length > 0) {
        lines.push('');
        lines.push('### AI Selections');
        screenerSelections.forEach(sel => {
          lines.push(`- **${sel.symbol}** (${Math.round(sel.conviction * 100)}% conviction)`);
          lines.push(`  - ${sel.rationale}`);
        });
      }
      lines.push('');
    } else if (jobType === 'tranche_execution' && summary) {
      const s = summary as TrancheExecutionSummary;
      lines.push('## Tranche Execution Summary');
      lines.push(`- **Regime:** ${s.regime}`);
      lines.push(`- **Active Plans:** ${s.activePlans}`);
      lines.push(`- **Tranches Executed:** ${s.tranchesExecuted}`);
      lines.push(`- **Plans Paused:** ${s.plansPaused}`);
      lines.push(`- **Plans Resumed:** ${s.plansResumed}`);
      lines.push(`- **Auto Trim Plans:** ${s.autoTrimPlans}`);
      if (s.autoHedgePlan) {
        lines.push(`- **Auto Hedge:** ${s.autoHedgePlan.symbol} ${s.autoHedgePlan.shares} shares`);
      }
      lines.push('');
    }

    // Coverage heatmap
    if (coverage && jobType === 'trading_cycle') {
      lines.push('## Coverage');
      if (coverage.belowThreshold) {
        lines.push(`⚠️ **Below ${coverage.thresholdPercent}% threshold**`);
      }
      if (coverage.matrix && coverage.matrix.length > 0) {
        lines.push('');
        lines.push('| Symbol | Coverage % |');
        lines.push('|--------|-----------|');
        coverage.matrix.forEach(row => {
          const pct = row.coveragePercent !== null ? row.coveragePercent.toFixed(1) : 'N/A';
          lines.push(`| ${row.symbol} | ${pct}% |`);
        });
      }
      lines.push('');
    }

    // Assessments
    if (assessments.length > 0) {
      lines.push('## Assessments');
      assessments.forEach(a => {
        lines.push(`### ${a.symbol}`);
        lines.push(`- **Score:** ${a.score}/5`);
        lines.push(`- **Confidence:** ${Math.round(a.confidence * 100)}%`);
        lines.push(`- **Thesis:** ${a.thesis}`);
        if (a.risks) lines.push(`- **Risks:** ${a.risks}`);
        if (a.catalysts) lines.push(`- **Catalysts:** ${a.catalysts}`);
        lines.push('');
      });
    }

    // Decisions
    if (decisions.length > 0) {
      lines.push('## Decisions');
      decisions.forEach(d => {
        lines.push(`### ${d.symbol}`);
        lines.push(`- **Action:** ${d.action}`);
        if (d.targetWeight != null) lines.push(`- **Target Weight:** ${Math.round(d.targetWeight * 100)}%`);
        lines.push(`- **Confidence:** ${Math.round(d.confidence * 100)}%`);
        lines.push(`- **Rationale:** ${d.rationale}`);
        lines.push('');
      });
    }

    // Orders
    if (orders.length > 0) {
      lines.push('## Orders');
      orders.forEach(o => {
        lines.push(`### ${o.symbol}`);
        lines.push(`- **Side:** ${o.side}`);
        lines.push(`- **Status:** ${o.status}`);
        lines.push(`- **Quantity:** ${formatQty(o.qty)}`);
        lines.push(`- **Type:** ${o.type}`);
        lines.push(`- **Submitted:** ${formatTimestamp(o.submittedAt)}`);

        if (o.fills && o.fills.length > 0) {
          lines.push('');
          lines.push('| Date | Qty | Price | Fee |');
          lines.push('|------|-----|-------|-----|');
          o.fills.forEach(f => {
            lines.push(`| ${f.barDate} | ${formatQty(f.qty)} | ${centsToUSD(f.priceCents)} | ${centsToUSD(f.feeCents)} |`);
          });
        }
        lines.push('');
      });
    }

    // Rejected Decisions
    if (rejections && rejections.length > 0) {
      lines.push('## Rejected Decisions');
      rejections.forEach(r => {
        lines.push(`### ${r.symbol}`);
        lines.push(`- **Action:** ${r.action}`);
        lines.push(`- **Rejection Reason:** ${r.rejectionReason}`);
        if (r.rationale) lines.push(`- **Rationale:** ${r.rationale}`);
        lines.push('');
      });
    }

    // Messages/Transcript
    if (messages.length > 0) {
      lines.push('## Transcript');
      const msgGroups = new Map<string, AgentMessageRow[]>();
      for (const m of messages) {
        const key = m.symbol ?? '__portfolio__';
        if (!msgGroups.has(key)) msgGroups.set(key, []);
        msgGroups.get(key)!.push(m);
      }

      Array.from(msgGroups.entries()).forEach(([key, msgs]) => {
        lines.push(`### ${key === '__portfolio__' ? 'Portfolio Manager' : key === 'screener' ? 'Screener Agent' : key}`);
        msgs.forEach(m => {
          lines.push('');
          lines.push(`**${m.role.toUpperCase()}**${m.toolName ? ` (${m.toolName})` : ''}`);
          lines.push('```');
          lines.push(m.content);
          lines.push('```');
        });
        lines.push('');
      });
    }

    // Artifacts
    if (artifacts.length > 0) {
      lines.push('## Research Artifacts');
      const artifactGroups = new Map<string, ResearchArtifactRow[]>();
      for (const a of artifacts) {
        const key = a.symbol ?? '__portfolio__';
        if (!artifactGroups.has(key)) artifactGroups.set(key, []);
        artifactGroups.get(key)!.push(a);
      }

      Array.from(artifactGroups.entries()).forEach(([key, arts]) => {
        lines.push(`### ${key === '__portfolio__' ? 'General' : key}`);
        arts.forEach(a => {
          lines.push(`**${a.source}** (${a.provider})`);
          if (a.summary) lines.push(a.summary);
          let citations: string[] = [];
          try { if (a.citationsJson) citations = JSON.parse(a.citationsJson); } catch {}
          if (citations.length > 0) {
            lines.push(`*Citations: ${citations.join(' · ')}*`);
          }
          lines.push('');
        });
      });
    }

    return lines.join('\n');
  }

  function handleMarkdownDownload() {
    const markdown = generateRunMarkdown(
      run,
      summary,
      assessments,
      decisions,
      orders,
      messages,
      artifacts,
      coverage,
      tokenUsage,
      jobType,
      screenerSelections,
      signalSnapshots,
      detail!.rejections
    );

    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `run-${run.id || 'detail'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <p>Loading…</p>;
  if (!detail) return <p>Run not found.</p>;

  const { run, assessments, decisions, orders, messages, artifacts, screenerSelections, signalSnapshots } = detail;
  const jobType = inferJobType(run);
  const isStrategicRun = jobType !== 'trading_cycle';

  let tokenUsage: Record<string, unknown> | null = null;
  try { if (run.tokenUsageJson) tokenUsage = JSON.parse(run.tokenUsageJson); } catch {}

  let summary: PlanReviewSummary | SignalCollectionSummary | WatchlistCurationSummary | TrancheExecutionSummary | null = null;
  try { if (run.summaryJson) summary = JSON.parse(run.summaryJson); } catch {}

  // Group messages by symbol
  const msgGroups = new Map<string, AgentMessageRow[]>();
  for (const m of messages) {
    const key = m.symbol ?? '__portfolio__';
    if (!msgGroups.has(key)) msgGroups.set(key, []);
    msgGroups.get(key)!.push(m);
  }

  // Group artifacts by symbol
  const artifactGroups = new Map<string, ResearchArtifactRow[]>();
  for (const a of artifacts) {
    const key = a.symbol ?? '__portfolio__';
    if (!artifactGroups.has(key)) artifactGroups.set(key, []);
    artifactGroups.get(key)!.push(a);
  }

  return (
    <div ref={pageRef}>
      <div className={styles.detailHeader}>
        <Link to="/job-history" className={styles.backLink}>← Back to Job History</Link>
        <div className={styles.detailActions}>
          <button onClick={() => window.print()} className={styles.printBtn} title="Print" aria-label="Print">🖨</button>
          <button onClick={() => handleMarkdownDownload()} className={styles.printBtn} title="Download as Markdown" aria-label="Download as Markdown">⬇️</button>
        </div>
      </div>
      <h1>Run Detail</h1>

      {/* Summary */}
      <div className={styles.symbolCard} style={{ marginBottom: 'var(--spacing-lg)' }}>
        <div className={styles.symbolHeader}>
          <span className={badgeClass(run.status, styles)}>{run.status}</span>
          <span className={styles.badgeGray}>{JOB_TYPE_LABELS[jobType]}</span>
          <span className={styles.muted}>{run.trigger}</span>
          {!isStrategicRun && coverage && coverage.belowThreshold && <span className={styles.badgeRed}>Coverage below {coverage.thresholdPercent}%</span>}
        </div>
        <div className={styles.fieldLabel}>Run ID</div>
        <div className={styles.fieldValue} style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{run.id}</div>
        <div className={styles.fieldLabel}>Started</div>
        <div className={styles.fieldValue}>{formatTimestamp(run.startedAt)}</div>
        <div className={styles.fieldLabel}>Duration</div>
        <div className={styles.fieldValue}>{formatDuration(run.startedAt, run.finishedAt)}</div>
        {tokenUsage && (() => {
          const models = (tokenUsage as any)?.models;
          const tokens = (tokenUsage as any)?.tokens;
          const cost = (tokenUsage as any)?.cost;
          const latency = (tokenUsage as any)?.latency_ms;
          // Simple format: { total_tokens, prompt_tokens, completion_tokens }
          const totalTokens = (tokenUsage as any)?.total_tokens;
          const promptTokens = (tokenUsage as any)?.prompt_tokens;
          const completionTokens = (tokenUsage as any)?.completion_tokens;
          
          const hasDetailedFormat = models || tokens || cost || latency;
          const hasSimpleFormat = totalTokens !== undefined;
          
          if (!hasDetailedFormat && !hasSimpleFormat) return null;
          
          return (
            <>
              <div className={styles.fieldLabel}>LLM Telemetry</div>
              <div className={styles.fieldValue}>
                <div style={{ fontSize: '0.85rem', lineHeight: '1.5' }}>
                  {hasSimpleFormat && !hasDetailedFormat && (
                    <div>
                      <strong>Tokens:</strong> {promptTokens?.toLocaleString()} in / {completionTokens?.toLocaleString()} out ({totalTokens?.toLocaleString()} total)
                    </div>
                  )}
                  {models && (
                    <div>
                      <strong>Models:</strong><br/>
                      Analyst: {models.analyst}, Portfolio Manager: {models.portfolioManager}
                    </div>
                  )}
                  {tokens && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <strong>Tokens:</strong><br/>
                      Analyst: {tokens.analyst?.input} in / {tokens.analyst?.output} out
                      <br/>
                      Portfolio Manager: {tokens.portfolioManager?.input} in / {tokens.portfolioManager?.output} out
                    </div>
                  )}
                  {cost && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <strong>Cost:</strong><br/>
                      Analyst: ${cost.analyst?.toFixed(4)}, Portfolio Manager: ${cost.portfolioManager?.toFixed(4)}, Total: ${cost.total?.toFixed(4)}
                    </div>
                  )}
                  {latency && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <strong>Latency:</strong><br/>
                      Analyst: {latency.analyst}ms, Portfolio Manager: {latency.portfolioManager}ms, Total: {latency.total}ms
                    </div>
                  )}
                </div>
              </div>
            </>
          );
        })()}
        {run.error && <><div className={styles.fieldLabel}>Error</div><div className={styles.fieldValue} style={{ color: 'var(--color-error)' }}>{run.error}</div></>}
        {run.skipReason && <><div className={styles.fieldLabel}>Skip Reason</div><div className={styles.fieldValue}>{run.skipReason}</div></>}
      </div>

      {/* Strategic Run Summary */}
      {isStrategicRun && summary && (
        <div className={styles.symbolCard} style={{ marginBottom: 'var(--spacing-lg)' }}>
          <div className={styles.fieldLabel}>Job Summary</div>
          {jobType === 'plan_review' && renderPlanReviewSummary(summary as PlanReviewSummary)}
          {jobType === 'signal_collection' && renderSignalCollectionSummary(summary as SignalCollectionSummary, signalSnapshots)}
          {jobType === 'watchlist_curation' && renderWatchlistCurationSummary(summary as WatchlistCurationSummary, screenerSelections)}
          {jobType === 'tranche_execution' && renderTrancheExecutionSummary(summary as TrancheExecutionSummary)}
        </div>
      )}

      {/* Coverage Heatmap - only for trading cycle runs */}
      {!isStrategicRun && coverage && (
        <div className={styles.symbolCard} style={{ marginBottom: 'var(--spacing-lg)' }}>
          <CoverageHeatmap coverage={coverage} />
        </div>
      )}

      {/* Assessments - only for trading cycle runs */}
      {!isStrategicRun && (
        <div className={styles.section}>
          <details open>
            <summary>Assessments ({assessments.length})</summary>
            {assessments.map(a => {
              let evidenceIds: string[] = [];
              try { if (a.evidenceIdsJson) evidenceIds = JSON.parse(a.evidenceIdsJson); } catch {}
              return (
                <div key={a.id} className={styles.symbolCard}>
                  <div className={styles.symbolHeader}>
                    <strong>{a.symbol}</strong>
                    <span className={a.score >= 0 ? styles.scorePositive : styles.scoreNegative}>{a.score}/5</span>
                    <span className={styles.muted}>confidence: {Math.round(a.confidence * 100)}%</span>
                  </div>
                  <div className={styles.fieldLabel}>Thesis</div>
                  <div className={styles.fieldValue}>{a.thesis}</div>
                  {a.risks && <><div className={styles.fieldLabel}>Risks</div><div className={styles.fieldValue}>{a.risks}</div></>}
                  {a.catalysts && <><div className={styles.fieldLabel}>Catalysts</div><div className={styles.fieldValue}>{a.catalysts}</div></>}
                  {evidenceIds.length > 0 && (
                    <><div className={styles.fieldLabel}>Evidence</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {evidenceIds.map(id => <span key={id} className={styles.badgeGray} style={{ fontSize: '0.7rem', fontFamily: 'monospace' }}>{id.slice(0, 8)}</span>)}
                    </div></>
                  )}
                </div>
              );
            })}
            {assessments.length === 0 && <p className={styles.muted}>No assessments.</p>}
          </details>
        </div>
      )}

      {/* Decisions - only for trading cycle runs */}
      {!isStrategicRun && (
        <div className={styles.section}>
          <details open>
            <summary>Decisions ({decisions.length})</summary>
            {decisions.map(d => (
              <div key={d.id} className={styles.symbolCard}>
                <div className={styles.symbolHeader}>
                  <strong>{d.symbol}</strong>
                  <span className={actionBadge(d.action, styles)}>{d.action}</span>
                  {d.targetWeight != null && <span className={styles.muted}>target: {Math.round(d.targetWeight * 100)}%</span>}
                  <span className={styles.muted}>confidence: {Math.round(d.confidence * 100)}%</span>
                </div>
                <div className={styles.fieldLabel}>Rationale</div>
                <div className={styles.fieldValue}>{d.rationale}</div>
              </div>
            ))}
            {decisions.length === 0 && <p className={styles.muted}>No decisions.</p>}
          </details>
        </div>
      )}

      {/* Orders - only for trading cycle runs */}
      {!isStrategicRun && (
        <div className={styles.section}>
          <details open>
            <summary>Orders ({orders.length})</summary>
            {orders.map(o => (
              <div key={o.id} className={styles.symbolCard}>
                <div className={styles.symbolHeader}>
                  <strong>{o.symbol}</strong>
                  <span className={o.side === 'buy' ? styles.badgeGreen : styles.badgeRed}>{o.side}</span>
                  <span className={styles.badgeGray}>{o.status}</span>
                  <span className={styles.muted}>qty: {formatQty(o.qty)} · {o.type}</span>
                </div>
                <div className={styles.muted} style={{ fontSize: '0.8rem', marginBottom: 'var(--spacing-sm)' }}>
                  Submitted: {formatTimestamp(o.submittedAt)}
                </div>
                {o.fills && o.fills.length > 0 && (
                  <table className={styles.fillsTable}>
                    <thead>
                      <tr>
                        <th className={styles.th}>Date</th>
                        <th className={styles.th}>Qty</th>
                        <th className={styles.th}>Price</th>
                        <th className={styles.th}>Fee</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.fills.map(f => (
                        <tr key={f.id}>
                          <td className={styles.td}>{f.barDate}</td>
                          <td className={styles.td}>{formatQty(f.qty)}</td>
                          <td className={styles.td}>{centsToUSD(f.priceCents)}</td>
                          <td className={styles.td}>{centsToUSD(f.feeCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
            {orders.length === 0 && <p className={styles.muted}>No orders.</p>}
          </details>
        </div>
      )}

      {/* Rejected Decisions - only for trading cycle runs */}
      {!isStrategicRun && <RejectedDecisions rejections={detail.rejections} />}

      {/* Transcript — collapsed by default, show for any run with messages */}
      {messages.length > 0 && (
        <div className={styles.section}>
          <details>
            <summary>Transcript ({messages.length} messages)</summary>
            <div className={styles.transcript}>
              {Array.from(msgGroups.entries()).map(([key, msgs]) => (
                <details key={key} open style={{ marginBottom: 'var(--spacing-md)' }}>
                  <summary>{key === '__portfolio__' ? 'Portfolio Manager' : key === 'screener' ? 'Screener Agent' : key}</summary>
                  {msgs.map(m => {
                    const isExpanded = expanded.has(m.id);
                    const content = m.content;
                    const truncated = content.length > 500 && !isExpanded;
                    return (
                      <div key={m.id} className={styles.messageBlock}>
                        <span className={roleBadge(m.role, styles)}>{m.role}</span>
                        <div className={styles.messageContent}>
                          {m.toolName && <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: 4 }}>{m.toolName}</div>}
                          <pre>{truncated ? content.slice(0, 500) + '…' : content}</pre>
                          {content.length > 500 && (
                            <button onClick={() => toggleExpanded(m.id)} className={styles.showMoreBtn} style={{ fontSize: '0.75rem', background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', padding: 0, marginTop: 4 }}>
                              {isExpanded ? 'show less' : 'show more'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </details>
              ))}
            </div>
          </details>
        </div>
      )}

      {/* Artifacts - show for any run with artifacts */}
      {artifacts.length > 0 && (
        <div className={styles.section}>
          <details>
            <summary>Research Artifacts ({artifacts.length})</summary>
            {Array.from(artifactGroups.entries()).map(([key, arts]) => (
              <div key={key} style={{ marginBottom: 'var(--spacing-md)' }}>
                <h3 style={{ fontSize: '0.875rem', marginBottom: 'var(--spacing-sm)' }}>{key === '__portfolio__' ? 'General' : key}</h3>
                {arts.map(a => {
                  let citations: string[] = [];
                  try { if (a.citationsJson) citations = JSON.parse(a.citationsJson); } catch {}
                  return (
                    <div key={a.id} className={styles.symbolCard}>
                      <div className={styles.symbolHeader}>
                        <span className={styles.badgeGray}>{a.source}</span>
                        <span className={styles.muted}>{a.provider}</span>
                      </div>
                      {a.summary && <div className={styles.fieldValue}>{a.summary}</div>}
                      {citations.length > 0 && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                          Citations: {citations.join(' · ')}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </details>
        </div>
      )}
    </div>
  );
}
