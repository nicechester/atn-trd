/**
 * Embedding service for generating text embeddings.
 * Supports OpenAI and Gemini APIs (configured via settings).
 */

import { logger } from '../lib/logger.js';
import { resolveApiKey, LlmNotConfiguredError } from './openaiChatModel.js';
import { getSettings } from '../config/settingsService.js';

const log = logger.child({ component: 'embedding' });

export interface EmbeddingService {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export interface EmbeddingConfig {
  provider?: 'openai' | 'gemini';
  model?: string;
  apiKey?: string;
}

const DEFAULT_OPENAI_MODEL = 'text-embedding-3-large';
const DEFAULT_GEMINI_MODEL = 'gemini-embedding-001';

export function createEmbeddingService(config: EmbeddingConfig = {}): EmbeddingService {
  // Get settings for provider/model if not explicitly passed
  const settings = getSettings();
  const provider = config.provider ?? settings.semanticMemory.provider ?? 'openai';
  const useGemini = provider === 'gemini';
  const embeddingModel = config.model 
    || settings.semanticMemory.model?.trim() 
    || (useGemini ? DEFAULT_GEMINI_MODEL : DEFAULT_OPENAI_MODEL);

  async function embed(text: string): Promise<number[]> {
    const [result] = await embedBatch([text]);
    return result;
  }

  async function embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const apiKey = resolveApiKey(config.apiKey);
    if (!apiKey) throw new LlmNotConfiguredError();

    log.debug('generating embeddings', { count: texts.length, model: embeddingModel, provider });

    if (useGemini) {
      return embedBatchGemini(texts, apiKey, embeddingModel);
    } else {
      return embedBatchOpenAI(texts, apiKey, embeddingModel);
    }
  }

  return { embed, embedBatch };
}

async function embedBatchOpenAI(
  texts: string[],
  apiKey: string,
  model: string
): Promise<number[][]> {
  const url = 'https://api.openai.com/v1/embeddings';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: texts }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    log.error('embedding API error', { status: response.status, error: errorText });
    throw new Error(`Embedding API error: ${response.status} ${errorText}`);
  }

  const data = await response.json() as {
    data: Array<{ embedding: number[]; index: number }>;
  };

  const sorted = data.data.sort((a, b) => a.index - b.index);
  return sorted.map(d => d.embedding);
}

async function embedBatchGemini(
  texts: string[],
  apiKey: string,
  model: string
): Promise<number[][]> {
  // Gemini batchEmbedContents endpoint
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: texts.map(text => ({
        model: `models/${model}`,
        content: { parts: [{ text }] },
      })),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    log.error('embedding API error', { status: response.status, error: errorText });
    throw new Error(`Embedding API error: ${response.status} ${errorText}`);
  }

  const data = await response.json() as {
    embeddings: Array<{ values: number[] }>;
  };

  return data.embeddings.map(e => e.values);
}

/**
 * Truncate text to fit within embedding model's context window.
 * Most embedding models have ~8K token limit; we use a conservative char limit.
 */
export function truncateForEmbedding(text: string, maxChars = 24000): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '...';
}

/**
 * Build embeddable text from an assessment.
 */
export function assessmentToEmbeddingText(assessment: {
  symbol: string;
  score: number;
  thesis: string;
  risks?: string | null;
  catalysts?: string | null;
}): string {
  const parts = [
    `Symbol: ${assessment.symbol}`,
    `Score: ${assessment.score}`,
    `Thesis: ${assessment.thesis}`,
  ];
  if (assessment.risks) parts.push(`Risks: ${assessment.risks}`);
  if (assessment.catalysts) parts.push(`Catalysts: ${assessment.catalysts}`);
  return truncateForEmbedding(parts.join('\n'));
}

/**
 * Build embeddable text from a realized trade outcome.
 */
export function tradeOutcomeToEmbeddingText(outcome: {
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  avgCostCents: number;
  exitPriceCents: number;
  realizedPnlCents: number;
  holdingPeriodMs?: number | null;
  thesis?: string | null;
}): string {
  const pnlDollars = (outcome.realizedPnlCents / 100).toFixed(2);
  const returnPercent = outcome.avgCostCents !== 0
    ? (((outcome.exitPriceCents - outcome.avgCostCents) / outcome.avgCostCents) * 100).toFixed(2)
    : '0.00';
  const holdingDays = outcome.holdingPeriodMs != null
    ? Math.max(0, Math.round(outcome.holdingPeriodMs / 86_400_000))
    : null;

  const parts = [
    `Symbol: ${outcome.symbol}`,
    `Outcome: ${outcome.side.toUpperCase()} ${outcome.qty} shares realized P&L $${pnlDollars} (${returnPercent}%)`,
    `Entry: $${(outcome.avgCostCents / 100).toFixed(2)}, Exit: $${(outcome.exitPriceCents / 100).toFixed(2)}`,
  ];
  if (holdingDays !== null) parts.push(`Held: ${holdingDays} day(s)`);
  if (outcome.thesis) parts.push(`Original thesis: ${outcome.thesis}`);

  return truncateForEmbedding(parts.join('\n'));
}

/**
 * Build embeddable text from a research artifact.
 */
export function artifactToEmbeddingText(artifact: {
  symbol?: string | null;
  source: string;
  provider: string;
  summary?: string | null;
  payload: Record<string, unknown>;
}): string {
  const parts = [
    artifact.symbol ? `Symbol: ${artifact.symbol}` : null,
    `Source: ${artifact.source}`,
    `Provider: ${artifact.provider}`,
    artifact.summary ? `Summary: ${artifact.summary}` : null,
  ].filter(Boolean);

  // Add a condensed payload representation
  const payloadStr = JSON.stringify(artifact.payload).slice(0, 2000);
  parts.push(`Data: ${payloadStr}`);

  return truncateForEmbedding(parts.join('\n'));
}
