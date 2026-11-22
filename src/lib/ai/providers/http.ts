import { safeRequest, OutboundBlockedError, type SafeResponse } from "@/lib/security/ssrf";
import { SseParser, type SseFrame } from "@/lib/sse/parser";
import { ProviderError, type ConnectionConfig } from "./types";

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function kindForStatus(status: number) {
  if (status === 401 || status === 403) return "auth" as const;
  if (status === 404) return "not_found" as const;
  if (status === 429) return "rate_limit" as const;
  if (status >= 500) return "unavailable" as const;
  return "bad_request" as const;
}

/** Pulls a short human message out of common provider error bodies without echoing secrets. */
function extractMessage(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    const m = typeof j.error === "string" ? j.error : (j.error?.message ?? j.message);
    if (m) return m.slice(0, 300);
  } catch {
    /* not JSON */
  }
  return body.slice(0, 200);
}

export async function providerRequest(
  conn: ConnectionConfig,
  url: string,
  init: { method?: "GET" | "POST"; headers?: Record<string, string>; body?: unknown; signal?: AbortSignal; idleTimeoutMs?: number },
): Promise<SafeResponse> {
  let res: SafeResponse;
  try {
    res = await safeRequest(
      url,
      {
        method: init.method ?? (init.body ? "POST" : "GET"),
        headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: init.signal,
        idleTimeoutMs: init.idleTimeoutMs ?? 90_000,
      },
      conn.policy,
    );
  } catch (err) {
    if (err instanceof OutboundBlockedError) throw err;
    if (init.signal?.aborted) throw new ProviderError("cancelled", "Request cancelled");
    const msg = err instanceof Error ? err.message : "Network error";
    throw new ProviderError(/timeout/i.test(msg) ? "timeout" : "network", `Could not reach provider: ${msg}`);
  }
  if (res.status >= 400) {
    const body = await res.text().catch(() => "");
    throw new ProviderError(kindForStatus(res.status), `Provider returned ${res.status}: ${extractMessage(body)}`, res.status);
  }
  return res;
}

export async function* sseFrames(res: SafeResponse, signal?: AbortSignal): AsyncIterable<SseFrame> {
  const parser = new SseParser();
  try {
    for await (const chunk of res.body) {
      if (signal?.aborted) throw new ProviderError("cancelled", "Request cancelled");
      for (const f of parser.push(chunk)) yield f;
    }
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if (signal?.aborted) throw new ProviderError("cancelled", "Request cancelled");
    throw new ProviderError("network", `Stream interrupted: ${err instanceof Error ? err.message : "unknown"}`);
  }
  for (const f of parser.end()) yield f;
}

/** Newline-delimited JSON, used by Ollama's native API. */
export async function* ndjson(res: SafeResponse, signal?: AbortSignal): AsyncIterable<unknown> {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body) {
    if (signal?.aborted) throw new ProviderError("cancelled", "Request cancelled");
    buf += decoder.decode(chunk, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) yield JSON.parse(line) as unknown;
    }
  }
  buf += decoder.decode();
  if (buf.trim()) yield JSON.parse(buf) as unknown;
}
