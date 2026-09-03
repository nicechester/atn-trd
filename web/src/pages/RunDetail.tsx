import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { runs as runsApi, type RunDetailData, type AgentRunRow, type DecisionRow, type AgentMessageRow, type ResearchArtifactRow, type RunCoverageData, type PlanReviewSummary, type SignalCollectionSummary, type WatchlistCurationSummary } from '../api/client';
import { centsToUSD, formatTimestamp, formatDuration, formatQty } from '../lib/format';
import { useToast } from '../context/ToastContext';
import CoverageHeatmap from '../components/CoverageHeatmap';
import { RejectedDecisions } from '../components/RejectedDecisions';
import styles from './RunDetail.module.css';

// Strategic job triggers that use summaryJson instead of assessments/decisions
const STRATEGIC_TRIGGERS = ['plan_review', 'signal_collection', 'watchlist_curation', 'tranche_execution'];

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
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)' }}>
        <div><div className={styles.fieldLabel}>Regime</div><div className={styles.fieldValue}>{s.regime}</div></div>
        <div><div className={styles.fieldLabel}>Watchlist</div><div className={styles.fieldValue}>{s.watchlistCount} symbols</div></div>
        <div><div className={styles.fieldLabel}>Plans Created</div><div className={styles.fieldValue}>{s.plansCreated}</div></div>
        <div><div className={styles.fieldLabel}>Existing Active</div><div className={styles.fieldValue}>{s.existingActivePlans}</div></div>
      </div>
      {s.plansSkipped.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>Skipped ({s.plansSkipped.length})</summary>
          <ul style={{ margin: 'var(--spacing-sm) 0 0 var(--spacing-md)', fontSize: '0.875rem' }}>
            {s.plansSkipped.map((sk, i) => <li key={i}><strong>{sk.symbol}</strong>: {sk.reason}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function renderSignalCollectionSummary(s: SignalCollectionSummary) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)' }}>
        <div><div className={styles.fieldLabel}>Symbols Updated</div><div className={styles.fieldValue}>{s.symbolsUpdated}</div></div>
        <div><div className={styles.fieldLabel}>Errors</div><div className={styles.fieldValue}>{s.errors}</div></div>
      </div>
      {s.symbols.length > 0 && (
        <div><div className={styles.fieldLabel}>Symbols</div><div className={styles.fieldValue}>{s.symbols.join(', ')}</div></div>
      )}
    </div>
  );
}

function renderWatchlistCurationSummary(s: WatchlistCurationSummary) {
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
    </div>
  );
}

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<RunDetailData | null>(null);
  const [coverage, setCoverage] = useState<RunCoverageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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

  function toggleExpanded(msgId: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  }

  if (loading) return <p>Loading…</p>;
  if (!detail) return <p>Run not found.</p>;

  const { run, assessments, decisions, orders, messages, artifacts } = detail;
  const isStrategicRun = STRATEGIC_TRIGGERS.includes(run.trigger);

  let tokenUsage: Record<string, unknown> | null = null;
  try { if (run.tokenUsageJson) tokenUsage = JSON.parse(run.tokenUsageJson); } catch {}

  let summary: PlanReviewSummary | SignalCollectionSummary | WatchlistCurationSummary | null = null;
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
    <div>
      <Link to="/runs" className={styles.backLink}>← Back to Runs</Link>
      <h1>Run Detail</h1>

      {/* Summary */}
      <div className={styles.symbolCard} style={{ marginBottom: 'var(--spacing-lg)' }}>
        <div className={styles.symbolHeader}>
          <span className={badgeClass(run.status, styles)}>{run.status}</span>
          <span className={styles.badgeGray}>{run.trigger}</span>
          {!isStrategicRun && coverage && coverage.belowThreshold && <span className={styles.badgeRed}>Coverage below {coverage.thresholdPercent}%</span>}
        </div>
        <div className={styles.fieldLabel}>Run ID</div>
        <div className={styles.fieldValue} style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{run.id}</div>
        <div className={styles.fieldLabel}>Started</div>
        <div className={styles.fieldValue}>{formatTimestamp(run.startedAt)}</div>
        <div className={styles.fieldLabel}>Duration</div>
        <div className={styles.fieldValue}>{formatDuration(run.startedAt, run.finishedAt)}</div>
        {tokenUsage && (
          <>
            <div className={styles.fieldLabel}>LLM Telemetry</div>
            <div className={styles.fieldValue}>
              {(() => {
                const models = (tokenUsage as any)?.models;
                const tokens = (tokenUsage as any)?.tokens;
                const cost = (tokenUsage as any)?.cost;
                const latency = (tokenUsage as any)?.latency_ms;
                return (
                  <div style={{ fontSize: '0.85rem', lineHeight: '1.5' }}>
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
                );
              })()}
            </div>
          </>
        )}
        {run.error && <><div className={styles.fieldLabel}>Error</div><div className={styles.fieldValue} style={{ color: 'var(--color-error)' }}>{run.error}</div></>}
        {run.skipReason && <><div className={styles.fieldLabel}>Skip Reason</div><div className={styles.fieldValue}>{run.skipReason}</div></>}
      </div>

      {/* Strategic Run Summary */}
      {isStrategicRun && summary && (
        <div className={styles.symbolCard} style={{ marginBottom: 'var(--spacing-lg)' }}>
          <div className={styles.fieldLabel}>Job Summary</div>
          {run.trigger === 'plan_review' && renderPlanReviewSummary(summary as PlanReviewSummary)}
          {run.trigger === 'signal_collection' && renderSignalCollectionSummary(summary as SignalCollectionSummary)}
          {run.trigger === 'watchlist_curation' && renderWatchlistCurationSummary(summary as WatchlistCurationSummary)}
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
                {o.fills.length > 0 && (
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

      {/* Transcript — collapsed by default, only for trading cycle runs */}
      {!isStrategicRun && (
        <div className={styles.section}>
          <details>
            <summary>Transcript ({messages.length} messages)</summary>
            <div className={styles.transcript}>
              {Array.from(msgGroups.entries()).map(([key, msgs]) => (
                <details key={key} open style={{ marginBottom: 'var(--spacing-md)' }}>
                  <summary>{key === '__portfolio__' ? 'Portfolio Manager' : key}</summary>
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
                            <button onClick={() => toggleExpanded(m.id)} style={{ fontSize: '0.75rem', background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', padding: 0, marginTop: 4 }}>
                              {isExpanded ? 'show less' : 'show more'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </details>
              ))}
              {messages.length === 0 && <p className={styles.muted}>No messages.</p>}
            </div>
          </details>
        </div>
      )}

      {/* Artifacts - only for trading cycle runs */}
      {!isStrategicRun && (
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
            {artifacts.length === 0 && <p className={styles.muted}>No artifacts.</p>}
          </details>
        </div>
      )}
    </div>
  );
}
