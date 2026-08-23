import { z } from 'zod';
import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { resolveConfigForAgent, resolveApiKey, LlmNotConfiguredError } from '../llm/openaiChatModel.js';
import { SCREENER_SYSTEM_PROMPT } from '../llm/prompts/screener.js';
import { createScreenerTools, type ScreenerToolsDeps } from './screenerTools.js';
import { RunCollector } from './runCollector.js';
import type { AgentMessagesRepo } from '../repos/agentMessagesRepo.js';
import type { ArtifactsRepo } from '../repos/artifactsRepo.js';
import { logger } from '../lib/logger.js';
import { emitProgress } from '../services/runProgress.js';

const SelectionSchema = z.object({
  symbol: z.string().describe('Stock ticker symbol'),
  rationale: z.string().describe('Investment rationale based on screening factors, 1-3 sentences'),
  conviction: z
    .number()
    .min(0)
    .max(1)
    .describe('Conviction score 0-1 based on signal strength'),
});

export interface ScreenerSelection {
  symbol: string;
  rationale: string;
  conviction: number;
}

export interface ScreenerAgentDeps {
  toolsDeps: ScreenerToolsDeps;
  messagesRepo: AgentMessagesRepo;
  artifactsRepo: ArtifactsRepo;
}

export interface ScreenerAgentConfig {
  model?: string;
  temperature?: number;
  recursionLimit?: number;
}

const log = logger.child({ component: 'screener-agent' });

export async function runScreenerAgent(
  runId: string,
  candidates: Array<{ symbol: string }>,
  deps: ScreenerAgentDeps,
  config?: ScreenerAgentConfig
): Promise<ScreenerSelection[] | null> {
  try {
    if (candidates.length === 0) {
      log.debug('no candidates to screen');
      return [];
    }

    // 1. Resolve config and API key
    const resolved = resolveConfigForAgent('screener', {
      model: config?.model,
      temperature: config?.temperature,
    });
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

    const synthesisLlm = new ChatOpenAI({
      apiKey,
      model: resolved.model,
      temperature: 0,
      timeout: resolved.timeoutMs,
      maxRetries: 0,
      ...(resolved.baseUrl ? { configuration: { baseURL: resolved.baseUrl } } : {}),
    });

    // 3. Create tools and collector
    const tools = createScreenerTools(deps.toolsDeps);
    const collector = new RunCollector(runId, 'screener', deps.messagesRepo, deps.artifactsRepo);

    // 4. Build human content with candidate list
    const symbolsStr = candidates.map((c) => c.symbol).join(', ');
    const humanContent = `Screen the following candidates for investment merit: ${symbolsStr}

For each candidate, evaluate sector momentum, earnings catalysts, and options market sentiment. Rank them by conviction and select the most promising for detailed analysis.`;

    // 5. Write initial messages
    collector.writeInitialMessages([
      { role: 'system', content: SCREENER_SYSTEM_PROMPT },
      { role: 'human', content: humanContent },
    ]);

    // 6. Create and stream the react agent
    const recursionLimit = config?.recursionLimit ?? 10;
    log.debug('starting screener agent', {
      runId,
      candidateCount: candidates.length,
      model: resolved.model,
      recursionLimit,
    });

    const agent = createReactAgent({
      llm: reactLlm,
      tools,
      stateModifier: SCREENER_SYSTEM_PROMPT,
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
        emitProgress(runId, 'screener', `Screening: fetching ${toolName}`, { tool: event.name });
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

    log.debug('stream complete', { candidateCount: candidates.length, eventCount });
    emitProgress(runId, 'screener', 'Synthesizing selections', {});

    // 7. Structured synthesis with 1 retry
    const SelectionArraySchema = z.array(SelectionSchema);
    const synthesisMessages = [
      new SystemMessage(SCREENER_SYSTEM_PROMPT),
      new HumanMessage(humanContent),
      new AIMessage(finalReasoningText || '(No reasoning captured)'),
      new HumanMessage(
        'Based on your screening above, provide your final selections as a JSON array with symbol, rationale, and conviction for each selected candidate. Return at least 3-5 selections if available.'
      ),
    ];

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // Try withStructuredOutput if available; fall back to manual JSON parsing
        let raw: any;
        try {
          raw = await (synthesisLlm as any).withStructuredOutput(SelectionArraySchema).invoke(
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

          // Extract JSON array from response
          const jsonMatch = content.match(/\[\s*\{[\s\S]*\}\s*\]/);
          if (!jsonMatch) {
            throw new Error('No JSON array found in response');
          }
          raw = JSON.parse(jsonMatch[0]);
        }

        const parsed = SelectionArraySchema.parse(raw);
        log.debug('screening complete', {
          candidateCount: candidates.length,
          selectedCount: parsed.length,
        });
        return parsed;
      } catch (err) {
        if (attempt === 0) {
          log.warn('structured output attempt failed, retrying', {
            error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }
        throw err;
      }
    }

    return null;
  } catch (err) {
    log.warn('screener agent failed', {
      runId,
      candidateCount: candidates.length,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
