import { z } from 'zod';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { getSynthesisLlm } from '../llm/rateLimitedLlm.js';
import { SCREENER_SYSTEM_PROMPT } from '../llm/prompts/screener.js';
import { RunCollector } from './runCollector.js';
import type { AgentMessagesRepo } from '../repos/agentMessagesRepo.js';
import type { ArtifactsRepo } from '../repos/artifactsRepo.js';
import type { YahooSectorPerformance } from '../datasources/sectors/index.js';
import type { FundamentalsDataSource } from '../datasources/fundamentals/index.js';
import type { OptionsDataSource } from '../datasources/options/index.js';
import type { RunCache } from '../datasources/cache.js';
import { logger } from '../lib/logger.js';
import { emitProgress } from '../services/runProgress.js';

const log = logger.child({ component: 'screener-agent' });

const SelectionSchema = z.object({
  symbol: z.string(),
  rationale: z.string(),
  conviction: z.number().min(0).max(1),
});

export interface ScreenerSelection {
  symbol: string;
  rationale: string;
  conviction: number;
}

export interface ScreenerToolsDeps {
  sectorSource: YahooSectorPerformance;
  fundamentalsSource: FundamentalsDataSource;
  optionsSource: OptionsDataSource;
  cache: RunCache;
}

export interface ScreenerAgentDeps {
  toolsDeps: ScreenerToolsDeps;
  messagesRepo: AgentMessagesRepo;
  artifactsRepo: ArtifactsRepo;
}

export interface ScreenerAgentConfig {
  model?: string;
  temperature?: number;
}

/**
 * Fetch all data for candidates in parallel batches.
 */
async function fetchAllData(
  symbols: string[],
  deps: ScreenerToolsDeps
): Promise<{ sectors: any[]; candidates: Array<{ symbol: string; fundamentals?: any; options?: any }> }> {
  // Fetch sector performance
  const sectors = await deps.cache.getOrFetch('sector_performance_all', 1800_000, () =>
    deps.sectorSource.fetch()
  ).catch(() => []);

  // Fetch fundamentals and options for all symbols
  const candidates: Array<{ symbol: string; fundamentals?: any; options?: any }> = [];
  const batchSize = 10;

  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (symbol) => {
        const [fundamentals, options] = await Promise.all([
          deps.cache.getOrFetch(`earnings:${symbol}`, 1800_000, () =>
            deps.fundamentalsSource.fetch({ symbol })
          ).catch(() => null),
          deps.cache.getOrFetch(`options:${symbol}`, 1800_000, () =>
            deps.optionsSource.fetch({ symbol })
          ).catch(() => null),
        ]);

        return {
          symbol,
          fundamentals: fundamentals?.data ? {
            pe: fundamentals.data.trailingPE,
            marketCap: fundamentals.data.marketCap,
            sector: fundamentals.data.sector,
          } : undefined,
          options: options?.data?.metrics ? {
            putCallRatio: options.data.metrics.putCallVolumeRatio,
            ivSkew: options.data.metrics.ivSkew,
          } : undefined,
        };
      })
    );
    candidates.push(...results);
  }

  return { sectors, candidates };
}

/**
 * Format data as a compact string for the LLM prompt.
 */
function formatDataForPrompt(sectors: any[], candidates: Array<{ symbol: string; fundamentals?: any; options?: any }>): string {
  let output = '## Sector Performance\n';
  for (const s of sectors.slice(0, 11)) {
    output += `${s.sector}: ${s.dayChangePercent > 0 ? '+' : ''}${s.dayChangePercent?.toFixed(1)}% today, ${s.weekChangePercent > 0 ? '+' : ''}${s.weekChangePercent?.toFixed(1)}% week\n`;
  }

  output += '\n## Candidates\n';
  for (const c of candidates) {
    const parts = [c.symbol];
    if (c.fundamentals?.sector) parts.push(`sector:${c.fundamentals.sector}`);
    if (c.fundamentals?.pe) parts.push(`PE:${c.fundamentals.pe.toFixed(1)}`);
    if (c.options?.putCallRatio) parts.push(`P/C:${c.options.putCallRatio.toFixed(2)}`);
    if (c.options?.ivSkew) parts.push(`IVSkew:${c.options.ivSkew.toFixed(2)}`);
    output += parts.join(' | ') + '\n';
  }

  return output;
}

/**
 * Run screener with all data passed in prompt - no tools needed.
 */
export async function runScreenerAgent(
  runId: string,
  candidates: Array<{ symbol: string }>,
  deps: ScreenerAgentDeps,
  _config?: ScreenerAgentConfig
): Promise<ScreenerSelection[] | null> {
  if (candidates.length === 0) {
    log.debug('no candidates to screen');
    return [];
  }

  const symbols = candidates.map(c => c.symbol);
  const collector = new RunCollector(runId, 'screener', deps.messagesRepo, deps.artifactsRepo);

  try {
    // 1. Fetch all data upfront
    emitProgress(runId, 'screener', `Fetching data for ${symbols.length} candidates...`, {});
    log.debug('fetching data for candidates', { count: symbols.length });
    const { sectors, candidates: candidateData } = await fetchAllData(symbols, deps.toolsDeps);
    log.debug('data fetched', { sectors: sectors.length, candidates: candidateData.length });

    // 2. Format data for prompt
    const dataBlock = formatDataForPrompt(sectors, candidateData);

    // 3. Build prompt
    const humanContent = `Screen these candidates and select the best 3-8 for investment:\n\n${dataBlock}`;

    collector.writeInitialMessages([
      { role: 'system', content: SCREENER_SYSTEM_PROMPT },
      { role: 'human', content: humanContent },
    ]);

    // 4. Single LLM call
    emitProgress(runId, 'screener', 'Analyzing candidates...', {});
    const llm = getSynthesisLlm();
    const response = await llm.invoke([
      new SystemMessage(SCREENER_SYSTEM_PROMPT),
      new HumanMessage(humanContent),
    ]);

    const content = typeof response.content === 'string'
      ? response.content
      : Array.isArray(response.content)
        ? response.content.map((c: any) => (typeof c === 'string' ? c : c.text ?? '')).join('')
        : '';

    // Record AI response
    deps.messagesRepo.create({
      runId,
      symbol: 'screener',
      seq: 2,
      role: 'ai',
      content,
      toolName: null,
      toolArgsJson: null,
      toolResultJson: null,
      createdAt: Date.now(),
    });

    // 5. Parse JSON response
    let jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
    let raw: any;
    if (jsonMatch) {
      raw = JSON.parse(jsonMatch[1].trim());
    } else {
      jsonMatch = content.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (!jsonMatch) {
        log.warn('no JSON array found in response', { content: content.slice(0, 200) });
        return null;
      }
      raw = JSON.parse(jsonMatch[0]);
    }

    const parsed = z.array(SelectionSchema).parse(raw);
    log.debug('screening complete', { selections: parsed.length });
    return parsed;
  } catch (err) {
    log.warn('screener agent failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
