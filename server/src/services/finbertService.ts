/**
 * FinBERT sentiment scoring service using Transformers.js (ONNX).
 */

import { pipeline, env } from '@xenova/transformers';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'finbert-service' });

// Configure local model path if set
const modelPath = process.env.FINBERT_MODEL_PATH;
if (modelPath) {
  env.localModelPath = modelPath;
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
}
const modelName = modelPath ? 'finbert-onnx' : 'ProsusAI/finbert';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let classifier: any = null;

export interface FinBERTResult {
  label: 'positive' | 'negative' | 'neutral';
  score: number;
  normalizedScore: number;
}

function normalizeScore(label: string, score: number): number {
  if (label === 'positive') return score;
  if (label === 'negative') return -score;
  return 0;
}

/**
 * Initialize the model. Call at startup.
 */
export async function prewarmFinBERT(): Promise<void> {
  log.info(`Loading FinBERT model from ${modelPath || 'HuggingFace'}...`);
  classifier = await pipeline('sentiment-analysis', modelName);
  log.info('FinBERT model loaded');
}

/**
 * Score financial text using FinBERT.
 */
export async function scoreFinBERT(text: string): Promise<FinBERTResult> {
  if (!classifier) throw new Error('FinBERT not initialized');
  const output = await classifier(text);
  const result = Array.isArray(output) ? output[0] : output;
  const r: FinBERTResult = {
    label: result.label as FinBERTResult['label'],
    score: result.score,
    normalizedScore: normalizeScore(result.label, result.score),
  };
  log.debug('FinBERT scored', { text: text.slice(0, 50), ...r });
  return r;
}

/**
 * Batch score multiple texts.
 */
export async function scoreFinBERTBatch(texts: string[]): Promise<FinBERTResult[]> {
  if (!classifier) throw new Error('FinBERT not initialized');
  const output = await classifier(texts);
  const results = Array.isArray(output[0]) ? output.flat() : output;
  return results.map((r: { label: string; score: number }) => ({
    label: r.label as FinBERTResult['label'],
    score: r.score,
    normalizedScore: normalizeScore(r.label, r.score),
  }));
}
