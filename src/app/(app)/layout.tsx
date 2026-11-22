import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { currentUser } from "@/lib/api/handler";
import { db, schema } from "@/lib/db/client";
import { listMemberships, resolveWorkspaceContext } from "@/lib/workspaces/service";
import { Shell } from "@/components/shell/shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const ctx = await resolveWorkspaceContext(user.id);
  const [workspaces, [row]] = await Promise.all([
    listMemberships(user.id),
    db().select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, user.id)),
  ]);
  return (
    <Shell me={{ id: user.id, name: row?.name ?? user.name, email: row?.email ?? user.email }} workspaceId={ctx.workspaceId} role={ctx.role} workspaces={workspaces}>
      {children}
    </Shell>
  );
}
