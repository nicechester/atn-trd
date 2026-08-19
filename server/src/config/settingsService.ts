import { EventEmitter } from "node:events";
import { z } from "zod";
import {
  SettingsSchema,
  PatchSettingsRequestSchema,
  type Settings,
  type PatchSettingsRequest,
  type SecretStatus,
} from "@atn-trd/shared";
import { getDatabase } from "../db/index";
import { SettingsRepo } from "../repos/settingsRepo";
import { SecretsRepo } from "../repos/secretsRepo";
import { seal, open, secretBoxAvailable } from "../lib/secretBox";
import { ValidationError, EncryptionUnavailableError } from "../lib/errors";

let cache: Settings | null = null;

export const settingsEvents = new EventEmitter();

function getRepos() {
  const db = getDatabase();
  return { settingsRepo: new SettingsRepo(db), secretsRepo: new SecretsRepo(db) };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch === undefined ? base : (patch as T);
  }
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    result[key] = deepMerge((base as Record<string, unknown>)[key], value);
  }
  return result as T;
}

function loadFromDb(): Settings {
  const { settingsRepo } = getRepos();
  const row = settingsRepo.read();
  console.log('[DEBUG] settingsService.loadFromDb() - DB row:', row ? 'EXISTS (length: ' + row.doc.length + ')' : 'NOT FOUND');
  if (row) {
    try {
      const parsed = JSON.parse(row.doc);
      console.log('[DEBUG] settingsService.loadFromDb() - Parsed JSON keys:', Object.keys(parsed));
    } catch (e) {
      console.log('[DEBUG] settingsService.loadFromDb() - JSON parse error:', e);
    }
  }
  const raw = row ? JSON.parse(row.doc) : {};
  const result = SettingsSchema.parse(raw);
  console.log('[DEBUG] settingsService.loadFromDb() - After schema parse, dataSources configured:',
    Object.entries(result.dataSources).map(([id, cfg]) => `${id}:${cfg.provider}`)
  );
  return result;
}

export function getSettings(): Settings {
  if (cache) return structuredClone(cache);
  const settings = loadFromDb();
  cache = settings;
  return structuredClone(settings);
}

export function invalidateSettingsCache(): void {
  cache = null;
}

export function updateSettings(patch: PatchSettingsRequest): Settings {
  console.log(`[DEBUG] updateSettings() - Starting with patch keys:`, Object.keys(patch).join(', '));

  let validatedPatch: PatchSettingsRequest;
  try {
    validatedPatch = PatchSettingsRequestSchema.parse(patch);
    console.log(`[DEBUG] updateSettings() - Patch validation passed`);
  } catch (err) {
    console.log(`[DEBUG] updateSettings() - Patch validation error:`, err instanceof z.ZodError ? JSON.stringify(err.issues) : String(err));
    if (err instanceof z.ZodError) {
      throw new ValidationError("Invalid settings patch", err.issues);
    }
    throw err;
  }

  const current = getSettings();
  console.log(`[DEBUG] updateSettings() - Current settings loaded`);

  const merged = deepMerge(current, validatedPatch);
  console.log(`[DEBUG] updateSettings() - Deep merge completed`);

  let validated: Settings;
  try {
    validated = SettingsSchema.parse(merged);
    console.log(`[DEBUG] updateSettings() - Merged settings validation passed`);
  } catch (err) {
    console.log(`[DEBUG] updateSettings() - Merged settings validation error:`, err instanceof z.ZodError ? JSON.stringify(err.issues) : String(err));
    if (err instanceof z.ZodError) {
      throw new ValidationError("Invalid settings patch", err.issues);
    }
    throw err;
  }

  validated.updatedAt = Date.now();
  console.log(`[DEBUG] updateSettings() - Updated timestamp to ${validated.updatedAt}`);

  const { settingsRepo } = getRepos();
  try {
    const jsonStr = JSON.stringify(validated);
    console.log(`[DEBUG] updateSettings() - JSON serialized, length: ${jsonStr.length}`);
    settingsRepo.write(jsonStr, validated.updatedAt);
    console.log(`[DEBUG] updateSettings() - Written to DB successfully`);
  } catch (err) {
    console.log(`[DEBUG] updateSettings() - Error writing to DB:`, err instanceof Error ? err.message : String(err));
    throw err;
  }

  invalidateSettingsCache();
  console.log(`[DEBUG] updateSettings() - Cache invalidated`);

  settingsEvents.emit("change", validated);
  console.log(`[DEBUG] updateSettings() - Change event emitted`);

  return structuredClone(validated);
}

