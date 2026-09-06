import type Database from "better-sqlite3";
export interface SettingsRow {
    doc: string;
    updatedAt: number;
}
export declare class SettingsRepo {
    private readonly db;
    constructor(db: Database.Database);
    read(): SettingsRow | undefined;
    write(doc: string, updatedAt: number): void;
}
//# sourceMappingURL=settingsRepo.d.ts.map