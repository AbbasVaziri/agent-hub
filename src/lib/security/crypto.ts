import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type KeyRing = { current: number; keys: Map<number, Buffer> };

export function parseKeyRing(raw: string): KeyRing {
  const keys = new Map<number, Buffer>();
  for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const idx = part.indexOf(":");
    if (idx <= 0) throw new Error("ENCRYPTION_KEYS entries must look like 'version:base64key'");
    const version = Number(part.slice(0, idx));
    if (!Number.isInteger(version) || version < 1) throw new Error("Encryption key version must be a positive integer");
    const key = Buffer.from(part.slice(idx + 1), "base64");
    if (key.length !== 32) throw new Error(`Encryption key v${version} must decode to exactly 32 bytes`);
    if (keys.has(version)) throw new Error(`Duplicate encryption key version ${version}`);
    keys.set(version, key);
  }
  if (keys.size === 0) throw new Error("ENCRYPTION_KEYS has no keys");
  return { current: Math.max(...keys.keys()), keys };
}

export type Sealed = { ciphertext: string; keyVersion: number };

/** Output format: base64(iv | tag | ciphertext). The key version is stored next to it. */
export function encryptSecret(plaintext: string, ring: KeyRing, aad?: string): Sealed {
  const key = ring.keys.get(ring.current);
  if (!key) throw new Error("Current encryption key missing");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([iv, tag, body]).toString("base64"), keyVersion: ring.current };
}

export function decryptSecret(sealed: Sealed, ring: KeyRing, aad?: string): string {
  const key = ring.keys.get(sealed.keyVersion);
  if (!key) throw new Error(`Encryption key v${sealed.keyVersion} is not configured`);
  const raw = Buffer.from(sealed.ciphertext, "base64");
  if (raw.length < IV_BYTES + TAG_BYTES) throw new Error("Ciphertext too short");
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const body = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGO, key, iv);
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

export function needsRotation(sealed: Sealed, ring: KeyRing): boolean {
  return sealed.keyVersion !== ring.current;
}

let ringCache: KeyRing | null = null;
export async function appKeyRing(): Promise<KeyRing> {
  if (ringCache) return ringCache;
  const { env } = await import("../env");
  ringCache = parseKeyRing(env().ENCRYPTION_KEYS);
  return ringCache;
}

export function maskKey(hasKey: boolean, last4: string | null): string | null {
  if (!hasKey) return null;
  return last4 ? `••••${last4}` : "••••";
}