export function getSecret(name: string): string | undefined {
  const { secretsRepo } = getRepos();
  const row = secretsRepo.getEncrypted(name);
  console.log(`[DEBUG] settingsService.getSecret('${name}') - DB row:`, row ? 'FOUND' : 'NOT FOUND');
  if (!row) {
    console.log(`[DEBUG] settingsService.getSecret('${name}') - Returning undefined`);
    return undefined;
  }
  const decrypted = open(row.valueEnc);
  console.log(`[DEBUG] settingsService.getSecret('${name}') - Decrypted successfully, length: ${decrypted.length}`);
  return decrypted;
}

export function setSecret(name: string, value: string): void {
  console.log(`[DEBUG] setSecret('${name}', value_length: ${value.length}) - Starting`);
  console.log(`[DEBUG] setSecret('${name}') - secretBoxAvailable: ${secretBoxAvailable()}`);

  if (!secretBoxAvailable()) {
    console.log(`[DEBUG] setSecret('${name}') - ERROR: encryption unavailable`);
    throw new EncryptionUnavailableError();
  }

  const { secretsRepo } = getRepos();
  try {
    const sealed = seal(value);
    console.log(`[DEBUG] setSecret('${name}') - Sealed successfully, encrypted_length: ${sealed.length}`);
    secretsRepo.upsert(name, sealed, Date.now());
    console.log(`[DEBUG] setSecret('${name}') - Upserted to DB successfully`);
  } catch (err) {
    console.log(`[DEBUG] setSecret('${name}') - ERROR during seal/upsert:`, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export function clearSecret(name: string): void {
  const { secretsRepo } = getRepos();
  secretsRepo.delete(name);
}

/** Known secrets that may be supplied via environment variables. */
const ENV_SECRET_NAMES = ['FINNHUB_API_KEY', 'FRED_API_KEY', 'LLM_API_KEY', 'OPENAI_API_KEY'];

export function listSecretStatus(): SecretStatus[] {
  const { secretsRepo } = getRepos();
  const dbSecrets = secretsRepo.listMeta();
  console.log(`[DEBUG] listSecretStatus() - DB secrets: ${dbSecrets.map(m => m.name).join(', ') || 'NONE'}`);

  const dbNames = new Set(dbSecrets.map((m) => m.name));
  const result: SecretStatus[] = dbSecrets.map((m) => ({ name: m.name, isSet: true, updatedAt: m.updatedAt }));

  for (const name of ENV_SECRET_NAMES) {
    const envValue = process.env[name]?.trim();
    console.log(`[DEBUG] listSecretStatus() - Checking env var '${name}': ${envValue ? 'FOUND' : 'NOT FOUND'}`);
    if (!dbNames.has(name) && envValue) {
      console.log(`[DEBUG] listSecretStatus() - Adding env var '${name}' to results`);
      result.push({ name, isSet: true });
    }
  }

  console.log(`[DEBUG] listSecretStatus() - Final result: ${result.map(r => r.name).join(', ')}`);
  return result;
}

export function resolveSecret(name: string): string | undefined {
  const fromDb = getSecret(name);
  console.log(`[DEBUG] settingsService.resolveSecret('${name}') - From DB:`, fromDb ? 'FOUND' : 'NOT FOUND');
  if (fromDb) return fromDb;

  const fromEnv = process.env[name];
  console.log(`[DEBUG] settingsService.resolveSecret('${name}') - From env:`, fromEnv ? 'FOUND (length: ' + fromEnv.length + ')' : 'NOT FOUND');
  return fromEnv;
}
