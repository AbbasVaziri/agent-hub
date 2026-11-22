import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret, needsRotation, parseKeyRing } from "@/lib/security/crypto";

const k = () => randomBytes(32).toString("base64");

describe("API key encryption", () => {
  const ring = parseKeyRing(`1:${k()}`);

  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptSecret("sk-secret-value", ring, "ws:conn");
    const b = encryptSecret("sk-secret-value", ring, "ws:conn");
    expect(a.ciphertext).not.toEqual(b.ciphertext);
    expect(decryptSecret(a, ring, "ws:conn")).toBe("sk-secret-value");
    expect(a.ciphertext).not.toContain("sk-secret");
  });

  it("rejects tampered ciphertext", () => {
    const s = encryptSecret("hello", ring);
    const raw = Buffer.from(s.ciphertext, "base64");
    raw[raw.length - 1] ^= 0xff;
    expect(() => decryptSecret({ ...s, ciphertext: raw.toString("base64") }, ring)).toThrow();
  });

  it("binds ciphertext to its connection through AAD", () => {
    const s = encryptSecret("hello", ring, "ws1:conn1");
    expect(() => decryptSecret(s, ring, "ws2:conn1")).toThrow();
  });

  it("supports rotation: old versions decrypt, newest encrypts", () => {
    const old = parseKeyRing(`1:${k()}`);
    const sealed = encryptSecret("rotate-me", old);
    const rotated = parseKeyRing(`1:${[...old.keys.values()][0].toString("base64")},2:${k()}`);
    expect(rotated.current).toBe(2);
    expect(needsRotation(sealed, rotated)).toBe(true);
    expect(decryptSecret(sealed, rotated)).toBe("rotate-me");
    expect(encryptSecret("x", rotated).keyVersion).toBe(2);
  });

  it("validates key format and length", () => {
    expect(() => parseKeyRing("")).toThrow();
    expect(() => parseKeyRing("1:" + randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
    expect(() => parseKeyRing("nope")).toThrow();
    expect(() => parseKeyRing(`1:${k()},1:${k()}`)).toThrow(/Duplicate/);
  });
});
