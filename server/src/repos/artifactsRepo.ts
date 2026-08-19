import type Database from 'better-sqlite3';

export interface ResearchArtifactRow {
  id: string;
  runId: string;
  symbol: string | null;
  source: 'news' | 'fundamentals' | 'macro' | 'options' | 'prices';
  provider: string;
  fetchedAt: number;
  payloadJson: string; // JSON
  summary: string | null;
  citationsJson: string | null; // JSON array
}

export class ArtifactsRepo {
  constructor(private readonly db: Database.Database) {}

  create(artifact: Omit<ResearchArtifactRow, 'id'>): string {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO research_artifacts (id, run_id, symbol, source, provider, fetched_at, payload_json, summary, citations_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        artifact.runId,
        artifact.symbol,
        artifact.source,
        artifact.provider,
        artifact.fetchedAt,
        artifact.payloadJson,
        artifact.summary,
        artifact.citationsJson
      );
    return id;
  }

  get(id: string): ResearchArtifactRow | undefined {
    return this.db
      .prepare(
        `SELECT id, run_id as runId, symbol, source, provider, fetched_at as fetchedAt,
                payload_json as payloadJson, summary, citations_json as citationsJson
         FROM research_artifacts WHERE id = ?`
      )
      .get(id) as ResearchArtifactRow | undefined;
  }

  listByRun(runId: string): ResearchArtifactRow[] {
    return this.db
      .prepare(
        `SELECT id, run_id as runId, symbol, source, provider, fetched_at as fetchedAt,
                payload_json as payloadJson, summary, citations_json as citationsJson
         FROM research_artifacts WHERE run_id = ? ORDER BY fetched_at`
      )
      .all(runId) as ResearchArtifactRow[];
  }

  listByRunAndSymbol(runId: string, symbol: string): ResearchArtifactRow[] {
    return this.db
      .prepare(
        `SELECT id, run_id as runId, symbol, source, provider, fetched_at as fetchedAt,
                payload_json as payloadJson, summary, citations_json as citationsJson
         FROM research_artifacts WHERE run_id = ? AND symbol = ? ORDER BY fetched_at`
      )
      .all(runId, symbol) as ResearchArtifactRow[];
  }
}
