import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type z } from "zod";
import { requireRole, type Actor } from "@/lib/auth/authorization";
import { resolveImportToken } from "@/lib/auth/import-token";
import { resolveSession, SESSION_COOKIE, type SessionUser } from "@/lib/auth/session";
import { env } from "@/lib/configuration/env";
import { getDb, type Database } from "@/lib/database/client";
import { childLogger } from "@/lib/logging/logger";
import { SIGNATURE_HEADER, verifySignature } from "@/lib/security/hmac";
import { isAllowedRequestOrigin } from "@/lib/security/origin";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { InvalidTransitionError } from "@/lib/state-machine";
import type { UserRole } from "@/types/domain";
import { AppError, isUniqueViolation } from "./errors";

const MAX_BODY_BYTES = 256 * 1024;
const REQUEST_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

type Params = Record<string, string>;

interface BaseContext {
  req: NextRequest;
  params: Params;
  requestId: string;
  db: Database;
}
export interface UserContext extends BaseContext {
  actor: Actor;
  user: SessionUser;
}
export interface InternalContext extends BaseContext {
  rawBody: string;
}

type RouteContext = { params: Promise<Params> };
type Handler<C> = (ctx: C) => Promise<Response | unknown>;

/**
 * Authenticated (session cookie) route. Roles: VIEWER < OPERATOR < ADMIN.
 * State-changing methods must come from the app's own origin (CSRF defence).
 */
export function userRoute(minRole: UserRole, handler: Handler<UserContext>) {
  return wrap(async (req, params, requestId, db) => {
    assertSameOrigin(req);
    const user = await resolveSession(db, req.cookies.get(SESSION_COOKIE)?.value);
    if (!user) throw new AppError("UNAUTHENTICATED", "Please sign in");
    const actor: Actor = { id: user.id, role: user.role };
    requireRole(actor, minRole);
    return handler({ req, params, requestId, db, actor, user });
  });
}

/** CSRF defence for cookie-based routes, including public ones such as login and logout. */
export function assertSameOrigin(req: NextRequest): void {
  if (!isAllowedRequestOrigin(req.method, req.headers.get("origin"), env().APP_BASE_URL)) {
    throw new AppError("CSRF_REJECTED", "Request origin not allowed");
  }
}

/**
 * Route for external agents (the Upwork sync) authenticated with a per-user import token
 * (`Authorization: Bearer lpi_...`). No cookie, so no CSRF exposure; rate limited per token.
 * The handler acts as the token's user, so ownership and role checks apply unchanged.
 */
