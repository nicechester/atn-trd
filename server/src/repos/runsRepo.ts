import type Database from 'better-sqlite3';

export type RunTrigger =
  | 'scheduled'
  | 'manual'
  | 'signal_collection'
  | 'plan_review'
  | 'tranche_execution';

export interface AgentRunRow {
  id: string;
  trigger: RunTrigger;
  status: 'running' | 'succeeded' | 'failed' | 'skipped';
  startedAt: number;
  finishedAt: number | null;
  model: string | null;
  settingsSnapshot: string; // JSON
  error: string | null;
  tokenUsageJson: string | null; // JSON
  skipReason: string | null;
  summaryJson: string | null; // JSON - structured "why no trade" audit trail
}

export class RunsRepo {
  constructor(private readonly db: Database.Database) {}

  create(run: Omit<AgentRunRow, 'id'>): string {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO agent_runs (id, trigger, status, started_at, finished_at, model, settings_snapshot, error, token_usage_json, skip_reason, summary_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        run.trigger,
        run.status,
        run.startedAt,
        run.finishedAt,
        run.model,
        run.settingsSnapshot,
        run.error,
        run.tokenUsageJson,
        run.skipReason,
        run.summaryJson
      );
    return id;
  }

  get(id: string): AgentRunRow | undefined {
    return this.db
      .prepare(
        `SELECT id, trigger, status, started_at as startedAt, finished_at as finishedAt,
                model, settings_snapshot as settingsSnapshot, error, token_usage_json as tokenUsageJson,
                skip_reason as skipReason, summary_json as summaryJson
         FROM agent_runs WHERE id = ?`
      )
      .get(id) as AgentRunRow | undefined;
  }

  list(limit: number = 50, offset: number = 0): AgentRunRow[] {
    return this.db
      .prepare(
        `SELECT id, trigger, status, started_at as startedAt, finished_at as finishedAt,
                model, settings_snapshot as settingsSnapshot, error, token_usage_json as tokenUsageJson,
                skip_reason as skipReason, summary_json as summaryJson
         FROM agent_runs ORDER BY started_at DESC LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as AgentRunRow[];
  }

  listByTrigger(trigger: RunTrigger, limit: number = 50): AgentRunRow[] {
    return this.db
      .prepare(
        `SELECT id, trigger, status, started_at as startedAt, finished_at as finishedAt,
                model, settings_snapshot as settingsSnapshot, error, token_usage_json as tokenUsageJson,
                skip_reason as skipReason, summary_json as summaryJson
         FROM agent_runs WHERE trigger = ? ORDER BY started_at DESC LIMIT ?`
      )
      .all(trigger, limit) as AgentRunRow[];
  }

  updateStatus(id: string, status: AgentRunRow['status'], error?: string): void {
    this.db
      .prepare(
        `UPDATE agent_runs SET status = ?, finished_at = ?, error = ? WHERE id = ?`
      )
      .run(status, status === 'running' ? null : Date.now(), error || null, id);
  }

  setSkipped(id: string, reason: string): void {
    this.db
      .prepare(
        `UPDATE agent_runs SET status = ?, finished_at = ?, skip_reason = ? WHERE id = ?`
      )
      .run('skipped', Date.now(), reason, id);
  }

  updateTokenUsage(id: string, tokenUsageJson: string): void {
    this.db
      .prepare(
        `UPDATE agent_runs SET token_usage_json = ? WHERE id = ?`
      )
      .run(tokenUsageJson, id);
  }

  updateSummary(id: string, summaryJson: string): void {
    this.db
      .prepare(
        `UPDATE agent_runs SET summary_json = ? WHERE id = ?`
      )
      .run(summaryJson, id);
  }
}
