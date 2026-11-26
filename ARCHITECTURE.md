# DosarIA — Architecture

DosarIA is a multi-tenant web application for Romanian law firms to track court
files, detect (currently simulated) court updates, read short Romanian summaries
and manage lawyer-confirmed reminders.

This document describes the MVP as built. Anything listed as *future* is not implemented.

## 1. Components

```
Browser ──HTTPS──▶ Next.js 16 (App Router, Node runtime)
                    │
                    ├─ src/proxy.ts            CSP nonce, session refresh, optimistic redirect
                    ├─ src/app/**               Server Components (pages) + Server Actions
                    ├─ src/server/context.ts    verified identity + memberships (per request)
                    ├─ src/server/dal/*         authorized data access (Zod + RLS-scoped client)
                    ├─ src/server/monitoring/*  provider interface, mock provider, normalize, diff
                    └─ src/server/summaries/*   deterministic templates; gated LLM interface
                    │
                    ├──(user JWT, RLS applies)──────────▶ Supabase PostgREST ─▶ PostgreSQL
                    ├──(service role, 2 call sites)─────▶ Supabase PostgREST ─▶ PostgreSQL
                    └──(auth)───────────────────────────▶ Supabase Auth (GoTrue)
```

There is no separate backend service, queue or cache. Monitoring checks run only
when an authorized user clicks “Verifică actualizări” (no polling, no scraping).

The browser never talks to Supabase. Sign-in, sign-up, password reset and all
data access go through Server Actions or Route Handlers. As a result:

- no Supabase key exists in client bundles (verified by an E2E test and `npm run scan:secrets`);
- session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production;
- the CSP can restrict `connect-src` to `'self'`.

## 2. Request flow and authorization layers

1. **Proxy** (`src/proxy.ts`) generates a CSP nonce, refreshes the session
   (`auth.getClaims()`), sets `Cache-Control: private, no-store` on private
   pages, and redirects anonymous visitors to `/login`. It is a convenience
   layer only, not an authorization layer.
2. **Context** (`src/server/context.ts`). `getAuthContext()` calls
   `auth.getUser()`, which validates the session with the Auth server, then
   loads the caller's *active* memberships through RLS. The active-organization
   cookie is treated as a preference, and is honoured only if it matches one of
   those memberships.
3. **Server Actions** (`src/app/actions/*`) re-verify the session on every call,
   read only whitelisted form keys, and delegate to the DAL.
4. **DAL** (`src/server/dal/*`) validates input with strict Zod schemas, which
   reject unknown keys. It runs app-level role checks, so errors are clear and
   there is defence in depth, and it queries through the user's RLS-scoped
   client. `organization_id` is always taken from the active membership or from
   a case row that the user was allowed to read, never from the client.
5. **PostgreSQL** is the final authority:
   - column-level `GRANT`s
   - RLS policies
   - guard triggers
   - composite foreign keys
   - append-only audit

A “not found” and a “not authorized” are deliberately indistinguishable to the
caller (the `notFound()` page for both), so probing UUIDs reveals nothing.

## 3. Data model

All primary keys are UUIDs, except `audit_logs.id` (an identity bigint).
Migrations: `supabase/migrations/`.

| Table | Purpose |
|---|---|
| `profiles` | One row per auth user (email mirror, display name). Created by a trigger on `auth.users`. |
| `organizations` | Tenants (law firms). |
| `organization_memberships` | **The only source of roles** (`admin`, `lawyer`, `assistant`) and status (`active`, `suspended`, `removed`). Unique `(organization_id, user_id)`. |
| `organization_invitations` | Expiring (≤ 7 days; the app issues 72 h), single-use, email-bound invitations. Only the SHA-256 hash of the token is stored. |
| `cases` | Court files. `assigned_user_id` is the responsible lawyer; `assigned_assistant_id` is an optional assistant. Monitoring state columns are system-managed. |
| `case_snapshots` | Normalized provider responses (`complete` / `incomplete`), with a canonical SHA-256 `content_hash`. Preserved for audit. |
| `case_events` | Detected changes. `UNIQUE (case_id, event_key)` deduplicates events. Includes Romanian and English summaries and `requires_review`. |
| `deadline_reminders` | `origin` (`manual` / `suggested`), `status` (`proposed` / `confirmed` / `completed` / `needs_review`), and who confirmed it and when. |
| `monitoring_runs` | Every check attempt with its outcome, including failures. |
| `audit_logs` | Append-only security and change history (minimal metadata). |

### Cross-tenant integrity (enforced by the database)

- `cases` has `UNIQUE (organization_id, id)`. Every child table references
  `(organization_id, case_id) → cases(organization_id, id)`, so a child row
  cannot pair one firm's ID with another firm's case. This holds even for the
  service role.
