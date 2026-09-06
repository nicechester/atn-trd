import type Database from 'better-sqlite3';
export interface AgentMessageRow {
    id: string;
    runId: string;
    symbol: string | null;
    seq: number;
    role: 'system' | 'human' | 'ai' | 'tool';
    content: string;
    toolName: string | null;
    toolArgsJson: string | null;
    toolResultJson: string | null;
    createdAt: number;
}
export declare class AgentMessagesRepo {
    private readonly db;
    constructor(db: Database.Database);
    create(message: Omit<AgentMessageRow, 'id'>): string;
    get(id: string): AgentMessageRow | undefined;
    listByRun(runId: string): AgentMessageRow[];
    listByRunAndSymbol(runId: string, symbol: string): AgentMessageRow[];
    countByRun(runId: string): number;
}
//# sourceMappingURL=agentMessagesRepo.d.ts.map