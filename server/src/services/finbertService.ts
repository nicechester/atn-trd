/**
 * FinBERT sentiment scoring service using Transformers.js ONNX.
 * Analyzes financial text and returns sentiment label + score.
 */

import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'finbert-service' });

export interface FinBERTResult {
  label: 'positive' | 'negative' | 'neutral';
  score: number; // 0-1 confidence for the label
  normalizedScore: number; // -1 to 1 (negative=-1, neutral=0, positive=1)
}

// Lazy-loaded pipeline
let pipeline: any = null;
let pipelinePromise: Promise<any> | null = null;

async function getPipeline() {
  if (pipeline) return pipeline;
  if (pipelinePromise) return pipelinePromise;

  pipelinePromise = (async () => {
    log.info('loading FinBERT model...');
    const { pipeline: createPipeline } = await import('@xenova/transformers');
    pipeline = await createPipeline('sentiment-analysis', 'Xenova/finbert', {
      quantized: true,
    });
    log.info('FinBERT model loaded');
    return pipeline;
  })();

  return pipelinePromise;
}

/**
 * Score financial text using FinBERT.
 * @param text - Financial text to analyze (1-2 sentences work best)
 * @returns Sentiment result with label, score, and normalized score
 */
export async function scoreFinBERT(text: string): Promise<FinBERTResult> {
  const classifier = await getPipeline();

  const result = await classifier(text);
  const { label, score } = result[0];

  // Normalize to -1 to 1 scale
  let normalizedScore: number;
  if (label === 'positive') {
    normalizedScore = score;
  } else if (label === 'negative') {
    normalizedScore = -score;
  } else {
    normalizedScore = 0;
  }

  log.debug('FinBERT scored', { text: text.slice(0, 50), label, score, normalizedScore });

  return {
    label: label.toLowerCase() as FinBERTResult['label'],
    score,
    normalizedScore,
  };
}

/**
 * Pre-warm the FinBERT model by loading it into memory.
 * Call this at startup to avoid OOM during signal collection.
 */
export async function prewarmFinBERT(): Promise<void> {
  await getPipeline();
}

/**
 * Batch score multiple texts.
 */
export async function scoreFinBERTBatch(texts: string[]): Promise<FinBERTResult[]> {
  const classifier = await getPipeline();
  const results = await classifier(texts);

  return results.map((r: any) => {
    const { label, score } = r;
    let normalizedScore: number;
    if (label === 'positive') {
      normalizedScore = score;
    } else if (label === 'negative') {
      normalizedScore = -score;
    } else {
      normalizedScore = 0;
    }
    return {
      label: label.toLowerCase() as FinBERTResult['label'],
      score,
      normalizedScore,
    };
  });
}
