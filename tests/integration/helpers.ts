import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { hashPassword } from "@/lib/auth/password";
import { createSession, SESSION_COOKIE } from "@/lib/auth/session";
import { getDb } from "@/lib/database/client";
import { users } from "@/lib/database/schema";
import type { UserRole } from "@/types/domain";

export const BASE_URL = "http://localhost:3000";
export const TEST_PASSWORD = "correct-horse-battery-staple";

type RouteHandler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

export interface TestUser {
  id: string;
  email: string;
  role: UserRole;
  cookie: string;
}

/** Inserts a user and opens a session for it. */
export async function createUser(role: UserRole = "OPERATOR", status: "ACTIVE" | "DISABLED" = "ACTIVE") {
  const email = `${role.toLowerCase()}-${randomUUID().slice(0, 8)}@test.local`;
  const [row] = await getDb()
    .insert(users)
    .values({ email, passwordHash: await hashPassword(TEST_PASSWORD), role, status })
    .returning({ id: users.id });
  const session = await createSession(getDb(), row!.id, {});
  return { id: row!.id, email, role, cookie: `${SESSION_COOKIE}=${session.token}` } satisfies TestUser;
}

export interface CallOptions {
  method?: string;
  path?: string;
  params?: Record<string, string>;
  body?: unknown;
  user?: TestUser | null;
  headers?: Record<string, string>;
  /** Defaults to the app origin for state-changing methods; pass null to omit it. */
  origin?: string | null;
}

/** Invokes a route handler directly, as Next.js would, and returns the parsed response. */
export async function call(handler: RouteHandler, options: CallOptions = {}) {
  const method = options.method ?? "GET";
  const headers = new Headers(options.headers);
  const origin = options.origin === undefined ? (method === "GET" ? null : BASE_URL) : options.origin;
  if (origin) headers.set("origin", origin);
  if (options.user) headers.set("cookie", options.user.cookie);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  const req = new NextRequest(new URL(options.path ?? "/api/test", BASE_URL), {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const res = await handler(req, { params: Promise.resolve(options.params ?? {}) });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: callers assert on the shape
  const json: any = text ? JSON.parse(text) : null;
  return { status: res.status, json, headers: res.headers };
}
