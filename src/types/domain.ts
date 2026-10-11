import type {
  budgetType,
  integrationState,
  jobProcessingStatus,
  notificationStatus,
  qualificationDecision,
  runStage,
  runStatus,
  stageStatus,
  userRole,
} from "@/lib/database/schema";

export type UserRole = (typeof userRole.enumValues)[number];
export type RunStatus = (typeof runStatus.enumValues)[number];
export type RunStage = (typeof runStage.enumValues)[number];
export type StageStatus = (typeof stageStatus.enumValues)[number];
export type JobProcessingStatus = (typeof jobProcessingStatus.enumValues)[number];
export type BudgetType = (typeof budgetType.enumValues)[number];
export type QualificationDecision = (typeof qualificationDecision.enumValues)[number];
export type NotificationStatus = (typeof notificationStatus.enumValues)[number];
export type IntegrationState = (typeof integrationState.enumValues)[number];

export const RUN_STAGES: readonly RunStage[] = [
  "SOURCE_CHECK",
  "DISCOVERY",
  "HARD_FILTERS",
  "AI_EVALUATION",
  "SELECTION",
  "NOTIFICATION",
  "FINALIZATION",
];

export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = ["QUEUED", "RUNNING"];
