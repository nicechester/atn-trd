/**
 * Signal Synthesis Service
 *
 * Uses LLM to synthesize news and fundamentals into a sentiment summary
 * for more accurate FinBERT scoring.
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { getSynthesisLlm } from '../llm/rateLimitedLlm.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'signal-synthesis' });

const SYNTHESIS_SYSTEM_PROMPT = `You are a financial analyst summarizing market sentiment for a stock.
Given recent news headlines and optional fundamentals, write a 1-2 sentence sentiment summary.
Focus on the overall market sentiment direction (bullish/bearish/neutral) and key drivers.
Be concise and factual. Output ONLY the sentiment summary, no preamble.`;

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
export async function synthesizeSentiment(input: SynthesisInput): Promise<SynthesisResult> {
  const { symbol, headlines, fundamentalsSummary } = input;

  if (headlines.length === 0) {
    return { sentimentSummary: '', tokensUsed: 0 };
  }

  const llm = getSynthesisLlm();

  let userContent = `Symbol: ${symbol}\n\nRecent Headlines:\n${headlines.slice(0, 10).map((h, i) => `${i + 1}. ${h}`).join('\n')}`;

  if (fundamentalsSummary) {
    userContent += `\n\nKey Fundamentals:\n${fundamentalsSummary}`;
  }

  userContent += '\n\nWrite a 1-2 sentence sentiment summary:';

  try {
    const response = await llm.invoke([
      new SystemMessage(SYNTHESIS_SYSTEM_PROMPT),
      new HumanMessage(userContent),
    ]);

    const content = typeof response.content === 'string'
      ? response.content
      : Array.isArray(response.content)
        ? response.content.map((c: any) => (typeof c === 'string' ? c : c.text ?? '')).join('')
        : '';

    // Extract token usage from response metadata
    const usage = (response as any).usage_metadata ?? (response as any).response_metadata?.usage ?? {};
    const tokensUsed = (usage.total_tokens ?? usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);

    log.debug('synthesized sentiment', { symbol, tokensUsed, summaryLength: content.length });

    return {
      sentimentSummary: content.trim(),
      tokensUsed,
    };
  } catch (err) {
    log.warn('synthesis failed', { symbol, error: err instanceof Error ? err.message : String(err) });
    // Fallback: concatenate headlines
    return {
      sentimentSummary: headlines.slice(0, 5).join('. '),
      tokensUsed: 0,
    };
  }
}