- `cases (organization_id, assigned_user_id)` and
  `(organization_id, assigned_assistant_id)` reference
  `organization_memberships (organization_id, user_id)`. An assignee must be a
  member of the case's own firm. A trigger additionally requires an *active*
  membership with a suitable role.
- `deadline_reminders (case_id, source_event_id) → case_events (case_id, id)`
  and `case_events (case_id, snapshot_id) → case_snapshots (case_id, id)`
  prevent linking records across cases.

## 4. Access matrix (who can do what)

“Member” means an *active* membership in the row's organization. “Readable
case” means one of these:
- the caller is an admin of the case's organization, or
- the caller is the case's assigned lawyer or assistant, with an active membership.

“Writable case” means one of these:
- the caller is an admin of the case's organization, or
- the caller is the case's assigned lawyer, with role `lawyer`.

A ✗ means there is no grant and/or no policy, so PostgreSQL denies the
operation. `anon` has no privileges on any table.

| Table | SELECT | INSERT | UPDATE | DELETE | Privileged path |
|---|---|---|---|---|---|
| `profiles` | Self; users sharing an organization | ✗ (trigger on `auth.users`) | Self, `full_name` and `preferred_locale` only | ✗ | Auth trigger |
| `organizations` | Members | ✗; only RPC `create_organization` (caller becomes admin; email must be verified; max 3 per user) | Admins, `name` only | ✗ | `private.purge_organization` (DB owner only) |
| `organization_memberships` | Own rows; members of the same organization | ✗; only RPCs `create_organization` / `accept_invitation` | Admins, `role` and `status` only. Not their own row. The last active admin is protected. `organization_id` / `user_id` are immutable. | ✗ (use status `removed`) | Seed/test fixtures (service role) |
| `organization_invitations` | Admins of that organization | Admins; `invited_by` is forced to the caller | Admins: revoke only (`revoked_at`) | ✗ | `accept_invitation` (definer, checks token, expiry, revocation and verified email) |
| `cases` | Admins: all cases in their organization. Others: assigned cases only. | Admin: any case in their organization. Lawyer: only `assigned_user_id = self` and no assistant. `created_by` is forced. | Admin: any case in their organization. Lawyer: assigned cases, and the new row must stay assigned to them. Assignment changes are admin-only. `organization_id`, `created_by` and monitoring columns are not granted. | ✗ (archive via `status`) | `record_monitoring_run` updates monitoring columns |
| `case_snapshots` | Readable case | ✗ | ✗ | ✗ | `record_monitoring_run` (service role only) |
| `case_events` | Readable case | ✗ | ✗ | ✗ | `record_monitoring_run` (service role only) |
| `monitoring_runs` | Readable case | ✗ | ✗ | ✗ | `record_monitoring_run` (service role only) |
| `case_check_schedule` | Readable case | ✗ | ✗ | ✗ | `record_monitoring_run`, `claim_due_case_checks` (service role only) |
| `deadline_reminders` | Readable case | Writable case. Always `origin = manual`, `status = proposed`; `created_by` forced. | Writable case: `title`, `description`, `due_date`, `status`. Transitions are validated. Confirmation requires an authenticated admin or lawyer, and records `confirmed_by` / `confirmed_at` server-side. Editing a confirmed date voids the confirmation. | Writable case, only while `proposed` / `needs_review` | `record_monitoring_run` may add `suggested` / `proposed` reminders and set `needs_review`. It can **never** confirm. |
| `audit_logs` | Admins of that organization | ✗ (triggers; service role for security events) | ✗ for everyone, including the service role | ✗ for everyone, except owner-only purge with an explicit flag | `private.write_audit`, `dal/audit.ts` |

### SECURITY DEFINER functions

All of them live in schema `private`, which is **not** exposed by PostgREST. All
use `SET search_path = ''` with fully qualified names, take no user-ID
parameter, and derive the caller from `auth.uid()`. `EXECUTE` is revoked from
`PUBLIC` and `anon`, then granted explicitly:

| Function | Purpose | Granted to |
|---|---|---|
| `member_org_ids()`, `admin_org_ids()`, `case_creator_org_ids()`, `readable_case_ids()`, `writable_case_ids()`, `active_role(org)`, `is_org_admin(org)`, `shares_org_with(user)` | RLS helpers that avoid recursive policy evaluation. Each answers only about the calling user. | authenticated, service_role |
| `create_organization(name)` | Atomic org + first admin membership | authenticated (via `public.create_organization` wrapper) |
| `accept_invitation(token)` | Token hash lookup (`FOR UPDATE`), expiry/revocation/used checks, verified-email match, membership insert/reactivation | authenticated (via `public` wrapper) |
| `write_audit(...)` and the audit trigger functions | Append audit rows | service_role (triggers run as owner) |
| `export_organization(org)` | GDPR export (JSON) | service_role |
| `purge_organization(org, 'DELETE <uuid>')` | Irreversible tenant deletion | **nobody** (DB owner only) |

