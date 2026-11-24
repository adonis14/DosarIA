import { z } from "zod";

/**
 * Runtime validation for every input that crosses the trust boundary.
 * Objects are `strict`: unknown keys (e.g. organization_id, assigned_user_id,
 * role) are rejected rather than silently passed through.
 */

export const uuid = z.uuid({ message: "Identificator invalid." });

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

const trimmed = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, `${label}: minimum ${min} caractere.`)
    .max(max, `${label}: maximum ${max} caractere.`);

export const courtCaseNumber = z
  .string()
  .trim()
  .regex(/^[0-9]{1,7}\/[0-9]{1,5}\/[0-9]{4}(\/[A-Za-z0-9.*]{1,12}){0,3}$/, "Format număr dosar: 1234/3/2026 (opțional /a1).");

export const email = z.string().trim().toLowerCase().max(320).pipe(z.email({ message: "Adresă de e-mail invalidă." }));

export const password = z
  .string()
  .min(12, "Parola trebuie să aibă cel puțin 12 caractere.")
  .max(128, "Parola este prea lungă.")
  .regex(/[a-z]/, "Parola trebuie să conțină o literă mică.")
  .regex(/[A-Z]/, "Parola trebuie să conțină o literă mare.")
  .regex(/[0-9]/, "Parola trebuie să conțină o cifră.");

// `.optional()` (not a union with z.undefined()) so Zod 4 treats the key as optional.
const optionalUuid = z
  .union([uuid, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

// ---------- auth ----------
export const loginSchema = z.object({ email, password: z.string().min(1).max(128), next: z.string().max(512).optional() }).strict();
export const signupSchema = z.object({ email, password, fullName: trimmed(2, 120, "Numele") }).strict();
export const forgotPasswordSchema = z.object({ email }).strict();
export const updatePasswordSchema = z
  .object({ password, confirmPassword: z.string() })
  .strict()
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Parolele nu coincid." });

// ---------- organizations ----------
export const organizationNameSchema = z.object({ name: trimmed(2, 120, "Denumirea") }).strict();
export const profileSchema = z.object({ fullName: trimmed(2, 120, "Numele") }).strict();
export const invitationSchema = z.object({ email, role: z.enum(ROLES) }).strict();
export const memberRoleSchema = z.object({ membershipId: uuid, role: z.enum(ROLES) }).strict();
export const memberStatusSchema = z.object({ membershipId: uuid, status: z.enum(MEMBER_STATUSES) }).strict();
export const invitationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Invitație invalidă.");

// ---------- cases ----------
const caseFields = {
  courtCaseNumber,
  courtName: trimmed(2, 200, "Instanța"),
  title: trimmed(2, 300, "Titlul"),
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
      .regex(/^[\p{L}\p{N}\s/\-.]*$/u, "Căutarea poate conține doar litere, cifre, spații, „/”, „-” și „.”.")
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
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data trebuie să fie în formatul AAAA-LL-ZZ.")
  .refine((v) => {
    // Round-trip check rejects impossible dates such as 2026-02-30.
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Dată invalidă.")
  .refine((v) => v >= "2000-01-01" && v <= "2100-12-31", "Dată în afara intervalului permis.");

export const createReminderSchema = z
  .object({
    title: trimmed(2, 200, "Titlul"),
    description: z.string().trim().max(2000).optional().transform((v) => (v ? v : null)),
    dueDate: isoDate,
    sourceEventId: optionalUuid,
  })
  .strict();

export const REMINDER_ACTIONS = ["confirm", "complete", "reopen", "flag", "unflag"] as const;
export const reminderActionSchema = z.object({ reminderId: uuid, action: z.enum(REMINDER_ACTIONS) }).strict();

/** FormData → plain object (single values only; files rejected). */
export function formToObject(formData: FormData, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = formData.get(key);
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

export function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
