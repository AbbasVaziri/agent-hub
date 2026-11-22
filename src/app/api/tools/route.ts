import { route } from "@/lib/api/handler";
import { listTools } from "@/lib/ai/orchestration/tool-registry";

export const GET = route(async () => ({ items: listTools() }));
