import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums. Values are mirrored as TypeScript unions in src/types/domain.ts.
// ---------------------------------------------------------------------------

export const userRole = pgEnum("user_role", ["ADMIN", "OPERATOR", "VIEWER"]);
export const userStatus = pgEnum("user_status", ["ACTIVE", "DISABLED"]);

export const runStatus = pgEnum("run_status", [
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "COMPLETED_WITH_ERRORS",
  "FAILED",
  "CANCELLED",
  "BLOCKED_SOURCE",
]);

export const runStage = pgEnum("run_stage", [
  "SOURCE_CHECK",
  "DISCOVERY",
  "HARD_FILTERS",
  "AI_EVALUATION",
  "SELECTION",
  "NOTIFICATION",
  "FINALIZATION",
]);

export const stageStatus = pgEnum("stage_status", ["PENDING", "RUNNING", "COMPLETED", "FAILED", "SKIPPED"]);

export const jobProcessingStatus = pgEnum("job_processing_status", [
  "NEW",
  "FILTERED_OUT",
  "PENDING_AI",
  "QUALIFIED",
  "REJECTED",
  "NEEDS_REVIEW",
  "AI_ERROR",
  "SOURCE_ERROR",
]);

export const budgetType = pgEnum("budget_type", ["FIXED", "HOURLY", "UNKNOWN"]);

export const qualificationDecision = pgEnum("qualification_decision", [
  "QUALIFIED",
  "REJECTED",
  "NEEDS_REVIEW",
  "AI_ERROR",
]);

export const notificationChannel = pgEnum("notification_channel", ["WHATSAPP", "EMAIL"]);

export const stagedJobStatus = pgEnum("staged_job_status", ["PENDING", "CONSUMED"]);

export const notificationStatus = pgEnum("notification_status", [
  "RESERVED",
  "SENDING",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED_RETRYABLE",
  "FAILED_PERMANENT",
  "UNCERTAIN",
  "CANCELLED",
]);

export const integrationState = pgEnum("integration_state", [
  "CONNECTED",
  "CONFIGURED",
  "NOT_CONFIGURED",
  "NOT_AUTHORIZED",
  "UNAVAILABLE",
  "MOCK",
]);

export const auditActorType = pgEnum("audit_actor_type", ["USER", "SYSTEM", "EXECUTOR", "WEBHOOK"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name"),
    passwordHash: text("password_hash").notNull(),
    role: userRole("role").notNull().default("OPERATOR"),
    status: userStatus("status").notNull().default("ACTIVE"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sessions_token_hash_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const notificationRecipients = pgTable(
  "notification_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    label: text("label").notNull(),
    channel: notificationChannel("channel").notNull().default("WHATSAPP"),
    /** E.164 phone number (WhatsApp recipients). Never copied into notifications or logs. */
    phoneE164: text("phone_e164"),
    /** E-mail address (EMAIL recipients). Never copied into notifications or logs. */
    email: text("email"),
    optInConfirmedAt: timestamp("opt_in_confirmed_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("recipients_owner_phone_uq").on(t.ownerUserId, t.channel, t.phoneE164),
    uniqueIndex("recipients_owner_email_uq").on(t.ownerUserId, t.channel, sql`lower(${t.email})`),
    // channel::text: a newly added enum value cannot be referenced in the migration that adds it.
    check(
      "recipients_address_chk",
      sql`(${t.channel}::text = 'WHATSAPP' and ${t.phoneE164} ~ '^\\+[1-9][0-9]{6,14}$' and ${t.email} is null)
        or (${t.channel}::text = 'EMAIL' and ${t.email} is not null and ${t.phoneE164} is null)`,
    ),
  ],
);

export const searchProfiles = pgTable(
  "search_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    /** Monotonic version counter; also the optimistic-locking token. */
    currentVersion: integer("current_version").notNull().default(1),
    configuration: jsonb("configuration").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    active: boolean("active").notNull().default(true),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("profiles_owner_idx").on(t.ownerUserId),
    uniqueIndex("profiles_one_default_per_owner_uq")
      .on(t.ownerUserId)
      .where(sql`${t.isDefault} = true`),
  ],
);

export const profileVersions = pgTable(
  "profile_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => searchProfiles.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    configuration: jsonb("configuration").notNull(),
    changeNote: text("change_note"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("profile_versions_profile_version_uq").on(t.profileId, t.versionNumber)],
);

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => searchProfiles.id, { onDelete: "restrict" }),
    profileVersionId: uuid("profile_version_id")
      .notNull()
      .references(() => profileVersions.id, { onDelete: "restrict" }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull(),
    status: runStatus("status").notNull().default("QUEUED"),
    executor: text("executor").notNull(),
    sourceProvider: text("source_provider").notNull(),
    /** Immutable copy of profile configuration + provider/prompt versions. */
    configurationSnapshot: jsonb("configuration_snapshot").notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
    externalExecutionId: text("external_execution_id"),
    sourceCount: integer("source_count").notNull().default(0),
    hardFilterPassCount: integer("hard_filter_pass_count").notNull().default(0),
    aiEvaluatedCount: integer("ai_evaluated_count").notNull().default(0),
    qualifiedCount: integer("qualified_count").notNull().default(0),
    rejectedCount: integer("rejected_count").notNull().default(0),
    notifiedCount: integer("notified_count").notNull().default(0),
    failedNotificationCount: integer("failed_notification_count").notNull().default(0),
    warnings: jsonb("warnings")
      .notNull()
      .default(sql`'[]'::jsonb`),
    errorSummary: jsonb("error_summary"),
    summaryNotification: jsonb("summary_notification"),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("runs_requester_idempotency_uq").on(t.requestedBy, t.idempotencyKey),
    uniqueIndex("runs_one_active_per_profile_uq")
      .on(t.profileId)
      .where(sql`${t.status} in ('QUEUED', 'RUNNING')`),
    index("runs_profile_created_idx").on(t.profileId, t.createdAt),
    index("runs_status_idx").on(t.status),
    index("runs_created_idx").on(t.createdAt),
  ],
);

