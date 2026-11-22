import { InviteAccept } from "@/components/auth/invite-accept";
import { currentUser } from "@/lib/api/handler";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await currentUser();
  return <InviteAccept token={token} signedIn={!!user} />;
}
