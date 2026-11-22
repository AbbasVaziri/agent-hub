import { describe, expect, it } from "vitest";
import { redact } from "@/lib/logger";

describe("log redaction", () => {
  it("removes secrets by key name and by value pattern", () => {
    const out = redact({ apiKey: "abc", nested: { Authorization: "Bearer xyz" }, note: "key is sk-abcdefghijklmnop here" }) as Record<string, unknown>;
    expect(out.apiKey).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).Authorization).toBe("[redacted]");
    expect(out.note).toBe("key is [redacted] here");
  });
});