export const runStages = pgTable(
  "run_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    stage: runStage("stage").notNull(),
    status: stageStatus("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    metrics: jsonb("metrics")
      .notNull()
      .default(sql`'{}'::jsonb`),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("run_stages_run_stage_uq").on(t.runId, t.stage)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    sourceJobId: text("source_job_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    jobUrl: text("job_url"),
    budgetType: budgetType("budget_type").notNull().default("UNKNOWN"),
    /** Fixed budget or lower bound of a range (conservative eligibility value). */
    budgetAmount: numeric("budget_amount", { precision: 14, scale: 2 }),
    budgetMax: numeric("budget_max", { precision: 14, scale: 2 }),
    hourlyMin: numeric("hourly_min", { precision: 14, scale: 2 }),
    hourlyMax: numeric("hourly_max", { precision: 14, scale: 2 }),
    currency: text("currency"),
    /** null = unknown. Never inferred from other client signals. */
    paymentVerified: boolean("payment_verified"),
    clientRating: numeric("client_rating", { precision: 3, scale: 2 }),
    clientHires: integer("client_hires"),
    clientTotalSpent: numeric("client_total_spent", { precision: 14, scale: 2 }),
    clientCountry: text("client_country"),
    skills: jsonb("skills")
      .notNull()
      .default(sql`'[]'::jsonb`),
    category: text("category"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    sourceMetadata: jsonb("source_metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    contentHash: text("content_hash").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("jobs_source_source_job_id_uq").on(t.source, t.sourceJobId),
    index("jobs_first_seen_idx").on(t.firstSeenAt),
  ],
);

export const runJobs = pgTable(
  "run_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "restrict" }),
    processingStatus: jobProcessingStatus("processing_status").notNull().default("NEW"),
    hardCheckResults: jsonb("hard_check_results")
      .notNull()
      .default(sql`'[]'::jsonb`),
    rejectionReasons: jsonb("rejection_reasons")
      .notNull()
      .default(sql`'[]'::jsonb`),
    previouslySeen: boolean("previously_seen").notNull().default(false),
    passedHardFilters: boolean("passed_hard_filters").notNull().default(false),
    aiAttempts: integer("ai_attempts").notNull().default(0),
    rank: integer("rank"),
    /** Why a qualified job was or was not notified in this run (limit reached, claimed elsewhere, disabled...). */
    notificationNote: text("notification_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("run_jobs_run_job_uq").on(t.runId, t.jobId),
    index("run_jobs_run_status_idx").on(t.runId, t.processingStatus),
    index("run_jobs_job_idx").on(t.jobId),
  ],
);

export const qualifications = pgTable(
  "qualifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "restrict" }),
    /** Authoritative score computed by the backend; null when the AI output was invalid. */
    score: integer("score"),
    modelReportedScore: integer("model_reported_score"),
    dimensionScores: jsonb("dimension_scores"),
    decision: qualificationDecision("decision").notNull(),
    decisionReasons: jsonb("decision_reasons")
      .notNull()
      .default(sql`'[]'::jsonb`),
    promptVersion: text("prompt_version").notNull(),
    rubricVersion: text("rubric_version").notNull(),
    modelIdentifier: text("model_identifier").notNull(),
    inputHash: text("input_hash").notNull(),
    evidence: jsonb("evidence")
      .notNull()
      .default(sql`'{}'::jsonb`),
    riskFlags: jsonb("risk_flags")
      .notNull()
      .default(sql`'[]'::jsonb`),
    missingInformation: jsonb("missing_information")
      .notNull()
      .default(sql`'[]'::jsonb`),
    attempts: integer("attempts").notNull().default(1),
    error: text("error"),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("qualifications_run_job_uq").on(t.runId, t.jobId),
    index("qualifications_job_idx").on(t.jobId),
    check("qualifications_score_range_chk", sql`${t.score} is null or (${t.score} between 0 and 100)`),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "restrict" }),
    /** Run that currently owns the claim. Earlier claims are preserved in notification_attempts. */
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "restrict" }),
    /** recipient_ref: opaque recipient id; the phone number stays in notification_recipients. */
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => notificationRecipients.id, { onDelete: "restrict" }),
    channel: notificationChannel("channel").notNull().default("WHATSAPP"),
    status: notificationStatus("status").notNull().default("RESERVED"),
    providerMessageId: text("provider_message_id"),
    attempts: integer("attempts").notNull().default(0),
    idempotencyKey: text("idempotency_key").notNull(),
    messagePreview: text("message_preview").notNull(),
    payload: jsonb("payload").notNull(),
    reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull().defaultNow(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One claim per job/channel/recipient, ever. Re-claims only update terminal-failure rows.
    uniqueIndex("notifications_job_channel_recipient_uq").on(t.jobId, t.channel, t.recipientId),
    uniqueIndex("notifications_idempotency_key_uq").on(t.idempotencyKey),
    uniqueIndex("notifications_provider_message_id_uq")
      .on(t.providerMessageId)
      .where(sql`${t.providerMessageId} is not null`),
    index("notifications_run_status_idx").on(t.runId, t.status),
    index("notifications_status_idx").on(t.status),
  ],
);

