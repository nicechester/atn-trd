import { EventEmitter } from "node:events";
import { z } from "zod";
import { SettingsSchema, PatchSettingsRequestSchema, } from "@atn-trd/shared";
import { getDatabase } from "../db/index";
import { SettingsRepo } from "../repos/settingsRepo";
import { SecretsRepo } from "../repos/secretsRepo";
import { seal, open, secretBoxAvailable } from "../lib/secretBox";
import { ValidationError, EncryptionUnavailableError } from "../lib/errors";
let cache = null;
export const settingsEvents = new EventEmitter();
function getRepos() {
    const db = getDatabase();
    return { settingsRepo: new SettingsRepo(db), secretsRepo: new SecretsRepo(db) };
}
function isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
function deepMerge(base, patch) {
    if (!isPlainObject(base) || !isPlainObject(patch)) {
        return patch === undefined ? base : patch;
    }
    const result = { ...base };
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined)
            continue;
        result[key] = deepMerge(base[key], value);
    }
    return result;
}
function loadFromDb() {
    const { settingsRepo } = getRepos();
    const row = settingsRepo.read();
    const raw = row ? JSON.parse(row.doc) : {};
    // Migrate old sellThreshold from [-1,0] scale to [0,1] scale
    let needsMigration = false;
    if (raw.signals?.sellThreshold !== undefined && raw.signals.sellThreshold < 0) {
        // Convert: old -0.50 → new 0.25 (formula: (old + 1) / 2)
        raw.signals.sellThreshold = (raw.signals.sellThreshold + 1) / 2;
        needsMigration = true;
    }
    const settings = SettingsSchema.parse(raw);
    // Persist migrated settings
    if (needsMigration) {
        settings.updatedAt = Date.now();
        settingsRepo.write(JSON.stringify(settings), settings.updatedAt);
    }
    return settings;
}
export function getSettings() {
    if (cache)
        return structuredClone(cache);
    const settings = loadFromDb();
    cache = settings;
    return structuredClone(settings);
}
export function invalidateSettingsCache() {
    cache = null;
}
export function updateSettings(patch) {
    let validatedPatch;
    try {
        validatedPatch = PatchSettingsRequestSchema.parse(patch);
    }
    catch (err) {
        if (err instanceof z.ZodError)
            throw new ValidationError("Invalid settings patch", err.issues);
        throw err;
    }
    const merged = deepMerge(getSettings(), validatedPatch);
    let validated;
    try {
        validated = SettingsSchema.parse(merged);
    }
    catch (err) {
        if (err instanceof z.ZodError)
            throw new ValidationError("Invalid settings patch", err.issues);
        throw err;
    }
    validated.updatedAt = Date.now();
    const { settingsRepo } = getRepos();
    settingsRepo.write(JSON.stringify(validated), validated.updatedAt);
    invalidateSettingsCache();
    settingsEvents.emit("change", validated);
    return structuredClone(validated);
}
export function getSecret(name) {
    const { secretsRepo } = getRepos();
    const row = secretsRepo.getEncrypted(name);
    if (!row)
        return undefined;
    return open(row.valueEnc);
}
export function setSecret(name, value) {
    if (!secretBoxAvailable())
        throw new EncryptionUnavailableError();
    const { secretsRepo } = getRepos();
    secretsRepo.upsert(name, seal(value), Date.now());
}
export function clearSecret(name) {
    const { secretsRepo } = getRepos();
    secretsRepo.delete(name);
}
/** Known secrets that may be supplied via environment variables. */
const ENV_SECRET_NAMES = ['FINNHUB_API_KEY', 'FRED_API_KEY', 'LLM_API_KEY', 'OPENAI_API_KEY'];
export function listSecretStatus() {
    const { secretsRepo } = getRepos();
    const dbSecrets = secretsRepo.listMeta();
    const dbNames = new Set(dbSecrets.map((m) => m.name));
    const result = dbSecrets.map((m) => ({ name: m.name, isSet: true, updatedAt: m.updatedAt }));
    for (const name of ENV_SECRET_NAMES) {
        if (!dbNames.has(name) && process.env[name]?.trim()) {
            result.push({ name, isSet: true });
        }
    }
    return result;
}
export function resolveSecret(name) {
    return getSecret(name) ?? process.env[name];
}
//# sourceMappingURL=settingsService.js.map