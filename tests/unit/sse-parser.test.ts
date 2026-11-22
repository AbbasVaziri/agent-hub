import { describe, expect, it } from "vitest";
import { formatSse, SseParser } from "@/lib/sse/parser";

describe("SSE parser", () => {
  it("parses frames split across arbitrary chunk boundaries", () => {
    const wire = formatSse("chunk", { text: "سلام دنیا" }, 1) + formatSse("done", { ok: true }, 2);
    const bytes = new TextEncoder().encode(wire);
    for (let split = 1; split < bytes.length; split += 3) {
      const p = new SseParser();
      const frames = [...p.push(bytes.slice(0, split)), ...p.push(bytes.slice(split)), ...p.end()];
      expect(frames.map((f) => f.event)).toEqual(["chunk", "done"]);
      expect(JSON.parse(frames[0].data)).toEqual({ text: "سلام دنیا" });
      expect(frames[0].id).toBe("1");
    }
  });

  it("handles multi-byte UTF-8 split in the middle of a character", () => {
    const bytes = new TextEncoder().encode(formatSse("chunk", { text: "۱۲۳" }));
    const p = new SseParser();
    const out = [];
    for (const b of bytes) out.push(...p.push(new Uint8Array([b])));
    expect(JSON.parse(out[0].data).text).toBe("۱۲۳");
  });

  it("ignores comments and heartbeats, supports CRLF and multi-line data", () => {
    const p = new SseParser();
    const frames = p.push(": ping\r\n\r\nevent: x\r\ndata: a\r\ndata: b\r\n\r\n");
    expect(frames).toEqual([{ event: "x", data: "a\nb", id: undefined }]);
  });

  it("defaults the event name to message", () => {
    expect(new SseParser().push("data: 1\n\n")[0].event).toBe("message");
  });
});
