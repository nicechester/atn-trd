/**
 * LLM test endpoint: proves the configured OpenAI credentials and model can
 * complete a minimal request, and reports round-trip latency plus token usage.
 */
import { Request, Response, NextFunction } from 'express';
import { type ChatModel, type TokenUsage } from '../llm/openaiChatModel.js';
/** Cheap, deterministic prompt used when the caller doesn't supply one. */
export declare const DEFAULT_TEST_PROMPT = "Reply with the single word: pong";
export interface TestLlmData {
    model: string;
    response: string;
    /** Round-trip milliseconds, including any retries. */
    latency: number;
    tokens?: TokenUsage;
}
export interface LlmRouteDeps {
    /** Overridable so tests can drive the handler without network access. */
    createModel?: () => ChatModel;
    now?: () => number;
}
export declare function createTestLlmHandler(deps?: LlmRouteDeps): (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare const testLlmHandler: (req: Request, res: Response, next: NextFunction) => Promise<void>;
//# sourceMappingURL=llm.d.ts.map