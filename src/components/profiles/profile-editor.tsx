"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Controller, useForm, useWatch, type FieldErrors } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox, Textarea } from "@/components/ui/checkbox";
import { ChipInput } from "@/components/ui/chip-input";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Tabs } from "@/components/ui/tabs";
import { ApiError, apiFetch } from "@/lib/http/client";
import { profileConfigSchema, type ProfileConfig } from "@/modules/profiles/config-schema";
import { CombinationEditor, RatesEditor, SkillListEditor } from "./list-editors";

const editorSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
  description: z.string().trim().max(1000),
  changeNote: z.string().trim().max(500),
  configuration: profileConfigSchema,
});
type EditorInput = z.input<typeof editorSchema>;
type EditorOutput = z.output<typeof editorSchema>;

export interface RecipientOption {
  id: string;
  label: string;
  /** Masked e-mail address. */
  address: string;
}

const nullableNumber = (v: unknown) => (v === "" || v === null || v === undefined ? null : Number(v));
const nullableText = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/**
 * Search profile editor. Validates with the same schema as the server; one
 * save creates one immutable version. `profile` is absent when creating.
 */
export function ProfileEditor({
  profile,
  initialConfiguration,
  recipients,
  readOnly,
  readOnlyReason,
}: {
  profile?: {
    id: string;
    name: string;
    description: string | null;
    currentVersion: number;
    configuration: ProfileConfig;
  };
  /** Starting configuration when creating a profile. */
  initialConfiguration?: ProfileConfig;
  recipients: RecipientOption[];
  readOnly: boolean;
  readOnlyReason?: string;
}) {
  const router = useRouter();
  const ids = useId();
  const [tab, setTab] = useState("general");
  const [conflict, setConflict] = useState<number | null>(null);
  /** Set when the user chose to discard changes, so the unsaved-changes guard does not ask again. */
  const leavingRef = useRef(false);
  const form = useForm<EditorInput, unknown, EditorOutput>({
    resolver: zodResolver(editorSchema),
    mode: "onChange",
    defaultValues: {
      name: profile?.name ?? "",
      description: profile?.description ?? "",
      changeNote: "",
      configuration: profile?.configuration ?? initialConfiguration,
    },
  });
  const {
    register,
    control,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = form;
  const config = useWatch({ control, name: "configuration" }) as ProfileConfig;
  const id = (name: string) => `${ids}-${name}`;
  const cfgErrors = (errors.configuration ?? {}) as FieldErrors<ProfileConfig>;
  const err = (section: keyof ProfileConfig, field: string): string | undefined =>
    ((cfgErrors[section] as Record<string, { message?: string }> | undefined)?.[field]?.message as string) ??
    undefined;

  // Warn before leaving with unsaved changes: closing the tab, or following an in-app link.
  useEffect(() => {
    if (!isDirty || readOnly) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!leavingRef.current) event.preventDefault();
    };
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest("a[href]");
      if (!anchor || anchor.getAttribute("target") === "_blank" || leavingRef.current) return;
      if (!window.confirm("You have unsaved changes. Leave without saving?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [isDirty, readOnly]);

  async function onSubmit(values: EditorOutput) {
    const body = {
      name: values.name,
      description: values.description || null,
      configuration: values.configuration,
      ...(values.changeNote ? { changeNote: values.changeNote } : {}),
    };
    try {
      if (!profile) {
        const created = await apiFetch<{ id: string }>("/api/profiles", { method: "POST", body });
        reset(values);
        toast.success("Profile created as version 1.");
        router.push(`/profiles/${created.id}`);
        return;
      }
      const saved = await apiFetch<{ currentVersion: number }>(`/api/profiles/${profile.id}`, {
        method: "PATCH",
        body: { ...body, expectedVersion: profile.currentVersion },
      });
      if (saved.currentVersion === profile.currentVersion) {
        toast.info("Nothing changed, so no new version was saved.");
        return;
      }
      reset({ ...values, changeNote: "" });
      toast.success(
        `Saved as version ${saved.currentVersion}. Future runs use it; runs already started keep their settings.`,
      );
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === "VERSION_CONFLICT") {
        setConflict((error.details as { currentVersion?: number } | undefined)?.currentVersion ?? null);
      } else if (error instanceof ApiError && error.code === "VALIDATION_ERROR") {
        for (const [path, message] of Object.entries(error.fieldErrors())) {
          setError(path as never, { message });
        }
        toast.error("Some settings need attention. Fields with problems are marked.");
      } else {
        toast.error(error instanceof ApiError ? error.message : "The profile could not be saved.");
      }
    }
  }

  const sectionHasError = (section: string) => Boolean((cfgErrors as Record<string, unknown>)[section]);
  const weightTotal = Object.values(config?.ai?.weights ?? {}).reduce(
    (sum, v) => sum + (Number.isFinite(Number(v)) ? Number(v) : 0),
    0,
  );
  const emailOptions = recipients;

  const section = (children: ReactNode) => (
    <div className="grid gap-5 px-4 py-5 lg:max-w-3xl">{children}</div>
  );

  const tabs = [
    {
      key: "general",
      label: "General",
      alert: Boolean(errors.name || errors.description || sectionHasError("general")),
      content: section(
        <>
          <Field id={id("name")} label="Profile name" error={errors.name?.message}>
            <Input id={id("name")} aria-invalid={Boolean(errors.name)} {...register("name")} />
          </Field>
          <Field id={id("description")} label="Description" hint="Optional. What this profile is for.">
            <Textarea id={id("description")} {...register("description")} />
          </Field>
          <Field
            id={id("maxJobs")}
            label="Jobs evaluated by AI per run"
            hint="Limits AI cost per run. Leave empty for no limit."
            error={err("general", "maxJobsToEvaluate")}
          >
            <Input
              id={id("maxJobs")}
              type="number"
              min={1}
              max={500}
              className="w-32"
              {...register("configuration.general.maxJobsToEvaluate", { setValueAs: nullableNumber })}
            />
          </Field>
        </>,
      ),
    },
    {
      key: "skills",
      label: "Skills & keywords",
      alert: sectionHasError("skills"),
      content: section(
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-[13px] font-medium">Required skills</legend>
            <p className="text-[13px] text-muted">
              A job must mention these. Alternative spellings count as the same skill.
            </p>
            <Controller
              control={control}
              name="configuration.skills.required"
              render={({ field }) => (
                <SkillListEditor
                  value={field.value ?? []}
                  onChange={field.onChange}
                  max={30}
                  disabled={readOnly}
                  addLabel="Add required skill"
                />
              )}
            />
            {err("skills", "required") && (
              <p className="text-[13px] text-danger">{err("skills", "required")}</p>
            )}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={id("matchMode")} label="How many required skills must match">
              <Select id={id("matchMode")} {...register("configuration.skills.requiredMatchMode")}>
                <option value="ANY">At least one</option>
                <option value="ALL">All of them</option>
                <option value="AT_LEAST">At least a number of them</option>
              </Select>
            </Field>
            {config?.skills?.requiredMatchMode === "AT_LEAST" && (
              <Field id={id("minMatches")} label="Minimum number" error={err("skills", "minRequiredMatches")}>
                <Input
                  id={id("minMatches")}
                  type="number"
                  min={1}
                  max={30}
                  className="w-24"
                  {...register("configuration.skills.minRequiredMatches", { valueAsNumber: true })}
                />
              </Field>
            )}
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-[13px] font-medium">Optional skills</legend>
            <p className="text-[13px] text-muted">Help the AI judge fit but are not required.</p>
            <Controller
              control={control}
              name="configuration.skills.optional"
              render={({ field }) => (
                <SkillListEditor
                  value={field.value ?? []}
                  onChange={field.onChange}
                  max={30}
                  disabled={readOnly}
                  addLabel="Add optional skill"
                />
              )}
            />
          </fieldset>
          <Field id={id("include")} label="Include keywords" hint="At least one must appear in the job.">
            <Controller
              control={control}
              name="configuration.skills.includeKeywords"
              render={({ field }) => (
                <ChipInput
                  id={id("include")}
                  value={field.value ?? []}
                  onChange={field.onChange}
                  placeholder="Type and press Enter"
                />
              )}
            />
          </Field>
          <Field
            id={id("exclude")}
            label="Exclude keywords"
            hint="Jobs mentioning any of these are rejected."
            error={err("skills", "excludeKeywords")}
          >
            <Controller
              control={control}
              name="configuration.skills.excludeKeywords"
              render={({ field }) => (
                <ChipInput
                  id={id("exclude")}
                  value={field.value ?? []}
                  onChange={field.onChange}
                  placeholder="Type and press Enter"
                  invalid={Boolean(err("skills", "excludeKeywords"))}
                />
              )}
            />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-[13px] font-medium">Required combinations</legend>
            <p className="text-[13px] text-muted">
              Groups of terms that must appear together, such as &quot;Zoho + API&quot;. At least one group
              must match.
            </p>
            <Controller
              control={control}
              name="configuration.skills.requiredCombinations"
              render={({ field }) => (
                <CombinationEditor
                  value={(field.value as string[][]) ?? []}
                  onChange={field.onChange}
                  disabled={readOnly}
                />
              )}
            />
          </fieldset>
          <Field id={id("category")} label="Category" hint="Optional. Only jobs in this category pass.">
            <Input
              id={id("category")}
              {...register("configuration.skills.category", { setValueAs: nullableText })}
            />
          </Field>
        </>,
      ),
    },
    {
      key: "budget",
      label: "Budget & job type",
      alert: sectionHasError("budget"),
      content: section(
        <>
          <Field id={id("jobType")} label="Job type">
            <Select id={id("jobType")} {...register("configuration.budget.jobType")}>
              <option value="FIXED">Fixed-price only</option>
              <option value="HOURLY">Hourly only</option>
              <option value="BOTH">Fixed-price and hourly</option>
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id={id("currency")} label="Currency" error={err("budget", "currency")}>
              <Input
                id={id("currency")}
                maxLength={3}
                className="w-24 uppercase"
                {...register("configuration.budget.currency", {
                  setValueAs: (v: string) => (typeof v === "string" ? v.trim().toUpperCase() : v),
                })}
              />
            </Field>
            <Field
              id={id("fixedMin")}
              label="Minimum fixed budget"
              hint="A budget range uses its lower bound."
              error={err("budget", "fixedMin")}
            >
              <Input
                id={id("fixedMin")}
                inputMode="decimal"
                placeholder="No minimum"
                {...register("configuration.budget.fixedMin", { setValueAs: nullableText })}
              />
            </Field>
            <Field id={id("fixedMax")} label="Maximum fixed budget" error={err("budget", "fixedMax")}>
              <Input
                id={id("fixedMax")}
                inputMode="decimal"
                placeholder="No maximum"
                {...register("configuration.budget.fixedMax", { setValueAs: nullableText })}
              />
            </Field>
          </div>
          <Field id={id("hourlyMin")} label="Minimum hourly rate" error={err("budget", "hourlyMin")}>
            <Input
              id={id("hourlyMin")}
              inputMode="decimal"
              placeholder="No minimum"
              className="w-40"
              {...register("configuration.budget.hourlyMin", { setValueAs: nullableText })}
            />
          </Field>
          <Field id={id("missingBudget")} label="When a job has no budget">
            <Select id={id("missingBudget")} {...register("configuration.budget.missingBudgetPolicy")}>
              <option value="FAIL">Reject the job</option>
              <option value="NEEDS_REVIEW">Send it to review</option>
            </Select>
          </Field>
          <Field id={id("currencyMode")} label="Budgets in other currencies">
            <Select id={id("currencyMode")} {...register("configuration.budget.currencyPolicy.mode")}>
              <option value="SAME_CURRENCY_ONLY">Treat as unknown (no conversion)</option>
              <option value="FIXED_RATES">Convert with fixed exchange rates</option>
            </Select>
          </Field>
          {config?.budget?.currencyPolicy?.mode === "FIXED_RATES" && (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-[13px] font-medium">Exchange rates</legend>
              <Controller
                control={control}
                name="configuration.budget.currencyPolicy.rates"
                render={({ field }) => (
                  <RatesEditor
                    value={(field.value as Record<string, string>) ?? {}}
                    onChange={field.onChange}
                    currency={config.budget.currency}
                    disabled={readOnly}
                  />
                )}
              />
              {(cfgErrors.budget as { currencyPolicy?: { rates?: { message?: string } } } | undefined)
                ?.currencyPolicy?.rates?.message && (
                <p className="text-[13px] text-danger">
                  {
                    (cfgErrors.budget as { currencyPolicy?: { rates?: { message?: string } } }).currencyPolicy
                      ?.rates?.message
                  }
                </p>
              )}
            </fieldset>
          )}
        </>,
      ),
    },
    {
      key: "client",
      label: "Client",
      alert: sectionHasError("client"),
      content: section(
        <>
          <Checkbox
            label="Client payment verification is required"
            hint="Jobs whose payment status is unknown or unverified are rejected. It is never guessed from other client data."
            {...register("configuration.client.paymentVerificationRequired")}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              id={id("minRating")}
              label="Minimum client rating"
              hint="0 to 5. Empty: any."
              error={err("client", "minRating")}
            >
              <Input
                id={id("minRating")}
                type="number"
                step="0.1"
                min={0}
                max={5}
                {...register("configuration.client.minRating", { setValueAs: nullableNumber })}
              />
            </Field>
            <Field id={id("minHires")} label="Minimum hires" error={err("client", "minHires")}>
              <Input
                id={id("minHires")}
                type="number"
                min={0}
                {...register("configuration.client.minHires", { setValueAs: nullableNumber })}
              />
            </Field>
            <Field id={id("minSpent")} label="Minimum total spend" error={err("client", "minTotalSpent")}>
              <Input
                id={id("minSpent")}
                inputMode="decimal"
                {...register("configuration.client.minTotalSpent", { setValueAs: nullableText })}
              />
            </Field>
          </div>
          <Field id={id("allowed")} label="Allowed client countries" hint="Empty: any country.">
            <Controller
              control={control}
              name="configuration.client.allowedCountries"
              render={({ field }) => (
                <ChipInput
                  id={id("allowed")}
                  value={field.value ?? []}
                  onChange={field.onChange}
                  max={100}
                  placeholder="Country, then Enter"
                />
              )}
            />
          </Field>
          <Field id={id("blocked")} label="Blocked client countries">
            <Controller
              control={control}
              name="configuration.client.blockedCountries"
              render={({ field }) => (
                <ChipInput
                  id={id("blocked")}
                  value={field.value ?? []}
                  onChange={field.onChange}
                  max={100}
                  placeholder="Country, then Enter"
                />
              )}
            />
          </Field>
          <Field
            id={id("unknownClient")}
            label="When the source does not provide client data"
            hint="Applies to the rating, hires, spend and country conditions above."
          >
            <Select id={id("unknownClient")} {...register("configuration.client.unknownClientDataPolicy")}>
              <option value="FAIL">Reject the job</option>
              <option value="NEEDS_REVIEW">Send it to review</option>
              <option value="IGNORE">Ignore that condition</option>
            </Select>
          </Field>
        </>,
      ),
    },
    {
      key: "ai",
      label: "AI scoring",
      alert: sectionHasError("ai"),
      content: section(
        <>
          <Field
            id={id("minScore")}
            label="Minimum AI score to qualify"
            hint="0 to 100. Jobs below it are rejected; the threshold is never lowered to fill the alert limit."
            error={err("ai", "minScore")}
          >
            <Input
              id={id("minScore")}
              type="number"
              min={0}
              max={100}
              className="w-24"
              {...register("configuration.ai.minScore", { valueAsNumber: true })}
            />
          </Field>
          <fieldset className="flex flex-col gap-3">
            <legend className="text-[13px] font-medium">Score weights</legend>
            <div className="grid gap-3 sm:grid-cols-5">
              {(
                [
                  ["skillAlignment", "Skills"],
                  ["scopeFit", "Scope"],
                  ["descriptionClarity", "Clarity"],
                  ["clientCredibility", "Client"],
                  ["overallRelevance", "Relevance"],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} id={id(`w-${key}`)} label={`${label} (%)`}>
                  <Input
                    id={id(`w-${key}`)}
                    type="number"
                    min={0}
                    max={100}
                    {...register(`configuration.ai.weights.${key}`, { valueAsNumber: true })}
                  />
                </Field>
              ))}
            </div>
            <p
              role="status"
              className={`tabular text-[13px] ${weightTotal === 100 ? "text-success" : "text-danger"}`}
            >
              Weights add up to {weightTotal}/100
              {weightTotal === 100
                ? "."
                : `. Adjust them by ${100 - weightTotal > 0 ? "+" : ""}${100 - weightTotal}.`}
            </p>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={id("risk")} label="Risk sensitivity">
              <Select id={id("risk")} {...register("configuration.ai.riskSensitivity")}>
                <option value="LOW">Low: only listed risk flags block a job</option>
                <option value="MEDIUM">Medium: high-severity flags also block</option>
                <option value="HIGH">High: medium and high flags block</option>
              </Select>
            </Field>
            <Field
              id={id("retries")}
              label="Retries when the AI answer is invalid"
              error={err("ai", "maxRetries")}
            >
              <Input
                id={id("retries")}
                type="number"
                min={0}
                max={3}
                className="w-24"
                {...register("configuration.ai.maxRetries", { valueAsNumber: true })}
              />
            </Field>
          </div>
          <Field
            id={id("flags")}
            label="Risk flags that always disqualify"
            hint="Flag codes such as OFF_PLATFORM_PAYMENT."
          >
            <Controller
              control={control}
              name="configuration.ai.disqualifyingRiskFlags"
              render={({ field }) => (
                <ChipInput
                  id={id("flags")}
                  value={field.value ?? []}
                  onChange={(next) => field.onChange(next.map((f) => f.toUpperCase().replace(/\s+/g, "_")))}
                  max={30}
                  placeholder="Flag code, then Enter"
                />
              )}
            />
          </Field>
          <p className="text-[13px] text-muted">
            AI never overrides the rules on the other tabs: a job must pass them before it is scored.
          </p>
        </>,
      ),
    },
    {
      key: "search",
      label: "Search & sync",
      alert: sectionHasError("search"),
      content: section(
        <>
          <Field
            id={id("keywords")}
            label="Search keywords"
            hint="The Upwork sync searches for each keyword, newest jobs first. Up to 20."
            error={err("search", "keywords")}
          >
            <Controller
              control={control}
              name="configuration.search.keywords"
              render={({ field }) => (
                <ChipInput
                  id={id("keywords")}
                  value={field.value ?? []}
                  onChange={field.onChange}
                  max={20}
                  placeholder="Keyword, then Enter"
                />
              )}
            />
          </Field>
          <Field
            id={id("coverage")}
            label="Keyword coverage required (%)"
            hint="Reject jobs mentioning fewer of the keywords than this. Whole words, in the title, description or skills. Leave empty to turn off."
            error={err("search", "keywordCoveragePercent")}
          >
            <Input
              id={id("coverage")}
              type="number"
              min={1}
              max={100}
              className="w-24"
              {...register("configuration.search.keywordCoveragePercent", { setValueAs: nullableNumber })}
            />
          </Field>
          <Checkbox
            label="Sync this profile from Upwork on a schedule"
            hint="The Upwork sync agent (Claude + Upwork) imports new jobs when this profile is due. Manual syncs always work."
            {...register("configuration.search.upworkSync.enabled")}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id={id("everyHours")}
              label="Sync every (hours)"
              error={
                (cfgErrors.search?.upworkSync as Record<string, { message?: string }> | undefined)?.everyHours
                  ?.message
              }
            >
              <Input
                id={id("everyHours")}
                type="number"
                min={1}
                max={24}
                className="w-24"
                {...register("configuration.search.upworkSync.everyHours", { valueAsNumber: true })}
              />
            </Field>
            <Field id={id("timezone")} label="Time zone" hint="IANA name, e.g. Asia/Kolkata or UTC.">
              <Input id={id("timezone")} {...register("configuration.search.upworkSync.timezone")} />
            </Field>
            <Field id={id("activeFrom")} label="Active from">
              <Input
                id={id("activeFrom")}
                type="time"
                {...register("configuration.search.upworkSync.activeFrom")}
              />
            </Field>
            <Field id={id("activeTo")} label="Active until">
              <Input
                id={id("activeTo")}
                type="time"
                {...register("configuration.search.upworkSync.activeTo")}
              />
            </Field>
          </div>
        </>,
      ),
    },
    {
      key: "notifications",
      label: "Notifications",
      alert: sectionHasError("notifications"),
      content: section(
        <>
          <Field
            id={id("emailRecipient")}
            label="E-mail recipient"
            hint={
              emailOptions.length === 0
                ? "No e-mail recipient with confirmed opt-in yet. Add one in Settings."
                : "Only recipients who agreed to receive alert e-mails are listed."
            }
            error={err("notifications", "emailRecipientId")}
          >
            <Select
              id={id("emailRecipient")}
              {...register("configuration.notifications.emailRecipientId", { setValueAs: nullableText })}
            >
              <option value="">No recipient</option>
              {emailOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label} ({r.address})
                </option>
              ))}
            </Select>
          </Field>
          <Checkbox
            label="Send e-mail alerts for qualified leads"
            hint="Requires an e-mail recipient above."
            {...register("configuration.notifications.emailEnabled")}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id={id("maxPerRun")}
              label="Maximum alerts per run"
              hint="Best-scoring leads first. Fewer are sent if fewer qualify."
              error={err("notifications", "maxPerRun")}
            >
              <Input
                id={id("maxPerRun")}
                type="number"
                min={1}
                max={50}
                className="w-24"
                {...register("configuration.notifications.maxPerRun", { valueAsNumber: true })}
              />
            </Field>
            <Field id={id("format")} label="Message format">
              <Select id={id("format")} {...register("configuration.notifications.messageFormat")}>
                <option value="STANDARD">Standard (full details)</option>
                <option value="COMPACT">Compact</option>
              </Select>
            </Field>
          </div>
          <Checkbox
            label="E-mail a summary after every run"
            hint="Sent to the e-mail recipient above while e-mail alerts are on."
            {...register("configuration.notifications.sendRunSummary")}
          />
          <Checkbox
            label="E-mail an alert when a run fails or finishes with errors"
            {...register("configuration.notifications.alertOnFailure")}
          />
        </>,
      ),
    },
  ];

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      {readOnlyReason && (
        <p role="note" className="border-b border-line bg-info-soft px-4 py-2 text-sm text-muted">
          {readOnlyReason}
        </p>
      )}
      {/* Only read-only mode disables the fields: React Hook Form submits disabled fields as undefined. */}
      <fieldset disabled={readOnly} className="contents">
        <Tabs label="Profile settings" items={tabs} active={tab} onChange={setTab} />
        {!readOnly && (
          <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line px-4 py-4">
            <div className="min-w-64 flex-1 sm:max-w-md">
              <Field id={id("note")} label="Change note" hint="Optional. Shown in the version history.">
                <Input
                  id={id("note")}
                  placeholder="e.g. Raised the minimum budget"
                  {...register("changeNote")}
                />
              </Field>
            </div>
            <div className="flex items-center gap-2">
              {isDirty && <span className="text-[13px] text-muted">Unsaved changes</span>}
              <Button type="button" variant="secondary" asChild>
                <Link href={profile ? `/profiles/${profile.id}` : "/profiles"} onClick={() => reset()}>
                  {profile ? "Discard changes" : "Cancel"}
                </Link>
              </Button>
              <Button type="submit" disabled={isSubmitting || (!isDirty && Boolean(profile))}>
                {isSubmitting ? "Saving…" : profile ? "Save new version" : "Create profile"}
              </Button>
            </div>
          </div>
        )}
      </fieldset>

      <Dialog open={conflict !== null} onOpenChange={(open) => !open && setConflict(null)}>
        <DialogContent
          title="This profile was changed by someone else"
          description={`Version ${conflict ?? "?"} was saved while you were editing. Saving now would overwrite it, so nothing was saved.`}
        >
          <div className="flex flex-wrap justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Keep editing</Button>
            </DialogClose>
            <Button
              onClick={() => {
                leavingRef.current = true;
                window.location.reload();
              }}
            >
              Discard my changes and load the latest version
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </form>
  );
}
