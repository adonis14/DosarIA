import { z } from "zod";
import type { Dictionary } from "@/i18n";

/**
 * Runtime validation for every input that crosses the trust boundary.
 * Objects are `strict`: unknown keys (e.g. organization_id, assigned_user_id,
 * role) are rejected rather than silently passed through.
 *
 * Messages are language-neutral keys (see MessageKey); fieldErrorsOf()
 * translates them into the caller's interface language.
 */

/** Validation message keys, translated by fieldErrorsOf(). */
type MessageKey = Exclude<keyof Dictionary["validation"], "tooShort" | "tooLong">;
type FieldKey = keyof Dictionary["fields"];
const msg = (key: MessageKey) => key;

export const uuid = z.uuid({ message: msg("invalidId") });

export const MATTER_TYPES = [
  "civil",
  "commercial",
  "labor",
  "administrative",
  "family",
  "enforcement",
  "insolvency",
  "criminal",
  "other",
] as const;
export const CASE_STATUSES = ["active", "closed", "archived"] as const;
export const ROLES = ["admin", "lawyer", "assistant"] as const;
export const MEMBER_STATUSES = ["active", "suspended", "removed"] as const;

/** Length messages carry the field key: "length:<field>" (min/max come from the Zod issue). */
const trimmed = (min: number, max: number, field: FieldKey) =>
  z.string().trim().min(min, `length:${field}`).max(max, `length:${field}`);

export const courtCaseNumber = z
  .string()
  .trim()
  .regex(/^[0-9]{1,7}\/[0-9]{1,5}\/[0-9]{4}(\/[A-Za-z0-9.*]{1,12}){0,3}$/, msg("caseNumber"));

export const email = z.string().trim().toLowerCase().max(320).pipe(z.email({ message: msg("email") }));

export const password = z
  .string()
  .min(12, msg("passwordMin"))
  .max(128, msg("passwordMax"))
  .regex(/[a-z]/, msg("passwordLower"))
  .regex(/[A-Z]/, msg("passwordUpper"))
  .regex(/[0-9]/, msg("passwordDigit"));

// `.optional()` (not a union with z.undefined()) so Zod 4 treats the key as optional.
const optionalUuid = z
  .union([uuid, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

// ---------- auth ----------
export const loginSchema = z.object({ email, password: z.string().min(1).max(128), next: z.string().max(512).optional() }).strict();
export const signupSchema = z.object({ email, password, fullName: trimmed(2, 120, "name") }).strict();
export const forgotPasswordSchema = z.object({ email }).strict();
export const updatePasswordSchema = z
  .object({ password, confirmPassword: z.string() })
  .strict()
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: msg("passwordsMismatch") });

// ---------- organizations ----------
export const organizationNameSchema = z.object({ name: trimmed(2, 120, "orgName") }).strict();
export const profileSchema = z.object({ fullName: trimmed(2, 120, "name") }).strict();
export const invitationSchema = z.object({ email, role: z.enum(ROLES) }).strict();
export const memberRoleSchema = z.object({ membershipId: uuid, role: z.enum(ROLES) }).strict();
export const memberStatusSchema = z.object({ membershipId: uuid, status: z.enum(MEMBER_STATUSES) }).strict();
export const invitationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, msg("invitationInvalid"));

// ---------- cases ----------
const caseFields = {
  courtCaseNumber,
  courtName: trimmed(2, 200, "court"),
  title: trimmed(2, 300, "title"),
  matterType: z.enum(MATTER_TYPES),
};

export const createCaseSchema = z
  .object({ ...caseFields, assignedUserId: optionalUuid, assignedAssistantId: optionalUuid })
  .strict();

export const updateCaseSchema = z.object({ ...caseFields, status: z.enum(CASE_STATUSES) }).strict();

export const assignCaseSchema = z
  .object({ assignedUserId: optionalUuid, assignedAssistantId: optionalUuid })
  .strict();

/** Search is matched with ILIKE; characters meaningful to PostgREST filter syntax are rejected. */
export const caseFiltersSchema = z
  .object({
    q: z
      .string()
      .trim()
      .max(100)
      .regex(/^[\p{L}\p{N}\s/\-.]*$/u, msg("searchChars"))
      .optional()
      .default(""),
    status: z.enum([...CASE_STATUSES, "all"]).optional().default("active"),
    matterType: z.enum([...MATTER_TYPES, "all"]).optional().default("all"),
    assignee: z.union([uuid, z.enum(["all", "me", "unassigned"])]).optional().default("all"),
  })
  .strict();
export type CaseFilters = z.infer<typeof caseFiltersSchema>;

// ---------- reminders ----------
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, msg("dateFormat"))
  .refine((v) => {
    // Round-trip check rejects impossible dates such as 2026-02-30.
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, msg("dateInvalid"))
  .refine((v) => v >= "2000-01-01" && v <= "2100-12-31", msg("dateRange"));

export const createReminderSchema = z
  .object({
    title: trimmed(2, 200, "title"),
    description: z.string().trim().max(2000).optional().transform((v) => (v ? v : null)),
    dueDate: isoDate,
    sourceEventId: optionalUuid,
  })
  .strict();

export const REMINDER_ACTIONS = ["confirm", "complete", "reopen", "flag", "unflag"] as const;
export const reminderActionSchema = z.object({ reminderId: uuid, action: z.enum(REMINDER_ACTIONS) }).strict();

/** Alert settings: unticked checkboxes are absent from the form. Deadline alerts have no setting. */
export const notificationPreferencesSchema = z
  .object({ courtUpdates: z.literal("on").optional(), checkProblems: z.literal("on").optional() })
  .strict()
  .transform((v) => ({ courtUpdates: v.courtUpdates === "on", checkProblems: v.checkProblems === "on" }));

/** Mark one notification (by id) or all of them as read. */
export const markNotificationsReadSchema = z
  .object({ notificationId: uuid.optional(), scope: z.literal("all").optional() })
  .strict()
  .refine((v) => (v.notificationId === undefined) !== (v.scope === undefined), msg("invalidId"));

/** FormData → plain object (single values only; files rejected). */
export function formToObject(formData: FormData, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = formData.get(key);
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/** Translate one issue. Unknown messages (e.g. Zod's built-in English ones) become a generic message. */
export function translateIssue(issue: z.core.$ZodIssue, t: Dictionary): string {
  const message = issue.message;
  if (message.startsWith("length:")) {
    const field = t.fields[message.slice("length:".length) as FieldKey] ?? t.fields.name;
    if (issue.code === "too_small") return t.validation.tooShort(field, Number(issue.minimum));
    if (issue.code === "too_big") return t.validation.tooLong(field, Number(issue.maximum));
  }
  const simple = t.validation[message as MessageKey];
  return typeof simple === "string" ? simple : t.validation.invalid;
}

export function fieldErrorsOf(error: z.ZodError, t: Dictionary): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    (out[key] ??= []).push(translateIssue(issue, t));
  }
  return out;
}
