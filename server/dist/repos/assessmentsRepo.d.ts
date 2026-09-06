import type Database from 'better-sqlite3';
export interface AssessmentRow {
    id: string;
    runId: string;
    symbol: string;
    score: number;
    confidence: number;
    thesis: string;
    risks: string | null;
    catalysts: string | null;
    evidenceIdsJson: string | null;
    sentimentSummary: string | null;
    finbertScore: number | null;
    finbertLabel: 'positive' | 'negative' | 'neutral' | null;
    finbertConfidence: number | null;
    createdAt: number;
}
export declare class AssessmentsRepo {
    private readonly db;
    constructor(db: Database.Database);
    create(assessment: Omit<AssessmentRow, 'id' | 'createdAt'>): string;
    get(id: string): AssessmentRow | undefined;
    listByRun(runId: string): AssessmentRow[];
    getByRunAndSymbol(runId: string, symbol: string): AssessmentRow | undefined;
}
//# sourceMappingURL=assessmentsRepo.d.ts.map