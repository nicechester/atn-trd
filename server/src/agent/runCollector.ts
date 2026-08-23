import type { AgentMessagesRepo } from '../repos/agentMessagesRepo.js';
import type { ArtifactsRepo, ResearchArtifactRow } from '../repos/artifactsRepo.js';
import { logger } from '../lib/logger.js';

interface LangGraphStreamEvent {
  event: string;
  name: string;
  run_id: string;
  data: {
    input?: unknown;
    output?: unknown;
    chunk?: unknown;
  };
}

interface PendingTool {
  toolName: string;
  toolArgsJson: string;
  seq: number;
  startedAt: number;
}

type ArtifactMeta = { source: ResearchArtifactRow['source']; provider: string };

const TOOL_ARTIFACT_MAP: Record<string, ArtifactMeta | null> = {
  get_price_history: { source: 'prices', provider: 'yahoo' },
  get_fundamentals: { source: 'fundamentals', provider: 'yahoo' },
  get_news: { source: 'news', provider: 'yahoo' }, // TODO(step-26): confirm provider
  get_macro: { source: 'macro', provider: 'fred' },
  get_options_snapshot: { source: 'options', provider: 'yahoo' }, // TODO(step-26): confirm provider
  get_portfolio: null,
  get_prior_decisions: null,
};

function chunkText(chunk: unknown): string {
  if (!chunk || typeof chunk !== 'object') return '';
  const c = (chunk as { content?: unknown }).content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((item) =>
        typeof item === 'string' ? item : (item as { text?: string }).text ?? ''
      )
      .join('');
  }
  return '';
}

/**
 * Extract the actual content from a tool output.
 * New LangGraph versions wrap tool results in ToolMessage objects.
 */
function extractToolContent(output: unknown): string {
  if (typeof output === 'string') return output;
  if (!output || typeof output !== 'object') return safeStringify(output);

  // Handle LangChain ToolMessage wrapper
  const obj = output as Record<string, unknown>;
  
  // Direct content property
  if (typeof obj.content === 'string') return obj.content;
  
  // LangChain serialized format: { kwargs: { content: "..." } }
  if (obj.kwargs && typeof obj.kwargs === 'object') {
    const kwargs = obj.kwargs as Record<string, unknown>;
    if (typeof kwargs.content === 'string') return kwargs.content;
  }
  
  return safeStringify(output);
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return '"[serialization error]"';
  }
}

const log = logger.child({ component: 'run-collector' });

export class RunCollector {
  private seq = 0;
  private modelBuffers = new Map<string, string>();
  private pendingTools = new Map<string, PendingTool>();

  constructor(
    private readonly runId: string,
    private readonly symbol: string | null,
    private readonly messagesRepo: AgentMessagesRepo,
    private readonly artifactsRepo: ArtifactsRepo
  ) {}

  writeInitialMessages(
    messages: Array<{ role: 'system' | 'human'; content: string }>
  ): void {
    try {
      for (const message of messages) {
        this.messagesRepo.create({
          runId: this.runId,
          symbol: this.symbol,
          seq: this.seq++,
          role: message.role,
          content: message.content,
          toolName: null,
          toolArgsJson: null,
          toolResultJson: null,
          createdAt: Date.now(),
        });
      }
    } catch (err) {
      log.error('failed to write initial messages', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  handleEvent(event: LangGraphStreamEvent): void {
    try {
      switch (event.event) {
        case 'on_chat_model_start':
          this.modelBuffers.set(event.run_id, '');
          break;

        case 'on_chat_model_stream': {
          const text = chunkText(event.data?.chunk);
          if (!this.modelBuffers.has(event.run_id)) {
            this.modelBuffers.set(event.run_id, '');
          }
          this.modelBuffers.set(event.run_id, (this.modelBuffers.get(event.run_id) ?? '') + text);
          break;
        }

        case 'on_chat_model_end': {
          const buffer = this.modelBuffers.get(event.run_id);
          this.modelBuffers.delete(event.run_id);
          const content = (buffer ?? '').trim();
          if (content) {
            const createdAt = Date.now();
            this.messagesRepo.create({
              runId: this.runId,
              symbol: this.symbol,
              seq: this.seq++,
              role: 'ai',
              content,
              toolName: null,
              toolArgsJson: null,
              toolResultJson: null,
              createdAt,
            });
            // log.debug('wrote ai message', { seq: this.seq - 1, length: content.length });
          }
          break;
        }

        case 'on_tool_start': {
          const pending: PendingTool = {
            toolName: event.name,
            toolArgsJson: safeStringify(event.data?.input ?? {}),
            seq: this.seq++,
            startedAt: Date.now(),
          };
          this.pendingTools.set(event.run_id, pending);
          break;
        }

        case 'on_tool_end': {
          const pending = this.pendingTools.get(event.run_id);
          if (!pending) {
            log.warn('orphaned tool_end event', { runId: event.run_id, toolName: event.name });
            return;
          }
          const rawOutput = event.data?.output;
          const toolContent = extractToolContent(rawOutput);
          const toolResultJson = safeStringify(rawOutput);
          this.messagesRepo.create({
            runId: this.runId,
            symbol: this.symbol,
            seq: pending.seq,
            role: 'tool',
            content: pending.toolName,
            toolName: pending.toolName,
            toolArgsJson: pending.toolArgsJson,
            toolResultJson,
            createdAt: pending.startedAt,
          });
          // log.debug('wrote tool message', { toolName: pending.toolName, seq: pending.seq });
          this.pendingTools.delete(event.run_id);
          // Use extracted content for artifact, not the wrapped message
          this.writeArtifact(pending.toolName, toolContent, pending.startedAt);
          break;
        }
      }
    } catch (err) {
      log.error('failed to handle event', {
        event: event.event,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private writeArtifact(
    toolName: string,
    toolResultJson: string,
    fetchedAt: number
  ): void {
    try {
      const meta = TOOL_ARTIFACT_MAP[toolName];
      if (!meta) {
        return;
      }
      // TODO(#93 follow-up): artifacts are never embedded for semantic memory today.
      // SemanticMemoryService.storeArtifactEmbedding() exists and is unit-tested, but
      // nothing calls it — artifact embedding was deferred out of this issue's scope.
      // Summaries are also always null here, and storeArtifactEmbedding() no-ops
      // without one, so wiring this up will also need summary generation.
      this.artifactsRepo.create({
        runId: this.runId,
        symbol: this.symbol,
        source: meta.source,
        provider: meta.provider,
        fetchedAt,
        payloadJson: toolResultJson,
        summary: null,
        citationsJson: null,
      });
    } catch (err) {
      log.warn('failed to write artifact', {
        toolName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export function createRunCollector(
  runId: string,
  symbol: string | null,
  messagesRepo: AgentMessagesRepo,
  artifactsRepo: ArtifactsRepo
): RunCollector {
  return new RunCollector(runId, symbol, messagesRepo, artifactsRepo);
}
