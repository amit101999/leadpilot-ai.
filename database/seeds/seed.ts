import "dotenv/config";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Actor } from "@/lib/auth/authorization";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { closeDb, getDb, type Database } from "@/lib/database/client";
import { notificationRecipients, searchProfiles, users } from "@/lib/database/schema";
import { createRecipient, createRecipientSchema } from "@/modules/notifications/recipients";
import { defaultProfileConfig } from "@/modules/profiles/config-schema";
import { createProfile, setDefault } from "@/modules/profiles/service";

/**
 * Idempotent bootstrap: creates the first admin, an optional WhatsApp
 * recipient and the initial "Web & Zoho Development" profile. Re-running only
 * fills in what is missing; it never resets a password or overwrites a
 * profile that was edited in the UI.
 */

const INITIAL_PROFILE_NAME = "Web & Zoho Development";

const seedEnvSchema = z.object({
  SEED_ADMIN_EMAIL: z.email("must be a valid e-mail address"),
  SEED_ADMIN_PASSWORD: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `must be at least ${MIN_PASSWORD_LENGTH} characters`),
  WHATSAPP_DEFAULT_RECIPIENT: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined)),
});

async function ensureAdmin(db: Database, email: string, password: string): Promise<Actor> {
  const normalized = email.trim().toLowerCase();
  const [existing] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(sql`lower(${users.email}) = ${normalized}`)
    .limit(1);
  if (existing) {
    console.warn(`Admin user already exists (role ${existing.role}); password left unchanged.`);
    return { id: existing.id, role: existing.role };
  }
  const [created] = await db
    .insert(users)
    .values({
      email: normalized,
      name: "Administrator",
      passwordHash: await hashPassword(password),
      role: "ADMIN",
    })
    .returning({ id: users.id, role: users.role });
  if (!created) throw new Error("Admin insert returned no row");
  console.warn("Admin user created.");
  return { id: created.id, role: created.role };
}

/** Opt-in is never assumed: the operator confirms it in Settings before WhatsApp can be enabled. */
async function ensureRecipient(db: Database, admin: Actor, phone: string): Promise<void> {
  const input = createRecipientSchema.parse({
    label: "Default recipient",
    phoneE164: phone,
    optInConfirmed: false,
  });
  const [existing] = await db
    .select({ id: notificationRecipients.id })
    .from(notificationRecipients)
    .where(
      and(
        eq(notificationRecipients.ownerUserId, admin.id),
        eq(notificationRecipients.channel, "WHATSAPP"),
        eq(notificationRecipients.phoneE164, input.phoneE164),
      ),
    )
    .limit(1);
  if (existing) {
    console.warn("Default WhatsApp recipient already exists.");
    return;
  }
  await createRecipient(db, admin, input, "seed");
  console.warn("Default WhatsApp recipient created (opt-in NOT confirmed; confirm it in Settings).");
}

async function ensureInitialProfile(db: Database, admin: Actor): Promise<void> {
  const [existing] = await db
    .select({ id: searchProfiles.id })
    .from(searchProfiles)
    .where(and(eq(searchProfiles.ownerUserId, admin.id), eq(searchProfiles.name, INITIAL_PROFILE_NAME)))
    .limit(1);
  if (existing) {
    console.warn(`Profile "${INITIAL_PROFILE_NAME}" already exists; left unchanged.`);
    return;
  }
  const profile = await createProfile(
    db,
    admin,
    {
      name: INITIAL_PROFILE_NAME,
      description:
        "Fixed-price React, Node.js, JavaScript, Zoho and API-integration work from verified clients.",
      configuration: defaultProfileConfig(null),
      changeNote: "Initial seed",
    },
    "seed",
  );
  const [currentDefault] = await db
    .select({ id: searchProfiles.id })
    .from(searchProfiles)
    .where(and(eq(searchProfiles.ownerUserId, admin.id), eq(searchProfiles.isDefault, true)))
    .limit(1);
  if (!currentDefault) await setDefault(db, admin, profile.id, "seed");
  console.warn(`Profile "${INITIAL_PROFILE_NAME}" created (version 1).`);
}

async function main(): Promise<void> {
  const parsed = seedEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Only variable names and rule messages are printed, never values.
    throw new Error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const config = parsed.data;
  const db = getDb();
  try {
    const admin = await ensureAdmin(db, config.SEED_ADMIN_EMAIL, config.SEED_ADMIN_PASSWORD);
    if (config.WHATSAPP_DEFAULT_RECIPIENT)
      await ensureRecipient(db, admin, config.WHATSAPP_DEFAULT_RECIPIENT);
    await ensureInitialProfile(db, admin);
    console.warn("Seed complete.");
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error("Seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
