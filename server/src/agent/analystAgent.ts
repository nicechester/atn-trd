import { z } from 'zod';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { resolveConfigForAgent } from '../llm/openaiChatModel.js';
import { getRateLimitedLlm, getSynthesisLlm, isGeminiModel } from '../llm/rateLimitedLlm.js';
import { ANALYST_SYSTEM_PROMPT } from '../llm/prompts/analyst.js';
import { createAgentTools, type AgentToolsDeps } from './tools.js';
import { RunCollector } from './runCollector.js';
import type { AgentMessagesRepo } from '../repos/agentMessagesRepo.js';
import type { ArtifactsRepo } from '../repos/artifactsRepo.js';
import { logger } from '../lib/logger.js';
import { emitProgress } from '../services/runProgress.js';
import type { InvestorProfile } from '@atn-trd/shared';

/** Rough token estimate: ~4 chars per token for English text */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Default max tokens for local LLM context safety */
const DEFAULT_MAX_CONTEXT_TOKENS = 28000;

const AssessmentSchema = z.object({
  score: z
    .number()
    .min(-1)
    .max(1)
    .describe('Directional view: -1 very bearish → +1 very bullish'),
  confidence: z.number().min(0).max(1).describe('Confidence in the assessment, 0–1'),
  thesis: z.string().describe('Primary investment thesis, 2–4 sentences, evidence-backed'),
  risks: z.string().nullable().describe('Key risks; null if none identified'),
  catalysts: z.string().nullable().describe('Near-term catalysts; null if none identified'),
});

export interface SymbolAssessment {
  symbol: string;
  score: number;
  confidence: number;
  thesis: string;
  risks: string | null;
  catalysts: string | null;
}

export interface AnalystAgentDeps {
  toolsDeps: AgentToolsDeps;
  messagesRepo: AgentMessagesRepo;
  artifactsRepo: ArtifactsRepo;
}

export interface AnalystAgentConfig {
  model?: string;
  temperature?: number;
  recursionLimit?: number;
  investorProfile?: InvestorProfile;
  maxContextTokens?: number;
}

const log = logger.child({ component: 'analyst-agent' });

