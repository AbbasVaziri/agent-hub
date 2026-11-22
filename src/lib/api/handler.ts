import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { ZodError, type ZodType } from "zod";
import { auth } from "../auth/auth";
import { resolveWorkspaceContext, type WorkspaceContext } from "../workspaces/service";
import { AppError, type ApiErrorBody } from "./errors";
import { OutboundBlockedError } from "../security/ssrf";
import { log } from "../logger";
import { env } from "../env";

export type AuthedContext = WorkspaceContext & { email: string; name: string };

export async function currentUser() {
  const session = await auth().api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

export async function requireContext(): Promise<AuthedContext> {
  const user = await currentUser();
  if (!user) throw new AppError("UNAUTHENTICATED", "Sign in to continue");
  const ctx = await resolveWorkspaceContext(user.id);
  return { ...ctx, email: user.email, name: user.name };
}

export function errorResponse(err: unknown): NextResponse<ApiErrorBody> {
  if (err instanceof AppError) {
    return NextResponse.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR" as const, message: "Invalid input", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } },
      { status: 422 },
    );
  }
  if (err instanceof OutboundBlockedError) {
    return NextResponse.json({ error: { code: "OUTBOUND_BLOCKED" as const, message: err.message } }, { status: 422 });
  }
  log.error("Unhandled API error", { err });
  return NextResponse.json({ error: { code: "INTERNAL_ERROR" as const, message: "Something went wrong on our side" } }, { status: 500 });
}

type RouteCtx<P> = { params: Promise<P> };

/** Same-origin check for state-changing requests, on top of SameSite=Lax cookies. */
function assertSameOrigin(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients; cookies are still required
  const allowed = new URL(env().APP_URL).origin;
  if (origin !== allowed && origin !== req.nextUrl.origin) throw new AppError("FORBIDDEN", "Cross-origin request rejected");
}

export function route<P = Record<string, never>>(fn: (req: NextRequest, ctx: AuthedContext, params: P) => Promise<Response | unknown>) {
  return async (req: NextRequest, routeCtx: RouteCtx<P>) => {
    try {
      assertSameOrigin(req);
      const ctx = await requireContext();
      const params = routeCtx?.params ? await routeCtx.params : ({} as P);
      const out = await fn(req, ctx, params);
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "Request body must be JSON");
  }
  return schema.parse(raw);
}

export function parseQuery<T>(req: NextRequest, schema: ZodType<T>): T {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams));
}
