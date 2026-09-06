import type Database from 'better-sqlite3';
export interface ScreenerSelectionRow {
    id: string;
    runId: string;
    symbol: string;
    rationale: string;
    conviction: number;
    selectedJson: string | null;
    rejectedJson: string | null;
    createdAt: number;
}
export declare class ScreenerSelectionsRepo {
    private readonly db;
    constructor(db: Database.Database);
    create(selection: Omit<ScreenerSelectionRow, 'id' | 'createdAt'>): string;
    get(id: string): ScreenerSelectionRow | undefined;
    listByRun(runId: string): ScreenerSelectionRow[];
    getByRunAndSymbol(runId: string, symbol: string): ScreenerSelectionRow | undefined;
}
//# sourceMappingURL=screenerSelectionsRepo.d.ts.map