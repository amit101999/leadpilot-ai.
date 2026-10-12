"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { ApiError, apiFetch } from "@/lib/http/client";

const MIN = 12;
const schema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(MIN, `Use at least ${MIN} characters`).max(256),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "The passwords do not match",
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "The new password must be different from the current one",
  });
type Values = z.infer<typeof schema>;

export function ChangePasswordForm() {
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  async function onSubmit(values: Values) {
    try {
      const result = await apiFetch<{ otherSessionsEnded: number }>("/api/auth/password", {
        method: "POST",
        body: { currentPassword: values.currentPassword, newPassword: values.newPassword },
      });
      reset();
      toast.success(
        result.otherSessionsEnded > 0
          ? `Password changed. You were signed out on ${result.otherSessionsEnded} other ${
              result.otherSessionsEnded === 1 ? "device" : "devices"
            }.`
          : "Password changed.",
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") {
        for (const [path, message] of Object.entries(error.fieldErrors())) {
          setError(path as keyof Values, { message });
        }
      } else if (error instanceof ApiError && error.code === "RATE_LIMITED") {
        toast.error("Too many attempts. Wait 15 minutes and try again.");
      } else {
        toast.error(error instanceof ApiError ? error.message : "The password could not be changed.");
      }
    }
  }

  return (
    <form
      method="post"
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="grid max-w-md gap-4 px-4 py-4"
    >
      <Field id="current-password" label="Current password" error={errors.currentPassword?.message}>
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          aria-invalid={Boolean(errors.currentPassword)}
          {...register("currentPassword")}
        />
      </Field>
      <Field
        id="new-password"
        label="New password"
        hint={`At least ${MIN} characters. Your other sessions will be signed out.`}
        error={errors.newPassword?.message}
      >
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          aria-invalid={Boolean(errors.newPassword)}
          {...register("newPassword")}
        />
      </Field>
      <Field id="confirm-password" label="Repeat the new password" error={errors.confirmPassword?.message}>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          aria-invalid={Boolean(errors.confirmPassword)}
          {...register("confirmPassword")}
        />
      </Field>
      <div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Changing…" : "Change password"}
        </Button>
      </div>
    </form>
  );
}
