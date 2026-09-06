import Database from 'better-sqlite3';
export interface Migration {
    version: number;
    name: string;
    sql: string;
}
export declare function runMigrations(db: Database.Database, migrationsDir: string): void;
//# sourceMappingURL=migrate.d.ts.map