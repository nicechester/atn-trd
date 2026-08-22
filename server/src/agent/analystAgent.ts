import { z } from 'zod';
import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { resolveConfig, resolveApiKey, LlmNotConfiguredError } from '../llm/openaiChatModel.js';
import { ANALYST_SYSTEM_PROMPT } from '../llm/prompts/analyst.js';
import { createAgentTools, type AgentToolsDeps } from './tools.js';
import { RunCollector } from './runCollector.js';
import type { AgentMessagesRepo } from '../repos/agentMessagesRepo.js';
import type { ArtifactsRepo } from '../repos/artifactsRepo.js';
import { logger } from '../lib/logger.js';
import { emitProgress } from '../services/runProgress.js';
import type { InvestorProfile } from '@atn-trd/shared';

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
}

const log = logger.child({ component: 'analyst-agent' });

export async function runAnalystAgent(
  runId: string,
  symbol: string,
  deps: AnalystAgentDeps,
  config?: AnalystAgentConfig
): Promise<SymbolAssessment | null> {
  try {
    // 1. Resolve config and API key
    const resolved = resolveConfig({ model: config?.model, temperature: config?.temperature });
    const apiKey = resolveApiKey();
    if (!apiKey) throw new LlmNotConfiguredError();

    // 2. Instantiate two ChatOpenAI models
    const reactLlm = new ChatOpenAI({
      apiKey,
      model: resolved.model,
      temperature: resolved.temperature,
      timeout: resolved.timeoutMs,
      maxRetries: 0,
      ...(resolved.baseUrl ? { configuration: { baseURL: resolved.baseUrl } } : {}),
    });

    // Patch bindTools if missing (no longer needed with newer @langchain/openai)

    const synthesisLlm = new ChatOpenAI({
      apiKey,
      model: resolved.model,
      temperature: 0,
      timeout: resolved.timeoutMs,
      maxRetries: 0,
      ...(resolved.baseUrl ? { configuration: { baseURL: resolved.baseUrl } } : {}),
    });

    // 3. Create tools and collector
    const tools = createAgentTools(deps.toolsDeps);
    const collector = new RunCollector(runId, symbol, deps.messagesRepo, deps.artifactsRepo);

    // 4. Build human content with optional investor profile injection
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

    // 5. Write initial messages
    collector.writeInitialMessages([
      { role: 'system', content: ANALYST_SYSTEM_PROMPT },
      { role: 'human', content: humanContent },
    ]);

    // 6. Create and stream the react agent
    const recursionLimit = config?.recursionLimit ?? 10;
    log.debug('starting analyst agent', {
      runId,
      symbol,
      model: resolved.model,
      recursionLimit,
    });

    const agent = createReactAgent({
      llm: reactLlm,
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

    // 7. Structured synthesis with 1 retry
    const synthesisMessages = [
      new SystemMessage(ANALYST_SYSTEM_PROMPT),
      new HumanMessage(humanContent),
      new AIMessage(finalReasoningText || '(No reasoning captured)'),
      new HumanMessage(
        'Based on your research above, provide your final assessment in the required structured format.'
      ),
    ];

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // Try withStructuredOutput if available; fall back to manual JSON parsing
        let raw: any;
        try {
          raw = await (synthesisLlm as any).withStructuredOutput(AssessmentSchema).invoke(
            synthesisMessages
          );
        } catch (err) {
          // Fallback: manual JSON extraction and parsing
          const response = await synthesisLlm.invoke(synthesisMessages);
          const content =
            typeof response.content === 'string'
              ? response.content
              : Array.isArray(response.content)
                ? response.content.map((c: any) => (typeof c === 'string' ? c : c.text ?? '')).join('')
                : '';

          // Extract JSON from response (look for {...} pattern)
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            throw new Error('No JSON found in response');
          }
          raw = JSON.parse(jsonMatch[0]);
        }

        const parsed = AssessmentSchema.parse(raw);
        log.debug('assessment complete', {
          symbol,
          score: parsed.score,
          confidence: parsed.confidence,
        });
        return { symbol, ...parsed };
      } catch (err) {
        if (attempt === 0) {
          log.warn('structured output attempt failed, retrying', {
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
