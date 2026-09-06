import { type AgentToolsDeps } from './tools.js';
import type { AgentMessagesRepo } from '../repos/agentMessagesRepo.js';
import type { ArtifactsRepo } from '../repos/artifactsRepo.js';
import type { InvestorProfile } from '@atn-trd/shared';
export interface SymbolAssessment {
    symbol: string;
    score: number;
    confidence: number;
    thesis: string;
    risks: string | null;
    catalysts: string | null;
    sentimentSummary: string;
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
export declare function runAnalystAgent(runId: string, symbol: string, deps: AnalystAgentDeps, config?: AnalystAgentConfig): Promise<SymbolAssessment | null>;
//# sourceMappingURL=analystAgent.d.ts.map