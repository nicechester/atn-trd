import type { AgentMessagesRepo } from '../repos/agentMessagesRepo.js';
import type { ArtifactsRepo } from '../repos/artifactsRepo.js';
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
export declare class RunCollector {
    private readonly runId;
    private readonly symbol;
    private readonly messagesRepo;
    private readonly artifactsRepo;
    private seq;
    private modelBuffers;
    private pendingTools;
    constructor(runId: string, symbol: string | null, messagesRepo: AgentMessagesRepo, artifactsRepo: ArtifactsRepo);
    writeInitialMessages(messages: Array<{
        role: 'system' | 'human';
        content: string;
    }>): void;
    handleEvent(event: LangGraphStreamEvent): void;
    private writeArtifact;
}
export declare function createRunCollector(runId: string, symbol: string | null, messagesRepo: AgentMessagesRepo, artifactsRepo: ArtifactsRepo): RunCollector;
export {};
//# sourceMappingURL=runCollector.d.ts.map