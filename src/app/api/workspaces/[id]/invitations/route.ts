import { route, parseBody } from "@/lib/api/handler";
import { contextFor } from "@/lib/api/workspace-scope";
import { inviteSchema } from "@/lib/contracts";
import { createInvitation, getWorkspace, listInvitations } from "@/lib/workspaces/service";
import { sendMail } from "@/lib/mail";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/security/rate-limit";

export const GET = route<{ id: string }>(async (_req, base, { id }) => {
  const ctx = await contextFor(base, id);
  return { items: await listInvitations(ctx) };
});

export const POST = route<{ id: string }>(async (req, base, { id }) => {
  const ctx = await contextFor(base, id);
  const input = await parseBody(req, inviteSchema);
  await rateLimit(`invite:${ctx.workspaceId}`, 30, 3600);
  const { invitation, token } = await createInvitation(ctx, input.email, input.role);
  const ws = await getWorkspace(ctx);
  const link = `${env().APP_URL}/invite/${token}`;
  await sendMail({
    to: input.email,
    subject: `دعوت به ${ws.name} / Invitation to ${ws.name}`,
    text: `شما به فضای کار «${ws.name}» دعوت شده‌اید. برای پیوستن این پیوند را باز کنید:\n${link}\n\nYou were invited to the workspace "${ws.name}". Open this link to join:\n${link}`,
  });
  return Response.json({ id: invitation.id, email: invitation.email, role: invitation.role }, { status: 201 });
});