export function tokenRoute(minRole: UserRole, handler: Handler<UserContext & { tokenId: string }>) {
  return wrap(async (req, params, requestId, db) => {
    const header = req.headers.get("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
    const resolved = await resolveImportToken(db, token);
    if (!resolved) throw new AppError("UNAUTHENTICATED", "Missing, invalid or revoked import token");
    await enforceRateLimit(db, RATE_LIMITS.importApi, `token:${resolved.tokenId}`);
    const actor: Actor = { id: resolved.userId, role: resolved.role };
    requireRole(actor, minRole);
    const user = { id: resolved.userId, email: "", name: null, role: resolved.role, sessionId: "" };
    return handler({ req, params, requestId, db, actor, user, tokenId: resolved.tokenId });
  });
}

/** Server-to-server route signed with INTERNAL_API_SECRET (used by n8n). */
export function internalRoute(handler: Handler<InternalContext>) {
  return wrap(async (req, params, requestId, db) => {
    const secret = env().INTERNAL_API_SECRET;
    if (!secret) throw new AppError("INTEGRATION_NOT_CONFIGURED", "Internal API is not configured");
    const rawBody = await readBody(req);
    const check = verifySignature(secret, rawBody, req.headers.get(SIGNATURE_HEADER));
    if (!check.ok) throw new AppError("INVALID_SIGNATURE", "Invalid request signature");
    return handler({ req, params, requestId, db, rawBody });
  });
}

/** Unauthenticated route (login, health, provider webhooks that verify their own signatures). */
export function publicRoute(handler: Handler<BaseContext>) {
  return wrap((req, params, requestId, db) => handler({ req, params, requestId, db }));
}

function wrap(run: (req: NextRequest, params: Params, requestId: string, db: Database) => Promise<unknown>) {
  return async (req: NextRequest, context: RouteContext): Promise<Response> => {
    const incoming = req.headers.get("x-request-id");
    const requestId = incoming && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
    try {
      const params = (await context?.params) ?? {};
      const result = await run(req, params, requestId, getDb());
      const response = result instanceof Response ? result : NextResponse.json({ data: result ?? null });
      response.headers.set("x-request-id", requestId);
      return response;
    } catch (error) {
      return errorResponse(error, requestId, req);
    }
  };
}

export function errorResponse(error: unknown, requestId: string, req?: NextRequest): Response {
  const log = childLogger({ request_id: requestId });
  let appError: AppError;
  if (error instanceof AppError) {
    appError = error;
  } else if (error instanceof ZodError) {
    appError = new AppError("VALIDATION_ERROR", "Request validation failed", formatZodIssues(error));
  } else if (error instanceof InvalidTransitionError) {
    appError = new AppError(
      "INVALID_STATE",
      `This ${error.entity} cannot move from ${error.from} to ${error.to}`,
    );
  } else if (isUniqueViolation(error)) {
    appError = new AppError("CONFLICT", "The resource was modified concurrently or already exists");
  } else {
    log.error({ err: error, path: req?.nextUrl.pathname }, "Unhandled API error");
    appError = new AppError("INTERNAL_ERROR", "An unexpected error occurred");
  }
  if (appError.status >= 500 && appError.code !== "INTERNAL_ERROR") {
    log.warn({ error_code: appError.code, path: req?.nextUrl.pathname }, appError.message);
  }
  const headers: Record<string, string> = { "x-request-id": requestId };
  const retryAfter = (appError.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
  if (appError.code === "RATE_LIMITED" && retryAfter) headers["retry-after"] = String(retryAfter);
  return NextResponse.json(
    { error: { code: appError.code, message: appError.message, requestId, details: appError.details } },
    { status: appError.status, headers },
  );
}

// ---------------------------------------------------------------------------
// Input helpers
// ---------------------------------------------------------------------------

export async function readBody(req: NextRequest): Promise<string> {
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) throw new AppError("VALIDATION_ERROR", "Request body too large");
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new AppError("VALIDATION_ERROR", "Request body too large");
  return text;
}

export async function parseJson<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.output<S>> {
  return parseJsonText(await readBody(req), schema);
}

export function parseJsonText<S extends z.ZodType>(text: string, schema: S): z.output<S> {
  let value: unknown = {};
  if (text.trim().length > 0) {
    try {
      value = JSON.parse(text);
    } catch {
      throw new AppError("VALIDATION_ERROR", "Body must be valid JSON");
    }
  }
  return schema.parse(value);
}

export function parseQuery<S extends z.ZodType>(req: NextRequest, schema: S): z.output<S> {
  const raw: Record<string, string | string[]> = {};
  for (const [key, value] of req.nextUrl.searchParams.entries()) {
    const existing = raw[key];
    raw[key] =
      existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return schema.parse(raw);
}

export function clientIp(req: NextRequest): string {
  // X-Forwarded-For is trusted only because production runs behind our own reverse proxy (Caddy).
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown"
  );
}

export function paginated<T>(items: T[], meta: { page: number; pageSize: number; total: number }) {
  return NextResponse.json({
    data: items,
    meta: { ...meta, totalPages: Math.max(1, Math.ceil(meta.total / meta.pageSize)) },
  });
}

function formatZodIssues(error: ZodError) {
  return error.issues.slice(0, 20).map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}
