"use client";

import { createContext, useContext } from "react";
import type { Role } from "@/lib/workspaces/permissions";

export type SessionInfo = {
  me: { id: string; name: string; email: string };
  workspaceId: string;
  role: Role;
  workspaces: Array<{ id: string; name: string; role: Role; isPersonal: boolean }>;
};

const Ctx = createContext<SessionInfo | null>(null);
export const SessionProvider = Ctx.Provider;

export function useSession(): SessionInfo {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside Shell");
  return v;
}
