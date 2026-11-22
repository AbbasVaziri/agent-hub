export type SseFrame = { event: string; data: string; id?: string };

/**
 * Incremental SSE parser. Feed it raw bytes in any split; it handles UTF-8
 * sequences and frames that straddle network reads.
 */
export class SseParser {
  private decoder = new TextDecoder("utf-8");
  private buffer = "";

  push(chunk: Uint8Array | string): SseFrame[] {
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });
    return this.drain();
  }

  end(): SseFrame[] {
    this.buffer += this.decoder.decode();
    const frames = this.drain();
    if (this.buffer.trim()) {
      const last = parseBlock(this.buffer);
      this.buffer = "";
      if (last) frames.push(last);
    }
    return frames;
  }

  private drain(): SseFrame[] {
    const frames: SseFrame[] = [];
    this.buffer = this.buffer.replace(/\r\n?/g, "\n");
    let idx: number;
    while ((idx = this.buffer.indexOf("\n\n")) >= 0) {
      const block = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const frame = parseBlock(block);
      if (frame) frames.push(frame);
    }
    return frames;
  }
}

function parseBlock(block: string): SseFrame | null {
  let event = "message";
  let id: string | undefined;
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else if (field === "id") id = value;
  }
  if (data.length === 0) return null;
  return { event, data: data.join("\n"), id };
}

export function formatSse(event: string, data: unknown, id?: string | number): string {
  const payload = JSON.stringify(data)
    .split("\n")
    .map((l) => `data: ${l}`)
    .join("\n");
  return `${id !== undefined ? `id: ${id}\n` : ""}event: ${event}\n${payload}\n\n`;
}
