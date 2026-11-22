/** Typed SSE events for /api/chat/stream and /api/runs/:id/events. Shared with the client. */
import { z } from "zod";

export const runEventSchemas = {
  run: z.object({ runId: z.string(), conversationId: z.string(), messageId: z.string(), agentId: z.string().nullable(), userMessageId: z.string() }),
  chunk: z.object({ text: z.string(), messageId: z.string() }),
  reasoning: z.object({ text: z.string() }),
  tool_call: z.object({ toolCallId: z.string(), name: z.string(), status: z.enum(["started", "waiting_for_approval"]), agentId: z.string().nullable() }),
  tool_result: z.object({ toolCallId: z.string(), name: z.string(), status: z.enum(["completed", "failed", "rejected"]), durationMs: z.number().optional() }),
  delegation: z.object({ delegationId: z.string(), agentId: z.string(), status: z.enum(["running", "completed", "failed", "cancelled"]) }),
  handoff: z.object({ fromAgentId: z.string().nullable(), toAgentId: z.string(), summary: z.string(), messageId: z.string() }),
  approval_required: z.object({ approvalId: z.string(), toolCallId: z.string(), toolName: z.string(), agentId: z.string().nullable(), expiresAt: z.string() }),
  approval_resolved: z.object({ approvalId: z.string(), status: z.enum(["approved", "rejected", "expired"]) }),
  error: z.object({ code: z.string(), message: z.string(), messageId: z.string().optional() }),
  done: z.object({ messageId: z.string(), runId: z.string(), status: z.enum(["completed", "cancelled", "failed"]) }),
} as const;

export type RunEventType = keyof typeof runEventSchemas;
export type RunEventData<T extends RunEventType> = z.infer<(typeof runEventSchemas)[T]>;
export type RunEvent = { [K in RunEventType]: { type: K; data: RunEventData<K>; seq: number } }[RunEventType];

export const TERMINAL_EVENTS: ReadonlySet<RunEventType> = new Set(["done"]);

/** Error messages shown to users, in both languages. Codes stay stable for the client. */
export const USER_ERROR_TEXT: Record<string, { fa: string; en: string }> = {
  PROVIDER_ERROR: { fa: "ارتباط با سرویس‌دهنده برقرار نشد.", en: "Could not reach the model provider." },
  PROVIDER_AUTH_ERROR: { fa: "سرویس‌دهنده کلید API را نپذیرفت.", en: "The provider rejected the API key." },
  PROVIDER_RATE_LIMITED: { fa: "سرویس‌دهنده درخواست‌ها را محدود کرده است. کمی بعد دوباره امتحان کنید.", en: "The provider is rate limiting. Try again shortly." },
  PROVIDER_NOT_CONFIGURED: { fa: "برای این عامل مدل یا اتصالی انتخاب نشده است.", en: "This agent has no provider connection or model." },
  LIMIT_EXCEEDED: { fa: "اجرا به سقف تعیین‌شده رسید و متوقف شد.", en: "The run reached an execution limit and stopped." },
  BUDGET_EXCEEDED: { fa: "بودجه‌ی ماهانه‌ی این فضای کار تمام شده است.", en: "This workspace's monthly budget is used up." },
  AGENT_UNAVAILABLE: { fa: "عامل این گفتگو در دسترس نیست.", en: "The agent for this conversation is unavailable." },
  INTERNAL_ERROR: { fa: "مشکلی در سرور پیش آمد.", en: "Something went wrong on the server." },
};
