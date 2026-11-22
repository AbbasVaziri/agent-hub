import type { OutboundPolicy } from "@/lib/security/ssrf";

export type ProviderType = "openai" | "anthropic" | "openrouter" | "ollama" | "openai_compatible";

export type ProviderCapabilities = {
  streaming: boolean;
  toolCalling: boolean;
  vision: boolean;
  structuredOutput: boolean;
  reasoningSummary: boolean;
  /** Only set when the provider reports it; never guessed. */
  contextWindow?: number;
};

export type ModelInfo = { id: string; label?: string; contextWindow?: number };

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCallRequest[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type ToolSpec = {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
};

export type ToolCallRequest = { id: string; name: string; arguments: string };

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; call: ToolCallRequest }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "finish"; reason: "stop" | "tool_calls" | "length" | "other" };

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxOutputTokens?: number;
  signal: AbortSignal;
};

export type ConnectionConfig = {
  providerType: ProviderType;
  baseUrl: string | null;
  apiKey: string | null;
  policy: OutboundPolicy;
};

export interface ProviderAdapter {
  readonly type: ProviderType;
  readonly defaultBaseUrl: string | null;
  readonly requiresApiKey: boolean;
  readonly requiresBaseUrl: boolean;
  listModels(conn: ConnectionConfig, signal?: AbortSignal): Promise<ModelInfo[]>;
  testConnection(conn: ConnectionConfig, signal?: AbortSignal): Promise<{ ok: true; modelCount: number }>;
  capabilities(model: string): ProviderCapabilities;
  streamChat(conn: ConnectionConfig, req: ChatRequest): AsyncIterable<StreamEvent>;
}

export type ProviderErrorKind = "auth" | "rate_limit" | "not_found" | "bad_request" | "unavailable" | "network" | "timeout" | "cancelled" | "unknown";

export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
