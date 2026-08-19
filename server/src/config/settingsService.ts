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
  const raw = row ? JSON.parse(row.doc) : {};
  return SettingsSchema.parse(raw);
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
  let validatedPatch: PatchSettingsRequest;
  try {
    validatedPatch = PatchSettingsRequestSchema.parse(patch);
  } catch (err) {
    if (err instanceof z.ZodError) throw new ValidationError("Invalid settings patch", err.issues);
    throw err;
  }

  const merged = deepMerge(getSettings(), validatedPatch);

  let validated: Settings;
  try {
    validated = SettingsSchema.parse(merged);
  } catch (err) {
    if (err instanceof z.ZodError) throw new ValidationError("Invalid settings patch", err.issues);
    throw err;
  }

  validated.updatedAt = Date.now();

  const { settingsRepo } = getRepos();
  settingsRepo.write(JSON.stringify(validated), validated.updatedAt);

  invalidateSettingsCache();
  settingsEvents.emit("change", validated);

  return structuredClone(validated);
}

export function getSecret(name: string): string | undefined {
  const { secretsRepo } = getRepos();
  const row = secretsRepo.getEncrypted(name);
  if (!row) return undefined;
  return open(row.valueEnc);
}

export function setSecret(name: string, value: string): void {
  if (!secretBoxAvailable()) throw new EncryptionUnavailableError();
  const { secretsRepo } = getRepos();
  secretsRepo.upsert(name, seal(value), Date.now());
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
  const dbNames = new Set(dbSecrets.map((m) => m.name));
  const result: SecretStatus[] = dbSecrets.map((m) => ({ name: m.name, isSet: true, updatedAt: m.updatedAt }));

  for (const name of ENV_SECRET_NAMES) {
    if (!dbNames.has(name) && process.env[name]?.trim()) {
      result.push({ name, isSet: true });
    }
  }

  return result;
}

export function resolveSecret(name: string): string | undefined {
  return getSecret(name) ?? process.env[name];
}
