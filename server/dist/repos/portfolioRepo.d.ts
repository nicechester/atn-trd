import type Database from "better-sqlite3";
export interface PortfolioRow {
    cashCents: number;
    startingCashCents: number;
    startedAt: number;
    resetAt: number | null;
    baseCurrency: string;
}
export declare class PortfolioRepo {
    private readonly db;
    constructor(db: Database.Database);
    read(): PortfolioRow | undefined;
    write(row: PortfolioRow): void;
}
//# sourceMappingURL=portfolioRepo.d.ts.map