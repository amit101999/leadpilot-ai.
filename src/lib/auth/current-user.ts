import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Actor } from "@/lib/auth/authorization";
import { resolveSession, SESSION_COOKIE, type SessionUser } from "@/lib/auth/session";
import { getDb } from "@/lib/database/client";

/**
 * Server components: the signed-in user, or a redirect to /login. The proxy
 * only checks that a cookie exists; this validates the session itself.
 */
export async function requireUser(): Promise<{ user: SessionUser; actor: Actor }> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = await resolveSession(getDb(), token);
  if (!user) redirect("/login");
  return { user, actor: { id: user.id, role: user.role } };
}

/** For the login page: the current user if the session is valid, otherwise null. */
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? resolveSession(getDb(), token) : null;
}