`public.record_monitoring_run(...)` is `SECURITY INVOKER` and executable only by
`service_role`. It re-checks that the case belongs to the given organization and
that the triggering user is an active member, then writes these in one
transaction:
- the snapshot
- the deduplicated events
- suggested reminders and `needs_review` flags
- the run row
- the case monitoring state
- the audit entry

Function ownership: every function is created by the migration role (`postgres`).
Re-audit with:
```sql
select n.nspname, p.proname, p.prosecdef, pg_get_userbyid(p.proowner) owner, p.proacl
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','private') order by 1,2;
```

## 5. Monitoring pipeline

`src/server/monitoring/check-case.ts`:

1. `getAuthorizedCase(ctx, id)` runs with the user's client, so RLS applies.
   Unknown or unauthorized cases → `not_found`, plus a `security.case_access_denied` audit entry.
2. Rate limits: 1 check per case per 5 s per user; 30 per minute per user.
3. `provider.fetchCase()` (10 s timeout). The provider result is untrusted.
4. `normalizeCourtCase()`: lenient Zod parse of the portal-shaped payload.
   - wrong types → `failed / invalid_response`
   - missing hearings, stage or status → `incomplete`. The snapshot is stored as
     `incomplete` and is never used as a baseline.
5. A canonical SHA-256 is compared against the last **complete** snapshot.
   Identical → `no_changes`; otherwise `detectChanges()` produces events.
6. `planNextCheck()` (`schedule.ts`) plans the next automatic check from the
   latest hearings (see *Scheduled checks* below).
7. `record_monitoring_run` is called through the service-role client, with the
   organization and case IDs **taken from the row verified in step 1**. It also
   stores the next check in `case_check_schedule`, in the same transaction.

Outcomes map one-to-one to the UI states:
- `changes_detected` → *Actualizare nouă detectată*
- `no_changes` → *Nicio modificare*
- `failed` → *Verificare eșuată*
- `incomplete` → *Date incomplete*
- `source_unavailable` → *Sursă indisponibilă*

`last_successful_check_at` advances only on `changes_detected` / `no_changes`.
A failure never overwrites the previous snapshot.

**Event deduplication.** `event_key` is the canonical hash of the fact an
event asserts. For example, a reschedule is keyed on `{type, previous_date,
new_date}`. Status and stage changes also include the previous snapshot hash,
so a genuine A→B→A→B sequence is recorded each time. Re-detections, including
concurrent double clicks, hit `UNIQUE (case_id, event_key)`.

**Providers**
- `MockCourtDataProvider`: deterministic synthetic timeline. See the comment at
  the top of `src/server/monitoring/providers/mock-provider.ts` and the README.
- `PortalJustSoapProvider`: real SOAP client, **disabled by flag**. See
  `docs/PORTAL-INTEGRATION.md` for details. It is HTTPS-only (the portal's
  HTTPS currently fails with Cloudflare 525) and needs explicit approval. It
  drops party lists, derives a labelled status, and declares `minIntervalMs`,
  which `check-case.ts` enforces before any request.
- Earlier stub behaviour, kept: it refuses non-HTTPS endpoints,
  performs no network I/O, and returns `provider_disabled`. That result is
  recorded as a failed check, never as “no changes”.

### Scheduled checks

Off unless `SCHEDULED_CHECKS_ENABLED=true`. A timer (host cron, or
`npm run scheduler` locally) calls `POST /api/internal/scheduled-checks` every
minute with `Authorization: Bearer <SCHEDULER_SECRET>`.

1. `claim_due_case_checks` (service role only) returns up to
   `SCHEDULER_BATCH_SIZE` **active** cases whose next check is due, and leases
   them (`FOR UPDATE SKIP LOCKED` + `claimed_until`), so two runs never check
   the same file. Cases without a schedule row are due immediately. An optional
   organization filter limits a run to one firm.
2. Each case goes through the same check as a manual one
   (`runScheduledCheck` → `performCheck`), recorded with
   `trigger_type = 'scheduled'` and no triggering user. The database rejects a
   scheduled run that names a user.
3. `record_monitoring_run` saves the next check and releases the lease. If a
   run cannot be saved, the lease expires and the case is retried.
4. With the real portal provider configured but not approved, nothing is
   claimed or fetched.

