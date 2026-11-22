import { auth } from "@/lib/auth/auth";
import { rateLimit } from "@/lib/security/rate-limit";
import { errorResponse } from "@/lib/api/handler";

export async function GET(req: Request) {
  return auth().handler(req);
}

// Sign-in, sign-up and reset endpoints get a per-IP limit on top of better-auth's own.
export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    await rateLimit(`auth:${ip}`, 30, 60);
  } catch (err) {
    return errorResponse(err);
  }
  return auth().handler(req);
}
