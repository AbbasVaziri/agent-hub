import { AgentBuilder } from "@/components/agents/agent-builder";

export const metadata = { title: "New agent" };

export default function Page() {
  return <AgentBuilder agentId={null} />;
}
