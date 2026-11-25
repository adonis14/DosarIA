/**
 * Text stored with reminders that monitoring suggests from a hearing date.
 *
 * The stored text stays in Romanian (the language of the court record and of
 * existing rows). The UI recognizes these exact values and shows them in the
 * viewer's interface language instead.
 */
export const SUGGESTED_REMINDER_TEXT = {
  title: "Termen de judecată (sugerat din sursă)",
  description: "Dată preluată automat din sursa monitorizată. Verificați și confirmați manual.",
} as const;

type ReminderText = { origin: string; title: string; description: string | null };
type ReminderMessages = { suggestedReminderTitle: string; suggestedReminderDescription: string };

/** Title/description to display: the localized text for unchanged suggested reminders, the stored text otherwise. */
export function displayReminderText(r: ReminderText, m: ReminderMessages): { title: string; description: string | null } {
  if (r.origin !== "suggested") return { title: r.title, description: r.description };
  return {
    title: r.title === SUGGESTED_REMINDER_TEXT.title ? m.suggestedReminderTitle : r.title,
    description: r.description === SUGGESTED_REMINDER_TEXT.description ? m.suggestedReminderDescription : r.description,
  };
}
