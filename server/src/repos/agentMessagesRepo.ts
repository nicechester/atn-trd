import type Database from 'better-sqlite3';

export interface AgentMessageRow {
  id: string;
  runId: string;
  symbol: string | null;
  seq: number;
  role: 'system' | 'human' | 'ai' | 'tool';
  content: string;
  toolName: string | null;
  toolArgsJson: string | null; // JSON
  toolResultJson: string | null; // JSON
  createdAt: number;
}

export class AgentMessagesRepo {
  constructor(private readonly db: Database.Database) {}

  create(message: Omit<AgentMessageRow, 'id'>): string {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO agent_messages (id, run_id, symbol, seq, role, content, tool_name, tool_args_json, tool_result_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        message.runId,
        message.symbol,
        message.seq,
        message.role,
        message.content,
        message.toolName,
        message.toolArgsJson,
        message.toolResultJson,
        message.createdAt
      );
    return id;
  }

  get(id: string): AgentMessageRow | undefined {
    return this.db
      .prepare(
        `SELECT id, run_id as runId, symbol, seq, role, content, tool_name as toolName,
                tool_args_json as toolArgsJson, tool_result_json as toolResultJson, created_at as createdAt
         FROM agent_messages WHERE id = ?`
      )
      .get(id) as AgentMessageRow | undefined;
  }

  listByRun(runId: string): AgentMessageRow[] {
    return this.db
      .prepare(
        `SELECT id, run_id as runId, symbol, seq, role, content, tool_name as toolName,
                tool_args_json as toolArgsJson, tool_result_json as toolResultJson, created_at as createdAt
         FROM agent_messages WHERE run_id = ? ORDER BY seq`
      )
      .all(runId) as AgentMessageRow[];
  }

  listByRunAndSymbol(runId: string, symbol: string): AgentMessageRow[] {
    return this.db
      .prepare(
        `SELECT id, run_id as runId, symbol, seq, role, content, tool_name as toolName,
                tool_args_json as toolArgsJson, tool_result_json as toolResultJson, created_at as createdAt
         FROM agent_messages WHERE run_id = ? AND symbol = ? ORDER BY seq`
      )
      .all(runId, symbol) as AgentMessageRow[];
  }

  countByRun(runId: string): number {
    const result = this.db
      .prepare('SELECT COUNT(*) as count FROM agent_messages WHERE run_id = ?')
      .get(runId) as { count: number };
    return result.count;
  }
}
