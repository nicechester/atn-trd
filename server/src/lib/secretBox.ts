import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

/**
 * AES-256-GCM envelope: base64url(0x01 || IV(12) || authTag(16) || ciphertext).
 * Key derived from ATN_ENC_KEY via scrypt with a fixed salt.
 * Callers must check secretBoxAvailable() first; seal/open never fall back to plaintext.
 */
const SALT = "atn-trd-secrets-v1";
const VERSION = 0x01;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

let cachedKey: Buffer | null = null;
let cachedKeySource: string | undefined;

function deriveKey(): Buffer {
  const raw = process.env.ATN_ENC_KEY;
  if (!raw) {
    throw new Error(
      "ATN_ENC_KEY is not set; secret encryption is unavailable"
    );
  }
  if (cachedKey && cachedKeySource === raw) return cachedKey;
  cachedKey = scryptSync(raw, SALT, KEY_LEN);
  cachedKeySource = raw;
  return cachedKey;
}

export function secretBoxAvailable(): boolean {
  return !!process.env.ATN_ENC_KEY?.trim();
}

export function seal(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const envelope = Buffer.concat([
    Buffer.from([VERSION]),
    iv,
    authTag,
    ciphertext,
  ]);
  return envelope.toString("base64url");
}

export function open(sealed: string): string {
  const key = deriveKey();
  const envelope = Buffer.from(sealed, "base64url");
  if (envelope.length < 1 + IV_LEN + TAG_LEN) {
    throw new Error("Malformed sealed secret: too short");
  }
  const version = envelope[0];
  if (version !== VERSION) {
    throw new Error(`Unsupported sealed secret version: ${version}`);
  }
  const iv = envelope.subarray(1, 1 + IV_LEN);
  const authTag = envelope.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const ciphertext = envelope.subarray(1 + IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
