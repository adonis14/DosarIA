# DosarIA roadmap (updated 2026-11-25)

Legend: ✅ done and verified · 🔒 blocked by an external dependency · ⚠️ requires explicit Agora Origin approval before starting

## Done

- ✅ **MVP** (tag `mvp-verified-2026-11-25`):
  - Multi-tenant isolation via RLS, column grants, guard triggers, composite FKs and append-only audit
  - Auth (email verification, reset)
  - Cases, mock monitoring, Romanian summaries, lawyer-confirmed reminders
  - 129 unit/integration tests and 16 E2E tests passing locally
- ✅ **Portal research** (`docs/PORTAL-INTEGRATION.md`): WSDL contract, live validation, transport blocker identified.
- ✅ **Real provider behind a disabled flag**:
  - HTTPS-only, strict XML handling, exact court and number matching
  - Party list minimized, per-file minimum interval, unit-tested with no network
- ✅ Opt-in live validation harness (`npm run test:portal-live`), outside CI.

## Phase A: controlled technical demo (about 1–2 weeks, internal)

1. Staging per `docs/STAGING-DEPLOYMENT.md`:
   - EU Supabase project
   - EU container host
   - access gate
   - CI gate
   - staging seed variant
2. **MFA (TOTP)** in the app; required for admins.
3. **Disable public sign-up** for staging and pilot; admins provision firms.
4. **Shared rate limiting** (Postgres-backed) so the app can run more than one instance.
5. **Revoke sessions on suspension or removal** (Auth admin sign-out when the membership status changes).
6. Performance hygiene flagged by the Supabase advisors: indexes covering the composite tenant FKs (`organization_id, case_id`).
7. Demo script and a rehearsal on staging (mock data only).

## Phase B: portal unblock (external dependencies, in parallel)

1. 🔒 A person reads and archives the portal's **Termeni și condiții**, the
   **acces programatic** page and the service documentation. These pages are
   blocked to automated clients.
2. 🔒 Formal contact with the operator (Ministry of Justice / court IT):
   - confirm that commercial automated use is permitted
   - agree acceptable request volume
   - report the **HTTPS 525** fault and ask for it to be fixed
3. 🔒 HTTPS verified end to end with `npm run test:portal-live`.
4. Calibrate the `solutie` classifier on real vocabulary, with lawyer review:
   - "Termen preschimbat" is a rescheduling
   - "Alte soluţii" is ambiguous and needs human review
   - include penal and insolvency wording
5. Model appeals (`caiAtac`), or document them as out of scope.
6. Pseudonymization of court summaries (party and practitioner names) before
   any data leaves the system, and in any export or demo.

## Phase C: pilot readiness (before any real client data)

1. DPA with the pilot firm; sub-processor list (EU) confirmed in writing; legal review of professional-secrecy obligations.
2. Retention and pruning jobs (snapshots, runs, audit), plus the export/erasure UI. The database functions already exist.
3. Independent penetration test of staging; fix findings.
4. Incident response and breach-notification runbook; backup restore rehearsal.
5. Notifications: **in-app built** (per person: assigned lawyer, assistant and opt-in followers only; personal settings; deadline alerts always on). Still to do: transactional email via an EU provider, and a retention job for old notifications.
6. Production environment, a copy of staging with a separate project and keys.

## Phase D: requires explicit approval ⚠️

These are **not started**, and will not be without written approval:

- ⚠️ **Enabling the real portal provider** for client files. Requires the full
  checklist in `docs/PORTAL-INTEGRATION.md` §7.
- **Scheduled / automatic checks**: approved in principle by Agora Origin
  (2026-11-26) and **built, off by default** (`SCHEDULED_CHECKS_ENABLED`).
  Smart schedule: morning and evening; every 30 min after a hearing until the
  result appears; hourly the next 2 days; weekends for criminal files. See
  ARCHITECTURE.md §5. Still to do before live use:
  - ⚠️ live use stays blocked until the real portal provider is approved
  - `CautareDosare2` with a `dataUltimaModificare` window to avoid
    re-downloading unchanged files
  - a global request budget and back-off on 429/5xx
  - confirm the timings with real cases (when do results actually appear?)
- ✅ **Client note (built)**: a template draft per court update, with the court's exact wording; nothing is sent or stored. AI rewording stays in Phase D.
- ✅ **Private calendar link (built)**: ICS feed of hearings and confirmed deadlines, case number and court only. Needs the HTTPS staging address to be used from Google.
- ✅ **Court terms**: all 19 official stages and 11 categories glossed; review list in `docs/COURT-TERMS.md`.
- 📝 **Deadline rules draft** for lawyer review: `docs/DEADLINE-RULES-DRAFT.md` (not verified against the official text; not used by the app).
- ✅ **Ruling follow-up (built)**: every detected ruling opens a “communication date needed” task; the lawyer enters the communication date and their own deadline (no calculation). See ARCHITECTURE.md §7.
- ⚠️ **Procedural deadline calculation**: a deterministic, versioned rules
  engine, with every rule linked to the NCPC article and reviewed by a lawyer,
  and a 100% pass rate on a lawyer-built test set. Suggestions only; lawyer
  confirmation remains mandatory.
- ⚠️ **LLM summaries**:
  - EU processing, zero retention and a DPA verified
  - pseudonymized inputs
  - prompt-injection test set
  - always labelled as not legal advice
- ⚠️ **Calendar sync** (Google / Microsoft 365) with per-user OAuth consent.
