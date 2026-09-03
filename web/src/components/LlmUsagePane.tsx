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

interface DailyCost {
  date: string;
  total: number;
}

export default function LlmUsagePane(): JSX.Element | null {
  const [strategicMode, setStrategicMode] = useState<boolean | null>(null);
  const [signalsUseLlm, setSignalsUseLlm] = useState<boolean>(true);
  const [llmModel, setLlmModel] = useState<string | null>(null);
  const [dailyCosts, setDailyCosts] = useState<DailyCost[]>([]);
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

        // Fetch last 100 runs to get telemetry data
        const res = await api.runs.list(100, 0);
        const runs = res.data;

        const costByDate: Record<string, { total: number }> = {};

        for (const run of runs) {
          if (!run.tokenUsageJson) continue;

          let telemetry: LlmTelemetry | null = null;
          try {
            telemetry = JSON.parse(run.tokenUsageJson);
          } catch {
            continue;
          }

          if (!telemetry) continue;

          // Aggregate costs by date
          if (telemetry.cost && run.finishedAt) {
            const date = new Date(run.finishedAt).toISOString().split('T')[0];
            if (!costByDate[date]) {
              costByDate[date] = { total: 0 };
            }
            costByDate[date].total += telemetry.cost.total || 0;
          }
        }

        // Convert costByDate to sorted array (last 7 days)
        const sorted = Object.entries(costByDate)
          .map(([date, costs]) => ({
            date,
            total: costs.total,
          }))
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(-7);

        setDailyCosts(sorted);
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

        <Card title="Daily LLM Cost">
          <div style={{ fontSize: '0.875rem' }}>
            {dailyCosts.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)' }}>No LLM costs recorded</p>
            ) : (
              <div>
                {dailyCosts.map(day => (
                  <div key={day.date} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span>{day.date}</span>
                    <span>${day.total.toFixed(4)}</span>
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

      <Card title="Daily LLM Cost">
        <div style={{ fontSize: '0.875rem' }}>
          {dailyCosts.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)' }}>No cost data</p>
          ) : (
            (() => {
              const maxCost = Math.max(...dailyCosts.map(d => d.total));
              return (
                <div>
                  {dailyCosts.map(day => (
                    <div key={day.date} style={{ marginBottom: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px', fontWeight: 500 }}>
                        <span>{day.date}</span>
                        <span>${day.total.toFixed(4)}</span>
                      </div>
                      <div
                        style={{
                          width: `${(day.total / maxCost) * 100}%`,
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