export const notificationAttempts = pgTable(
  "notification_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "restrict" }),
    attemptNumber: integer("attempt_number").notNull(),
    outcome: notificationStatus("outcome").notNull(),
    httpStatus: integer("http_status"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    manual: boolean("manual").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("notification_attempts_notification_idx").on(t.notificationId)],
);

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    actorType: auditActorType("actor_type").notNull().default("USER"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    requestId: text("request_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_created_idx").on(t.createdAt),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_user_idx").on(t.userId),
  ],
);

export const integrationStatus = pgTable("integration_status", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull().unique(),
  status: integrationState("status").notNull(),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  sanitizedError: text("sanitized_error"),
  /** Non-secret metadata only (mode, capabilities, versions). */
  metadata: jsonb("metadata")
    .notNull()
    .default(sql`'{}'::jsonb`),
  updatedAt: updatedAt(),
});

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

// ---------------------------------------------------------------------------
// Job import (external agents such as the Claude + Upwork MCP bridge)
// ---------------------------------------------------------------------------

/** Long-lived per-user tokens for machine imports. Only an HMAC of the token is stored. */
export const importTokens = pgTable(
  "import_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("import_tokens_hash_uq").on(t.tokenHash), index("import_tokens_user_idx").on(t.userId)],
);

/** One accepted import request (a "commit" from the agent). */
export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => searchProfiles.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    origin: text("origin").notNull(),
    received: integer("received").notNull(),
    accepted: integer("accepted").notNull(),
    invalid: integer("invalid").notNull(),
    /** Run started for this batch; null when the jobs were queued behind an active run. */
    runId: uuid("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("import_batches_profile_created_idx").on(t.profileId, t.createdAt)],
);

/** Imported jobs waiting for (PENDING) or taken by (CONSUMED) a run's discovery stage. */
export const stagedJobs = pgTable(
  "staged_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => searchProfiles.id, { onDelete: "restrict" }),
    source: text("source").notNull(),
    sourceJobId: text("source_job_id").notNull(),
    /** A NormalizedJob, already validated by the import endpoint. */
    payload: jsonb("payload").notNull(),
    status: stagedJobStatus("status").notNull().default("PENDING"),
    consumedRunId: uuid("consumed_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // A job waits at most once per profile; a re-import while pending refreshes its payload.
    uniqueIndex("staged_jobs_pending_uq")
      .on(t.profileId, t.source, t.sourceJobId)
      .where(sql`${t.status} = 'PENDING'`),
    index("staged_jobs_profile_status_idx").on(t.profileId, t.status),
  ],
);

/** When each profile was last synced by the import agent, for the "due" schedule. */
export const syncState = pgTable("sync_state", {
  profileId: uuid("profile_id")
    .primaryKey()
    .references(() => searchProfiles.id, { onDelete: "cascade" }),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastStatus: text("last_status"),
  lastError: text("last_error"),
  updatedAt: updatedAt(),
});
