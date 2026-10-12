import { asc } from "drizzle-orm";
import { requireRole, type Actor } from "@/lib/auth/authorization";
import type { Database } from "@/lib/database/client";
import { users } from "@/lib/database/schema";

/** All users (no password hashes). ADMIN only: used to filter the audit log by person. */
export async function listUsers(db: Database, actor: Actor) {
  requireRole(actor, "ADMIN");
  return db
    .select({ id: users.id, email: users.email, name: users.name, role: users.role, status: users.status })
    .from(users)
    .orderBy(asc(users.email));
}