**Rules** (`src/server/monitoring/schedule.ts`, Europe/Bucharest time; unit-tested):

| Reason | When |
|---|---|
| `regular` | 07:30 and 18:00 on working days (weekends and Romanian public holidays skipped); criminal files every day |
| `after_hearing` | On a hearing day with no result yet: from the (estimated) hearing time + 3 h (14:00 if no time) until 22:00, every 30 min |
| `awaiting_result` | The next 2 checking days if still no result: 08:00–20:00, every 60 min |
| `retry` | After a failed, unavailable or incomplete check: within 60 min |

The earliest applicable time wins, never sooner than the provider's
`minIntervalMs` for one file. Public holidays (`calendar-ro.ts`) are used for
scheduling only; they must be verified by a lawyer before being reused for
deadline calculation.

The schedule lives in its own table, not on `cases`, so scheduler activity
never writes case audit entries or changes a case's `updated_at`.

## 6. Summaries

`SummaryProvider` interface (`src/server/summaries/types.ts`):

- `DeterministicSummaryProvider`: Romanian and English templates. Court text is
  quoted, whitespace-flattened and truncated. Decision summaries state
  explicitly that resulting deadlines are **not** calculated.
- `GatedLlmSummaryProvider`: refuses to construct unless `AI_PROVIDER_ENABLED`,
  `AI_EU_PROCESSING_VERIFIED`, `AI_DPA_SIGNED` and tenant authorization are all
  true. Even then it is unimplemented. `buildMinimalEventPrompt()` sends only
  allow-listed event facts (never party names or documents) and wraps court
  text in `<court_data>` as untrusted data.

The UI labels every summary as generated automatically from templates, and as
not constituting legal advice.

### Interface language

The interface is in Romanian (the default) and English, and lives in `src/i18n/`:
- **Dictionaries**: `dictionaries/en.ts` and `ro.ts`. Both have the same
  type, which the compiler and a unit test enforce.
- **Locale**: read from the `dosaria_locale` cookie (HttpOnly, `SameSite=Lax`).
  For signed-in users it is also stored in `profiles.preferred_locale`; it is
  restored at sign-in, and saved by `setLocaleAction`.
- **Where it is used**: the locale is part of `AuthContext`, so the DAL and
  Server Actions return messages in the user's language. It is never used for
  authorization.
- **Validation**: Zod schemas carry language-neutral message keys;
  `fieldErrorsOf(error, t)` translates them.
- **Court terms**: `court-terms.ts` maps published Romanian terms and court
  names to English glosses. In English the UI shows the gloss next to the
  original, and unknown terms are shown unchanged. Court-written free text is
  never translated.
- **Suggested reminders**: their stored text stays Romanian
  (`SUGGESTED_REMINDER_TEXT`), and the UI shows it in the reader's language.

## 7. Deadlines and reminders

There is no automatic Romanian procedural-deadline calculation. Reminders are:
- **manual**: entered by a lawyer;
- **suggested**: a hearing date taken from the source, `origin = suggested`.

Both start as `proposed` and become `confirmed` only through an explicit action
by an authorized lawyer. The database records who confirmed it and when, and
rejects confirmation without an authenticated lawyer or admin. When a hearing
moves, reminders dated on the old hearing date become `needs_review`. Only
`confirmed` reminders appear in the dashboard's “Confirmed deadlines” (“Termene confirmate”).

## 8. Testing strategy

| Layer | Location | Needs |
|---|---|---|
| Unit: normalization, diff, hashing, mock timeline, summaries, LLM gate, validation, redirects, rate limit | `tests/unit` | nothing |
| Direct DB/RLS: scenarios A–G, audit immutability (real JWTs via PostgREST) | `tests/integration/rls.test.ts` | local Supabase |
| Server Action + Route Handler authorization (real DB; only the Next request boundary mocked) | `tests/integration/actions.test.ts` | local Supabase |
| Monitoring pipeline, scenario H, deduplication, suggestions | `tests/integration/monitoring.test.ts` | local Supabase |
| End to end (production build): sign-up with email verification via Mailpit, reset, workflow, isolation by URL, headers, no secrets in bundles | `tests/e2e` | local Supabase + browser |

## 9. Future work (not implemented)

- Live `PortalJustSoapProvider` after legal, terms-of-use and transport approval.
  Scheduled checks are built but off by default (see §5).
- Email/in-app notifications, Google/Microsoft calendar sync.
- A deterministic, lawyer-reviewed deadline rules engine.
- MFA (TOTP) and SSO.
- Shared-store rate limiting for multi-instance deployments.
- Document upload (private buckets, short-lived signed URLs, malware scanning).
- Self-service GDPR export/deletion UI (the database functions exist).
