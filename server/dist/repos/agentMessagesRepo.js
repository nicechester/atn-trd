export class AgentMessagesRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    create(message) {
        const id = crypto.randomUUID();
        this.db
            .prepare(`INSERT INTO agent_messages (id, run_id, symbol, seq, role, content, tool_name, tool_args_json, tool_result_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, message.runId, message.symbol, message.seq, message.role, message.content, message.toolName, message.toolArgsJson, message.toolResultJson, message.createdAt);
        return id;
    }
    get(id) {
        return this.db
            .prepare(`SELECT id, run_id as runId, symbol, seq, role, content, tool_name as toolName,
                tool_args_json as toolArgsJson, tool_result_json as toolResultJson, created_at as createdAt
         FROM agent_messages WHERE id = ?`)
            .get(id);
    }
    listByRun(runId) {
        return this.db
            .prepare(`SELECT id, run_id as runId, symbol, seq, role, content, tool_name as toolName,
                tool_args_json as toolArgsJson, tool_result_json as toolResultJson, created_at as createdAt
         FROM agent_messages WHERE run_id = ? ORDER BY seq`)
            .all(runId);
    }
    listByRunAndSymbol(runId, symbol) {
        return this.db
            .prepare(`SELECT id, run_id as runId, symbol, seq, role, content, tool_name as toolName,
                tool_args_json as toolArgsJson, tool_result_json as toolResultJson, created_at as createdAt
         FROM agent_messages WHERE run_id = ? AND symbol = ? ORDER BY seq`)
            .all(runId, symbol);
    }
    countByRun(runId) {
        const result = this.db
            .prepare('SELECT COUNT(*) as count FROM agent_messages WHERE run_id = ?')
            .get(runId);
        return result.count;
    }
}
//# sourceMappingURL=agentMessagesRepo.js.map