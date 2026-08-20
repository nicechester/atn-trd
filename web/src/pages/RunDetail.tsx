import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { runs as runsApi, type RunDetailData, type AgentRunRow, type DecisionRow, type AgentMessageRow, type ResearchArtifactRow, type RunCoverageData } from '../api/client';
import { centsToUSD, formatTimestamp, formatDuration } from '../lib/format';
import { useToast } from '../context/ToastContext';
import CoverageHeatmap from '../components/CoverageHeatmap';
import styles from './RunDetail.module.css';

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

  let tokenUsage: Record<string, number> | null = null;
  try { if (run.tokenUsageJson) tokenUsage = JSON.parse(run.tokenUsageJson); } catch {}

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
          {coverage && coverage.belowThreshold && <span className={styles.badgeRed}>Coverage below {coverage.thresholdPercent}%</span>}
        </div>
        <div className={styles.fieldLabel}>Run ID</div>
        <div className={styles.fieldValue} style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{run.id}</div>
        <div className={styles.fieldLabel}>Started</div>
        <div className={styles.fieldValue}>{formatTimestamp(run.startedAt)}</div>
        <div className={styles.fieldLabel}>Duration</div>
        <div className={styles.fieldValue}>{formatDuration(run.startedAt, run.finishedAt)}</div>
        {run.model && <><div className={styles.fieldLabel}>Model</div><div className={styles.fieldValue}>{run.model}</div></>}
        {tokenUsage && (
          <><div className={styles.fieldLabel}>Tokens</div>
          <div className={styles.fieldValue}>{JSON.stringify(tokenUsage)}</div></>
        )}
        {run.error && <><div className={styles.fieldLabel}>Error</div><div className={styles.fieldValue} style={{ color: 'var(--color-error)' }}>{run.error}</div></>}
        {run.skipReason && <><div className={styles.fieldLabel}>Skip Reason</div><div className={styles.fieldValue}>{run.skipReason}</div></>}
      </div>

      {/* Coverage Heatmap */}
      {coverage && (
        <div className={styles.symbolCard} style={{ marginBottom: 'var(--spacing-lg)' }}>
          <CoverageHeatmap coverage={coverage} />
        </div>
      )}

      {/* Assessments */}
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

      {/* Decisions */}
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

      {/* Orders */}
      <div className={styles.section}>
        <details open>
          <summary>Orders ({orders.length})</summary>
          {orders.map(o => (
            <div key={o.id} className={styles.symbolCard}>
              <div className={styles.symbolHeader}>
                <strong>{o.symbol}</strong>
                <span className={o.side === 'buy' ? styles.badgeGreen : styles.badgeRed}>{o.side}</span>
                <span className={styles.badgeGray}>{o.status}</span>
                <span className={styles.muted}>qty: {o.qty} · {o.type}</span>
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
                        <td className={styles.td}>{f.qty}</td>
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

      {/* Transcript — collapsed by default */}
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

      {/* Artifacts */}
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
    </div>
  );
}
