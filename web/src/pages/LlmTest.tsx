import { useState } from 'react';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { TestButton } from '../components/TestButton';

interface LlmTestResult {
  ok: boolean;
  data?: {
    model: string;
    response: string;
    latency: number;
    tokens?: { inputTokens: number; outputTokens: number; totalTokens?: number };
  };
  error?: string;
}

export default function LlmTestPage(): JSX.Element {
  const [lastResult, setLastResult] = useState<LlmTestResult | null>(null);

  return (
    <div>
      <h1>LLM Test</h1>
      <Card title="Connectivity Check">
        <p style={{ color: 'var(--color-text-muted)' }}>
          Sends a minimal prompt to the configured model and reports latency.
        </p>
        <TestButton
          onTest={async () => {
            const res = await api.llm.test();
            setLastResult(res);
            return { ok: res.ok, detail: res.error ?? res.data?.response };
          }}
        />
      </Card>
      {lastResult?.data && (
        <Card title="Last Result" className={{ marginTop: 'var(--spacing-lg)' } as any}>
          <p>Model: {lastResult.data.model}</p>
          <p>Latency: {lastResult.data.latency}ms</p>
          {lastResult.data.tokens && (
            <p>
              Tokens: {lastResult.data.tokens.inputTokens} in /{' '}
              {lastResult.data.tokens.outputTokens} out
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
