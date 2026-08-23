import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentTools, type AgentToolsDeps } from './tools.ts';
import { RunCache } from '../datasources/cache.ts';
import type { SemanticMemoryService } from '../services/semanticMemoryService.ts';

function baseDeps(): AgentToolsDeps {
  return {
    newsSource: {} as AgentToolsDeps['newsSource'],
    fundamentalsSource: {} as AgentToolsDeps['fundamentalsSource'],
    macroSource: {} as AgentToolsDeps['macroSource'],
    optionsSource: {} as AgentToolsDeps['optionsSource'],
    sectorSource: {} as AgentToolsDeps['sectorSource'],
    pricesRepo: {} as AgentToolsDeps['pricesRepo'],
    portfolioService: {} as AgentToolsDeps['portfolioService'],
    decisionsRepo: {} as AgentToolsDeps['decisionsRepo'],
    cache: new RunCache(),
  };
}

describe('createAgentTools', () => {
  it('does not register get_similar_situations when semanticMemory is not set', () => {
    const tools = createAgentTools(baseDeps());
    const names = tools.map((t) => t.name);
    assert.ok(!names.includes('get_similar_situations'));
  });

  it('registers get_similar_situations when semanticMemory is set', () => {
    const deps = baseDeps();
    deps.semanticMemory = {
      getSimilarSituations: async () => [],
      storeAssessmentEmbedding: async () => {},
      storeArtifactEmbedding: async () => {},
      storeTradeOutcomeEmbedding: async () => {},
    } as SemanticMemoryService;

    const tools = createAgentTools(deps);
    const names = tools.map((t) => t.name);
    assert.ok(names.includes('get_similar_situations'));
  });

  it('get_similar_situations returns an error payload if semanticMemory is missing at call time', async () => {
    const deps = baseDeps();
    deps.semanticMemory = {
      getSimilarSituations: async () => [],
      storeAssessmentEmbedding: async () => {},
      storeArtifactEmbedding: async () => {},
      storeTradeOutcomeEmbedding: async () => {},
    } as SemanticMemoryService;

    const tools = createAgentTools(deps);
    const tool = tools.find((t) => t.name === 'get_similar_situations');
    assert.ok(tool, 'expected get_similar_situations to be registered');

    const result = await tool!.func({ symbol: 'AAPL', description: 'earnings beat' });
    const parsed = JSON.parse(result as string);
    assert.ok(Array.isArray(parsed));
  });
});
