import { type ScreenerToolsDeps } from './screenerTools.js';
import type { AgentMessagesRepo } from '../repos/agentMessagesRepo.js';
import type { ArtifactsRepo } from '../repos/artifactsRepo.js';
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
export declare function runScreenerAgent(runId: string, candidates: Array<{
    symbol: string;
}>, deps: ScreenerAgentDeps, config?: ScreenerAgentConfig): Promise<ScreenerSelection[] | null>;
//# sourceMappingURL=screenerAgent.d.ts.map