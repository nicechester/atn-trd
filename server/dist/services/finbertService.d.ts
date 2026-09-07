/**
 * FinBERT sentiment scoring service using Transformers.js (ONNX).
 */
export declare function isFinBERTReady(): boolean;
export interface FinBERTResult {
    label: 'positive' | 'negative' | 'neutral';
    score: number;
    normalizedScore: number;
}
/**
 * Initialize the model. Call at startup.
 */
export declare function prewarmFinBERT(): Promise<void>;
/**
 * Score financial text using FinBERT.
 */
export declare function scoreFinBERT(text: string): Promise<FinBERTResult>;
/**
 * Batch score multiple texts.
 */
export declare function scoreFinBERTBatch(texts: string[]): Promise<FinBERTResult[]>;
//# sourceMappingURL=finbertService.d.ts.map