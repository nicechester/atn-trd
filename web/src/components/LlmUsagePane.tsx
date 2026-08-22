import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Card } from './Card';

interface LlmTelemetry {
  models: { analyst: string; portfolioManager: string };
  tokens: {
    analyst: { input: number; output: number };
    portfolioManager: { input: number; output: number };
  };
  cost: { analyst: number; portfolioManager: number; total: number };
  latency_ms: { analyst: number; portfolioManager: number; total: number };
}

interface DailyCost {
  date: string;
  total: number;
  analyst: number;
  portfolioManager: number;
}

interface CurrentModels {
  analyst: string | null;
  portfolioManager: string | null;
}

export default function LlmUsagePane(): JSX.Element | null {
  const [currentModels, setCurrentModels] = useState<CurrentModels>({ analyst: null, portfolioManager: null });
  const [dailyCosts, setDailyCosts] = useState<DailyCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        // Fetch last 100 runs to get telemetry data
        const res = await api.runs.list(100, 0);
        const runs = res.data;

        let latestAnalystModel: string | null = null;
        let latestPmModel: string | null = null;
        const costByDate: Record<string, { total: number; analyst: number; pm: number }> = {};

        for (const run of runs) {
          if (!run.tokenUsageJson) continue;

          let telemetry: LlmTelemetry | null = null;
          try {
            telemetry = JSON.parse(run.tokenUsageJson);
          } catch {
            continue;
          }

          if (!telemetry) continue;

          // Get latest models from most recent run (first iteration)
          if (!latestAnalystModel && telemetry.models?.analyst) {
            latestAnalystModel = telemetry.models.analyst;
          }
          if (!latestPmModel && telemetry.models?.portfolioManager) {
            latestPmModel = telemetry.models.portfolioManager;
          }

          // Aggregate costs by date
          if (telemetry.cost && run.finishedAt) {
            const date = new Date(run.finishedAt).toISOString().split('T')[0];
            if (!costByDate[date]) {
              costByDate[date] = { total: 0, analyst: 0, pm: 0 };
            }
            costByDate[date].total += telemetry.cost.total || 0;
            costByDate[date].analyst += telemetry.cost.analyst || 0;
            costByDate[date].pm += telemetry.cost.portfolioManager || 0;
          }
        }

        setCurrentModels({
          analyst: latestAnalystModel,
          portfolioManager: latestPmModel,
        });

        // Convert costByDate to sorted array
        const sorted = Object.entries(costByDate)
          .map(([date, costs]) => ({
            date,
            total: costs.total,
            analyst: costs.analyst,
            portfolioManager: costs.pm,
          }))
          .sort((a, b) => a.date.localeCompare(b.date));

        setDailyCosts(sorted);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load LLM usage data');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  if (loading) return null;
  if (error) return <Card title="LLM Usage"><p style={{ color: 'var(--color-error)' }}>{error}</p></Card>;
  if (!currentModels.analyst && !currentModels.portfolioManager && dailyCosts.length === 0) {
    return <Card title="LLM Usage"><p style={{ color: 'var(--color-text-muted)' }}>No telemetry data available yet.</p></Card>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-lg)' }}>
      <Card title="Current Models">
        <div style={{ fontSize: '0.875rem', lineHeight: '1.6' }}>
          <div>
            <strong>Analyst:</strong>{' '}
            <span style={{ fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>
              {currentModels.analyst || 'Not configured'}
            </span>
          </div>
          <div>
            <strong>Portfolio Manager:</strong>{' '}
            <span style={{ fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>
              {currentModels.portfolioManager || 'Not configured'}
            </span>
          </div>
        </div>
      </Card>

      <Card title="Daily Cost Trends">
        <div style={{ fontSize: '0.875rem' }}>
          {dailyCosts.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)' }}>No cost data</p>
          ) : (
            <div>
              {dailyCosts.map(day => (
                <div key={day.date} style={{ marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px', fontWeight: 500 }}>
                    <span>{day.date}</span>
                    <span>${day.total.toFixed(4)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center', fontSize: '0.75rem' }}>
                    <div
                      style={{
                        flex: `${day.analyst}`,
                        background: 'var(--color-info)',
                        height: '16px',
                        borderRadius: '2px',
                        minWidth: '4px',
                      }}
                      title={`Analyst: $${day.analyst.toFixed(4)}`}
                    />
                    <div
                      style={{
                        flex: `${day.portfolioManager}`,
                        background: 'var(--color-success)',
                        height: '16px',
                        borderRadius: '2px',
                        minWidth: '4px',
                      }}
                      title={`Portfolio Manager: $${day.portfolioManager.toFixed(4)}`}
                    />
                  </div>
                </div>
              ))}
              <div style={{ marginTop: '12px', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                <span style={{ display: 'inline-block', width: '12px', height: '12px', background: 'var(--color-info)', borderRadius: '2px', marginRight: '4px' }} /> Analyst
                {' '}
                <span style={{ display: 'inline-block', width: '12px', height: '12px', background: 'var(--color-success)', borderRadius: '2px', marginRight: '4px', marginLeft: '12px' }} /> Portfolio Manager
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
