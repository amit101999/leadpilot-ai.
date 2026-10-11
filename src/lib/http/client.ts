/**
 * Browser-side calls to the app's own /api routes. Same-origin requests carry
 * the session cookie and the Origin header the CSRF check expects.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Field errors from a 400 VALIDATION_ERROR, keyed by dotted path. */
  fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const item of this.details as Array<{ path?: string; message?: string }>) {
      if (item.path && item.message && !out[item.path]) out[item.path] = item.message;
    }
    return out;
  }
}

export async function apiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      headers: {
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(
      "NETWORK_ERROR",
      "Could not reach the server. Check your connection and try again.",
      0,
    );
  }
  const payload = (await response.json().catch(() => null)) as {
    data?: T;
    error?: { code: string; message: string; details?: unknown };
  } | null;
  if (!response.ok) {
    const error = payload?.error;
    throw new ApiError(
      error?.code ?? "HTTP_ERROR",
      error?.message ?? `Request failed (HTTP ${response.status})`,
      response.status,
      error?.details,
    );
  }
  return payload?.data as T;
}

/** A fresh key per user intent (one click of "Run agent"), not per network attempt. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
