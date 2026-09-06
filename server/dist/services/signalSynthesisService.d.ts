/**
 * Signal Synthesis Service
 *
 * Uses LLM to synthesize news and fundamentals into a sentiment summary
 * for more accurate FinBERT scoring.
 */
export interface SynthesisInput {
    symbol: string;
    headlines: string[];
    fundamentalsSummary?: string;
}
export interface SynthesisResult {
    sentimentSummary: string;
    tokensUsed: number;
}
/**
 * Synthesize news headlines into a sentiment summary using LLM.
 */
export declare function synthesizeSentiment(input: SynthesisInput): Promise<SynthesisResult>;
//# sourceMappingURL=signalSynthesisService.d.ts.map