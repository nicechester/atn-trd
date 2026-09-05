/**
 * FinBERT sentiment scoring service.
 * Calls the finbert-server Python microservice via HTTP.
 */

import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'finbert-service' });

const FINBERT_URL = process.env.FINBERT_URL || 'http://finbert:5000';

export interface FinBERTResult {
  label: 'positive' | 'negative' | 'neutral';
  score: number;
  normalizedScore: number;
}

/**
 * Score financial text using FinBERT.
 */
export async function scoreFinBERT(text: string): Promise<FinBERTResult> {
  const res = await fetch(`${FINBERT_URL}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    throw new Error(`FinBERT request failed: ${res.status}`);
  }

  const result = await res.json();
  log.debug('FinBERT scored', { text: text.slice(0, 50), ...result });

  return result as FinBERTResult;
}

/**
 * Pre-warm is now a no-op since the model lives in a separate container.
 */
export async function prewarmFinBERT(): Promise<void> {
  try {
    const res = await fetch(`${FINBERT_URL}/health`);
    if (res.ok) {
      log.info('FinBERT service is healthy');
    } else {
      log.warn('FinBERT service health check failed', { status: res.status });
    }
  } catch (err) {
    log.warn('FinBERT service not reachable', { error: String(err) });
  }
}

/**
 * Batch score multiple texts.
 */
export async function scoreFinBERTBatch(texts: string[]): Promise<FinBERTResult[]> {
  const res = await fetch(`${FINBERT_URL}/analyze/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts }),
  });

  if (!res.ok) {
    throw new Error(`FinBERT batch request failed: ${res.status}`);
  }

  return (await res.json()) as FinBERTResult[];
}
