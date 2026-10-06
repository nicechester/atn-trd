/**
 * FinBERT sentiment scoring service using Transformers.js (ONNX).
 */
import { pipeline, env } from '@huggingface/transformers';
import { logger } from '../lib/logger.js';
const log = logger.child({ component: 'finbert-service' });
// Configure local model path if set
const modelPath = process.env.FINBERT_MODEL_PATH;
if (modelPath) {
    env.localModelPath = modelPath;
    env.allowRemoteModels = false;
}
// Local: 'finbert-q8' subfolder, Remote: HuggingFace
const modelName = modelPath ? 'finbert-q8' : 'nicechester/finbert-sentiment-onnx-quantized';
const pipelineOptions = modelPath
    ? { model_file_name: 'model', dtype: 'q8' }
    : {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let classifier = null;
let finbertReady = false;
export function isFinBERTReady() {
    return finbertReady;
}
function normalizeScore(label, score) {
    if (label === 'positive')
        return score;
    if (label === 'negative')
        return -score;
    return 0;
}
/**
 * Initialize the model. Call at startup.
 */
export async function prewarmFinBERT() {
    log.info(`Loading FinBERT model from ${modelPath || 'HuggingFace'}...`);
    classifier = await pipeline('text-classification', modelName, pipelineOptions);
    finbertReady = true;
    log.info('FinBERT model ready');
}
/**
 * Score financial text using FinBERT.
 */
export async function scoreFinBERT(text) {
    if (!classifier)
        throw new Error('FinBERT not initialized');
    const output = await classifier(text);
    const result = Array.isArray(output) ? output[0] : output;
    const r = {
        label: result.label,
        score: result.score,
        normalizedScore: normalizeScore(result.label, result.score),
    };
    log.debug('FinBERT scored', { text: text.slice(0, 50), ...r });
    return r;
}
/**
 * Batch score multiple texts.
 */
export async function scoreFinBERTBatch(texts) {
    if (!classifier)
        throw new Error('FinBERT not initialized');
    const output = await classifier(texts);
    const results = Array.isArray(output[0]) ? output.flat() : output;
    return results.map((r) => ({
        label: r.label,
        score: r.score,
        normalizedScore: normalizeScore(r.label, r.score),
    }));
}
//# sourceMappingURL=finbertService.js.map