import { forbidden } from "@/lib/http/errors";
import type { UserRole } from "@/types/domain";

export interface Actor {
  id: string;
  role: UserRole;
}

const RANK: Record<UserRole, number> = { VIEWER: 1, OPERATOR: 2, ADMIN: 3 };

export function hasRole(actor: Actor, minimum: UserRole): boolean {
  return RANK[actor.role] >= RANK[minimum];
}

export function requireRole(actor: Actor, minimum: UserRole): void {
  if (!hasRole(actor, minimum)) throw forbidden();
}

/**
 * Ownership scope for queries. Admins see everything; everyone else sees only
 * resources owned by (or reachable from profiles owned by) themselves.
 * Repositories apply this inside the WHERE clause, so foreign IDs return 404
 * rather than leaking existence through 403.
 */
export function ownerFilter(actor: Actor): string | null {
  return actor.role === "ADMIN" ? null : actor.id;
}
