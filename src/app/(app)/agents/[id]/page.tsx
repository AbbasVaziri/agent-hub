import { AgentBuilder } from "@/components/agents/agent-builder";

export const metadata = { title: "Agent" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AgentBuilder key={id} agentId={id} />;
}
