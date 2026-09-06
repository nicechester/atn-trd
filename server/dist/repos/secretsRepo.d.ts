import type Database from "better-sqlite3";
export interface SecretRow {
    name: string;
    valueEnc: string;
    updatedAt: number;
}
export interface SecretMeta {
    name: string;
    updatedAt: number;
}
export declare class SecretsRepo {
    private readonly db;
    constructor(db: Database.Database);
    getEncrypted(name: string): SecretRow | undefined;
    upsert(name: string, valueEnc: string, updatedAt: number): void;
    delete(name: string): void;
    listMeta(): SecretMeta[];
}
//# sourceMappingURL=secretsRepo.d.ts.map