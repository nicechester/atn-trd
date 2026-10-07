import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Card } from './Card';

interface LlmTelemetry {
  models: { analyst: string; portfolioManager?: string; screener?: string };
  tokens: {
    analyst: { input: number; output: number };
    portfolioManager?: { input: number; output: number };
    screener?: { input: number; output: number };
  };
  cost: { analyst: number; portfolioManager?: number; screener?: number; total: number };
  latency_ms: { analyst: number; portfolioManager?: number; screener?: number; total: number };
}

interface WeeklyCost {
  weekStart: string;
  weekEnd: string;
  total: number;
}

export default function LlmUsagePane(): JSX.Element | null {
  const [strategicMode, setStrategicMode] = useState<boolean | null>(null);
  const [signalsUseLlm, setSignalsUseLlm] = useState<boolean>(true);
  const [llmModel, setLlmModel] = useState<string | null>(null);
  const [weeklyCosts, setWeeklyCosts] = useState<WeeklyCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        // Check if strategic execution is enabled and get LLM model
        const settingsRes = await api.settings.get();
        const isStrategic = settingsRes.data.execution?.enabled ?? false;
        const model = settingsRes.data.llm?.model ?? null;
        const useLlm = settingsRes.data.signals?.useLlm ?? true;
        setStrategicMode(isStrategic);
        setLlmModel(model);
        setSignalsUseLlm(useLlm);

        // Fetch last 200 runs to get telemetry data (covers ~4 weeks)
        const res = await api.runs.list(200, 0);
        const runs = res.data;

        const costByWeek: Record<string, { total: number; weekStart: Date; weekEnd: Date }> = {};

        for (const run of runs) {
          if (!run.tokenUsageJson) continue;

          let telemetry: LlmTelemetry | null = null;
          try {
            telemetry = JSON.parse(run.tokenUsageJson);
          } catch {
            continue;
          }

          if (!telemetry || !telemetry.cost) continue;

          // Aggregate costs by week
          if (run.finishedAt) {
            const runDate = new Date(run.finishedAt);
            // Get Monday of this week (weekStart)
            const dayOfWeek = runDate.getUTCDay();
            const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
            const weekStart = new Date(runDate);
            weekStart.setUTCDate(runDate.getUTCDate() - daysSinceMonday);
            weekStart.setUTCHours(0, 0, 0, 0);

            // Sunday is end of week
            const weekEnd = new Date(weekStart);
            weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
            weekEnd.setUTCHours(23, 59, 59, 999);

            const weekKey = weekStart.toISOString().split('T')[0];
            if (!costByWeek[weekKey]) {
              costByWeek[weekKey] = { total: 0, weekStart, weekEnd };
            }
            costByWeek[weekKey].total += telemetry.cost.total || 0;
          }
        }

        // Convert costByWeek to sorted array (last 4 weeks)
        const sorted = Object.entries(costByWeek)
          .map(([, costs]) => ({
            weekStart: costs.weekStart.toISOString().split('T')[0],
            weekEnd: costs.weekEnd.toISOString().split('T')[0],
            total: costs.total,
          }))
          .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
          .slice(-4);

        setWeeklyCosts(sorted);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  if (loading) return null;
  if (error) return <Card title="System Mode"><p style={{ color: 'var(--color-error)' }}>{error}</p></Card>;

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 'var(--spacing-md)',
    marginBottom: 'var(--spacing-lg)',
  };

  // Strategic mode
  if (strategicMode) {
    return (
      <div style={gridStyle}>
        <Card title="Execution Mode">
          <div style={{ fontSize: '0.875rem', lineHeight: '1.8' }}>
            <div style={{ marginBottom: 'var(--spacing-sm)' }}>
              <span style={{ 
                background: 'var(--color-success)', 
                color: '#052e16', 
                padding: '2px 8px', 
                borderRadius: '9999px', 
                fontSize: '0.75rem',
                fontWeight: 600 
              }}>
                Strategic Plans
              </span>
            </div>
            <div>
              <strong>Signals:</strong>{' '}
              <span style={{ fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>
                {signalsUseLlm ? `${llmModel || 'LLM'} + FinBERT` : 'FinBERT only'}
              </span>
            </div>
            <div>
              <strong>Plans:</strong>{' '}
              <span style={{ fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>
                Rule-based tranches
              </span>
            </div>
            <div>
              <strong>Screener:</strong>{' '}
              <span style={{ fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>
                {llmModel || 'LLM'} (on-demand)
              </span>
            </div>
          </div>
        </Card>

        <Card title="Weekly LLM Cost">
          <div style={{ fontSize: '0.875rem' }}>
            {weeklyCosts.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)' }}>No LLM costs recorded</p>
            ) : (
              <div>
                {weeklyCosts.map(week => (
                  <div key={week.weekStart} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '0.8rem' }}>{week.weekStart} → {week.weekEnd}</span>
                    <span>${week.total.toFixed(4)}</span>
                  </div>
                ))}
                <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--spacing-sm)', fontSize: '0.75rem' }}>
                  From screener{signalsUseLlm ? ' + signal collection' : ''} runs
                </p>
              </div>
            )}
          </div>
        </Card>
      </div>
    );
  }

  // Trading cycle mode
  return (
    <div style={gridStyle}>
      <Card title="Execution Mode">
        <div style={{ fontSize: '0.875rem', lineHeight: '1.8' }}>
          <div style={{ marginBottom: 'var(--spacing-sm)' }}>
            <span style={{ 
              background: 'var(--color-info)', 
              color: '#0c1a3e', 
              padding: '2px 8px', 
              borderRadius: '9999px', 
              fontSize: '0.75rem',
              fontWeight: 600 
            }}>
              Trading Cycle
            </span>
          </div>
          <div>
            <strong>Model:</strong>{' '}
            <span style={{ fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>
              {llmModel || 'Not configured'}
            </span>
          </div>
          <div>
            <strong>Analyst:</strong>{' '}
            <span style={{ fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>
              LLM research
            </span>
          </div>
          <div>
            <strong>Portfolio Mgr:</strong>{' '}
            <span style={{ fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>
              LLM decisions
            </span>
          </div>
        </div>
      </Card>

      <Card title="Weekly LLM Cost">
        <div style={{ fontSize: '0.875rem' }}>
          {weeklyCosts.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)' }}>No cost data</p>
          ) : (
            (() => {
              const maxCost = Math.max(...weeklyCosts.map(w => w.total));
              return (
                <div>
                  {weeklyCosts.map(week => (
                    <div key={week.weekStart} style={{ marginBottom: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px', fontWeight: 500 }}>
                        <span style={{ fontSize: '0.8rem' }}>{week.weekStart}</span>
                        <span>${week.total.toFixed(4)}</span>
                      </div>
                      <div
                        style={{
                          width: `${(week.total / maxCost) * 100}%`,
                          background: 'var(--color-info)',
                          height: '12px',
                          borderRadius: '2px',
                          minWidth: '4px',
                        }}
                      />
                    </div>
                  ))}
                </div>
              );
            })()
          )}
        </div>
      </Card>
    </div>
  );
}
