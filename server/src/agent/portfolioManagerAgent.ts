import { z } from 'zod';
import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { resolveConfig, resolveApiKey, LlmNotConfiguredError } from '../llm/openaiChatModel.js';
import { PORTFOLIO_MANAGER_SYSTEM_PROMPT } from '../llm/prompts/portfolioManager.js';
import type { SymbolAssessment } from './analystAgent.js';
import type { DecisionSet } from '@atn-trd/shared';
import { logger } from '../lib/logger.js';

/* -------------------------------------------------------------------------- */
/* Local Schemas (not exported)                                              */
/* -------------------------------------------------------------------------- */

const LlmDecisionSchema = z.object({
  symbol: z.string(),
  action: z.enum(['buy', 'sell', 'hold', 'trim', 'add']),
  targetWeight: z.number().min(0).max(1).nullable(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  priority: z.number().int().min(1),
});

const LlmDecisionSetSchema = z.object({
  decisions: z.array(LlmDecisionSchema),
});

/* -------------------------------------------------------------------------- */
/* Exported Interfaces                                                        */
/* -------------------------------------------------------------------------- */

export interface PortfolioContext {
  cashPercent: number;
  currentPositions: string[];
  positionCount: number;
}

export interface PortfolioConstraints {
  maxPositionWeightPercent: number;
  maxConcurrentPositions: number;
  maxNewPositionsPerRun: number;
  minCashReservePercent: number;
  minConfidenceThreshold: number;
  symbolBlocklist: string[];
}

export interface PortfolioManagerAgentConfig {
  model?: string;
  temperature?: number;
}

/* -------------------------------------------------------------------------- */
/* Logger                                                                     */
/* -------------------------------------------------------------------------- */

const log = logger.child({ component: 'portfolio-manager-agent' });

/* -------------------------------------------------------------------------- */
/* Private Helper: buildHumanMessage                                          */
/* -------------------------------------------------------------------------- */

function buildHumanMessage(
  assessments: SymbolAssessment[],
  ctx: PortfolioContext,
  constraints: PortfolioConstraints
): string {
  const positionsStr =
    ctx.currentPositions.length === 0 ? 'none' : ctx.currentPositions.join(', ');

  const blocklist = constraints.symbolBlocklist.length === 0 ? 'none' : constraints.symbolBlocklist.join(', ');

  const parts: string[] = [
    'PORTFOLIO CONTEXT',
    '=================',
    `Current positions (${ctx.positionCount}): ${positionsStr}`,
    `Cash available: ${ctx.cashPercent.toFixed(1)}%`,
    '',
    'PORTFOLIO CONSTRAINTS',
    '=====================',
    `Max position weight: ${constraints.maxPositionWeightPercent}%`,
    `Max concurrent positions: ${constraints.maxConcurrentPositions}`,
    `Max new positions this run: ${constraints.maxNewPositionsPerRun}`,
    `Min cash reserve: ${constraints.minCashReservePercent}%`,
    `Min confidence threshold: ${constraints.minConfidenceThreshold.toFixed(2)}`,
    `Blocked symbols: ${blocklist}`,
    '',
    `ANALYST ASSESSMENTS (${assessments.length} symbols)`,
    '================================',
    '',
  ];

  // Format each assessment
  for (const assessment of assessments) {
    const scoreLabel =
      assessment.score >= 0.3
        ? 'bullish'
        : assessment.score <= -0.3
          ? 'bearish'
          : 'neutral';

    const riskStr = assessment.risks ? assessment.risks : '(none)';
    const catalystsStr = assessment.catalysts ? assessment.catalysts : '(none)';

    parts.push(
      `[${assessment.symbol}]`,
      `Score: ${assessment.score.toFixed(2)} (${scoreLabel}) | Confidence: ${assessment.confidence.toFixed(2)}`,
      `Thesis: ${assessment.thesis}`,
      `Risks: ${riskStr}`,
      `Catalysts: ${catalystsStr}`,
      ''
    );
  }

  parts.push(
    '---',
    '',
    `Provide exactly one decision for each of the ${assessments.length} symbols above.`
  );

  return parts.join('\n');
}

/* -------------------------------------------------------------------------- */
/* Main Function                                                              */
/* -------------------------------------------------------------------------- */

export async function runPortfolioManagerAgent(
  runId: string,
  assessments: SymbolAssessment[],
  portfolioContext: PortfolioContext,
  constraints: PortfolioConstraints,
  config?: PortfolioManagerAgentConfig
): Promise<DecisionSet | null> {
  try {
    // 1. Guard: no assessments
    if (assessments.length === 0) {
      log.warn('no assessments provided');
      return null;
    }

    // 2. Resolve config and API key
    const resolved = resolveConfig({
      model: config?.model,
      temperature: config?.temperature ?? 0,
    });
    const apiKey = resolveApiKey();
    if (!apiKey) throw new LlmNotConfiguredError();

    // 3. Instantiate ChatOpenAI
    const llm = new ChatOpenAI({
      apiKey,
      model: resolved.model,
      temperature: 0,
      timeout: resolved.timeoutMs,
      maxRetries: 0,
      ...(resolved.baseUrl ? { configuration: { baseURL: resolved.baseUrl } } : {}),
    });

    // 4. Build messages
    const humanMessage = buildHumanMessage(assessments, portfolioContext, constraints);
    const messages = [
      new SystemMessage(PORTFOLIO_MANAGER_SYSTEM_PROMPT),
      new HumanMessage(humanMessage),
    ];

    // 5. Log debug
    log.debug('starting portfolio manager agent', {
      runId,
      symbolCount: assessments.length,
      model: resolved.model,
    });

    // 6. Two-attempt structured output loop
    let parsed: z.infer<typeof LlmDecisionSetSchema> | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // Try withStructuredOutput if available; fall back to manual JSON parsing
        let raw: any;
        try {
          raw = await (llm as any).withStructuredOutput(LlmDecisionSetSchema).invoke(messages);
        } catch (err) {
          // Fallback: manual JSON extraction and parsing
          const response = await llm.invoke(messages);
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

        parsed = LlmDecisionSetSchema.parse(raw);
        log.debug('portfolio manager output complete', {
          runId,
          decisionCount: parsed.decisions.length,
        });
        break;
      } catch (err) {
        if (attempt === 0) {
          log.warn('structured output attempt failed, retrying', {
            runId,
            error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }
        throw err;
      }
    }

    if (!parsed) {
      log.warn('portfolio manager agent failed to parse output');
      return null;
    }

    // 7. Sort by priority ascending
    const sortedDecisions = parsed.decisions.sort((a, b) => a.priority - b.priority);

    // 8. Build input symbol set for validation
    const inputSymbols = new Set(assessments.map((a) => a.symbol.toUpperCase()));

    // 9. Map and filter, validate input symbols
    const decisions = sortedDecisions
      .filter((d) => {
        if (!inputSymbols.has(d.symbol.toUpperCase())) {
          log.warn('dropping invented symbol', { symbol: d.symbol });
          return false;
        }
        return true;
      })
      .map((d) => ({
        symbol: d.symbol.toUpperCase(),
        action: d.action,
        targetWeight: d.targetWeight ?? undefined,
        confidence: d.confidence,
        rationale: d.rationale,
        runId,
      }));

    // 10. Warn if count mismatch
    if (decisions.length !== assessments.length) {
      log.warn('decision count mismatch', {
        expected: assessments.length,
        got: decisions.length,
      });
    }

    // 11. Log debug with action summary
    log.debug('portfolio manager decisions', {
      runId,
      count: decisions.length,
      actions: decisions.map((d) => `${d.symbol}:${d.action}`).join(', '),
    });

    // 12. Return DecisionSet
    return {
      decisions,
      timestamp: Date.now(),
    };
  } catch (err) {
    log.warn('portfolio manager agent failed', {
      runId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
