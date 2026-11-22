import { db, schema } from "./db/client";
import type { Tx } from "./db/client";
import { redact } from "./logger";

export type AuditEntry = {
  workspaceId: string | null;
  actorUserId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
};

export async function audit(entry: AuditEntry, tx?: Tx): Promise<void> {
  await (tx ?? db()).insert(schema.auditLogs).values({
    ...entry,
    metadata: (redact(entry.metadata ?? {}) as Record<string, unknown>) ?? {},
  });
}
