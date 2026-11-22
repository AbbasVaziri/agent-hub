import { describe, expect, it } from "vitest";
import { isPrivateAddress, safeRequest, validateOutboundUrl, OutboundBlockedError } from "@/lib/security/ssrf";

const strict = { allowPrivate: false };

describe("SSRF guard", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::a00:1",
  ])("treats %s as private", (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("treats %s as public", (ip) => expect(isPrivateAddress(ip)).toBe(false));

  it.each([
    "http://api.example.com/v1",
    "ftp://example.com",
    "file:///etc/passwd",
    "https://user:pass@example.com",
    "https://localhost/v1",
    "https://127.0.0.1/v1",
    "https://[::1]/v1",
    "https://169.254.169.254/latest/meta-data",
    "https://metadata.google.internal/",
    "https://foo.localhost/",
    "not a url",
  ])("blocks %s in strict mode", (url) => expect(() => validateOutboundUrl(url, strict)).toThrow(OutboundBlockedError));

  it("allows a public https URL", () => {
    expect(validateOutboundUrl("https://api.openai.com/v1", strict).hostname).toBe("api.openai.com");
  });

  it("trusted mode allows private hosts but still blocks other protocols and credentials", () => {
    const trusted = { allowPrivate: true };
    expect(validateOutboundUrl("http://127.0.0.1:11434/v1", trusted).port).toBe("11434");
    expect(() => validateOutboundUrl("file:///etc/passwd", trusted)).toThrow();
    expect(() => validateOutboundUrl("http://a:b@127.0.0.1/", trusted)).toThrow();
  });

  it("blocks hostnames that resolve to private addresses at connect time (DNS rebinding)", async () => {
    // localhost.localtest.me style names are not needed: any name resolving to loopback works.
    await expect(safeRequest("https://localhost.", {}, strict)).rejects.toBeInstanceOf(OutboundBlockedError);
  });
});
