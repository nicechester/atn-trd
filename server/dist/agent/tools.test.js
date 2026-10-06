import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentTools } from './tools.ts';
import { RunCache } from '../datasources/cache.ts';
function baseDeps() {
    return {
        newsSource: {},
        fundamentalsSource: {},
        macroSource: {},
        optionsSource: {},
        sectorSource: {},
        pricesRepo: {},
        portfolioService: {},
        decisionsRepo: {},
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
            storeAssessmentEmbedding: async () => { },
            storeArtifactEmbedding: async () => { },
            storeTradeOutcomeEmbedding: async () => { },
        };
        const tools = createAgentTools(deps);
        const names = tools.map((t) => t.name);
        assert.ok(names.includes('get_similar_situations'));
    });
    it('get_similar_situations returns an error payload if semanticMemory is missing at call time', async () => {
        const deps = baseDeps();
        deps.semanticMemory = {
            getSimilarSituations: async () => [],
            storeAssessmentEmbedding: async () => { },
            storeArtifactEmbedding: async () => { },
            storeTradeOutcomeEmbedding: async () => { },
        };
        const tools = createAgentTools(deps);
        const tool = tools.find((t) => t.name === 'get_similar_situations');
        assert.ok(tool, 'expected get_similar_situations to be registered');
        const result = await tool.func({ symbol: 'AAPL', description: 'earnings beat' });
        const parsed = JSON.parse(result);
        assert.ok(Array.isArray(parsed));
    });
});
//# sourceMappingURL=tools.test.js.map