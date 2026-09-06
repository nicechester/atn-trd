import type Database from 'better-sqlite3';
export interface ResearchArtifactRow {
    id: string;
    runId: string;
    symbol: string | null;
    source: 'news' | 'fundamentals' | 'macro' | 'options' | 'prices';
    provider: string;
    fetchedAt: number;
    payloadJson: string;
    summary: string | null;
    citationsJson: string | null;
}
export declare class ArtifactsRepo {
    private readonly db;
    constructor(db: Database.Database);
    create(artifact: Omit<ResearchArtifactRow, 'id'>): string;
    get(id: string): ResearchArtifactRow | undefined;
    listByRun(runId: string): ResearchArtifactRow[];
    listByRunAndSymbol(runId: string, symbol: string): ResearchArtifactRow[];
}
//# sourceMappingURL=artifactsRepo.d.ts.map