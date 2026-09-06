/**
 * FinBERT sentiment scoring service using Transformers.js (ONNX).
 */

import { pipeline, env, type TextClassificationPipeline } from '@xenova/transformers';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'finbert-service' });

// Configure local model path if set
const modelPath = process.env.FINBERT_MODEL_PATH;
if (modelPath) {
  env.localModelPath = modelPath;
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
}

let classifier: TextClassificationPipeline | null = null;

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
  const modelName = modelPath ? '.' : 'ProsusAI/finbert';
  log.info(`Loading FinBERT model from ${modelPath || 'HuggingFace'}...`);
  classifier = await pipeline('sentiment-analysis', modelName) as TextClassificationPipeline;
  log.info('FinBERT model loaded');
}

/**
 * Score financial text using FinBERT.
 */
export async function scoreFinBERT(text: string): Promise<FinBERTResult> {
  if (!classifier) throw new Error('FinBERT not initialized');
  const [result] = await classifier(text);
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
  const results = await classifier(texts);
  return results.map((r: { label: string; score: number }) => ({
    label: r.label as FinBERTResult['label'],
    score: r.score,
    normalizedScore: normalizeScore(r.label, r.score),
  }));
}