export async function runAnalystAgent(
  runId: string,
  symbol: string,
  deps: AnalystAgentDeps,
  config?: AnalystAgentConfig
): Promise<SymbolAssessment | null> {
  try {
    // 1. Get rate-limited LLM singleton
    const rateLimitedLlm = getRateLimitedLlm();
    const synthesisLlm = getSynthesisLlm();
    const resolved = resolveConfigForAgent('analyst', { model: config?.model, temperature: config?.temperature });
    const isGemini = isGeminiModel();

    // 2. Create tools and collector
    const tools = createAgentTools(deps.toolsDeps);
    const collector = new RunCollector(runId, symbol, deps.messagesRepo, deps.artifactsRepo);

    // 3. Build human content with optional investor profile injection
    let humanContent = `Research ${symbol} and provide a thorough investment assessment.`;
    if (config?.investorProfile) {
      const profile = config.investorProfile;
      const profileStr = [
        '',
        'INVESTOR PROFILE',
        '=================',
        `Style weights: growth=${profile.styleWeights.growth}%, value=${profile.styleWeights.value}%, stability=${profile.styleWeights.stability}%, cashFlow=${profile.styleWeights.cashFlow}%, momentum=${profile.styleWeights.momentum}%`,
        `Max volatility tolerance: ${profile.maxVolatility.toFixed(2)}%`,
      ].join('\n');
      humanContent += profileStr;
    }

    // 4. Write initial messages
    collector.writeInitialMessages([
      { role: 'system', content: ANALYST_SYSTEM_PROMPT },
      { role: 'human', content: humanContent },
    ]);

    // 5. Create and stream the react agent
    const recursionLimit = config?.recursionLimit ?? 10;
    log.debug('starting analyst agent', {
      runId,
      symbol,
      model: resolved.model,
      recursionLimit,
    });

    const agent = createReactAgent({
      llm: rateLimitedLlm.baseLlm,
      tools,
      stateModifier: ANALYST_SYSTEM_PROMPT,
    });

    let finalReasoningText = '';
    let eventCount = 0;
    const stream = agent.streamEvents(
      { messages: [new HumanMessage(humanContent)] },
      { version: 'v2', recursionLimit }
    );

    for await (const event of stream) {
      eventCount++;
      // Emit progress for UI
      if (event.event === 'on_tool_start') {
        const toolName = event.name?.replace('get_', '') ?? 'tool';
        emitProgress(runId, 'analyst', `${symbol}: fetching ${toolName}`, { symbol, tool: event.name });
      }
      collector.handleEvent(event as any);
      if (event.event === 'on_chat_model_end') {
        const output = event.data?.output;
        if (output && typeof output === 'object' && 'content' in output) {
          const c = (output as { content: unknown }).content;
          finalReasoningText = typeof c === 'string' ? c : '';
        }
      }
    }

    log.debug('stream complete', { symbol, eventCount });
    emitProgress(runId, 'analyst', `${symbol}: synthesizing assessment`, { symbol });

    // 6. Structured synthesis with token guard and message trimming
    const maxTokens = config?.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS;
    
    // Trim reasoning if too long
    let reasoningText = finalReasoningText || '(No reasoning captured)';
    const reasoningTokens = estimateTokens(reasoningText);
    if (reasoningTokens > maxTokens * 0.6) {
      const targetChars = Math.floor(maxTokens * 0.6 * 4);
      reasoningText = '...' + reasoningText.slice(-targetChars);
      log.debug('trimmed reasoning text', { symbol, originalTokens: reasoningTokens, targetChars });
    }

    const synthesisPrompt = `Based on your research above, provide your final assessment as a JSON object with this exact structure:
{
  "score": <number from -1 to 1, where -1=very bearish, 0=neutral, 1=very bullish>,
  "confidence": <number from 0 to 1>,
  "thesis": "<2-4 sentence investment thesis>",
  "risks": "<key risks or null>",
  "catalysts": "<near-term catalysts or null>"
}
Respond ONLY with the JSON object, no markdown or explanation.`;

    const synthesisMessages = [
      new SystemMessage(ANALYST_SYSTEM_PROMPT),
      new HumanMessage(humanContent),
      new AIMessage(reasoningText),
      new HumanMessage(synthesisPrompt),
    ];

    // Final token check before synthesis
    const totalContent = synthesisMessages.map(m => 
      typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    ).join('');
    const estimatedTotal = estimateTokens(totalContent);
    
    if (estimatedTotal > maxTokens) {
      log.warn('synthesis prompt exceeds token limit', { 
        symbol, 
        estimatedTokens: estimatedTotal, 
        maxTokens,
      });
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        let raw: any;
        
        // Skip withStructuredOutput for Gemini - it doesn't support nullable fields
        if (!isGemini) {
          try {
            log.debug('attempting withStructuredOutput', { symbol });
            raw = await (synthesisLlm.baseLlm as any).withStructuredOutput(AssessmentSchema).invoke(
              synthesisMessages
            );
            if (raw && typeof raw === 'object' && 'score' in raw) {
              const parsed = AssessmentSchema.parse(raw);
              log.debug('assessment complete', { symbol, score: parsed.score, confidence: parsed.confidence });
              return { symbol, ...parsed };
            }
          } catch (structuredErr) {
            log.debug('withStructuredOutput failed, trying manual extraction', {
              symbol,
              error: structuredErr instanceof Error ? structuredErr.message : String(structuredErr),
            });
          }
        }
        
        // Manual JSON extraction with rate limit handling
        const response = await synthesisLlm.invoke(synthesisMessages);
        const content =
          typeof response.content === 'string'
            ? response.content
            : Array.isArray(response.content)
              ? response.content.map((c: any) => (typeof c === 'string' ? c : c.text ?? '')).join('')
              : '';

        log.debug('synthesis response', { symbol, contentLength: content.length });

        // Extract JSON from response
        let jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
        if (jsonMatch) {
          raw = JSON.parse(jsonMatch[1].trim());
        } else {
          jsonMatch = content.match(/\{[\s\S]*\}/);
          if (!jsonMatch) throw new Error('No JSON found in response');
          raw = JSON.parse(jsonMatch[0]);
        }

        const parsed = AssessmentSchema.parse(raw);
        log.debug('assessment complete', { symbol, score: parsed.score, confidence: parsed.confidence });
        return { symbol, ...parsed };
      } catch (err) {
        if (attempt === 0) {
          log.warn('synthesis attempt failed, retrying', {
            symbol,
            error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }
        throw err;
      }
    }

    return null;
  } catch (err) {
    log.warn('analyst agent failed', {
      runId,
      symbol,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
