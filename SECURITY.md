# DosarIA — Security, Privacy and Data Protection

> **Status: MVP / pilot demonstrator.** DosarIA has **not** had an independent
> security assessment or legal review. **Do not import real client data**
> until the checklist in §9 is complete. Using Supabase or EU hosting does
> **not**, by itself, make the system GDPR compliant.

## 1. Threat model (summary)

Assets: client and court-file information under professional secrecy,
deadlines, user accounts, audit history.

Primary threats, in priority order:
1. **Cross-tenant disclosure**: a user of firm A reads or changes firm B's data.
2. **Cross-user disclosure** inside a firm: a lawyer reads a colleague's case.
3. **Privilege escalation**: self-promotion to admin, reassigning cases,
   moving records between firms, forging confirmations or court events.
4. **Credential exposure**: service-role key, session tokens, passwords.
5. **Web attacks**: XSS, CSRF, injection, IDOR, open redirects.
6. **Integrity of monitoring**: a failed check presented as “no changes”, or
   duplicate or forged events.
7. **AI misuse**: confidential data sent to a model; prompt injection from court text.

## 2. Tenant isolation: defence in depth

| Layer | Control | Where |
|---|---|---|
| Authentication | Supabase Auth (bcrypt-hashed passwords managed by Supabase; no custom hashing). Email verification required. `auth.getUser()` is validated server-side on every request. No user ID is ever accepted from the browser. | `src/server/context.ts` |
| Membership | Roles come **only** from `organization_memberships`, never from JWT or user metadata (a test writes `role=admin` into user metadata and shows it grants nothing). Membership changes are admin-only; memberships are created only by audited definer functions. | migrations `…0200`, `…0400` |
| RLS | Enabled on every table, with explicit per-operation policies. No policy = no access; `anon` has no grants. Child tables inherit the parent case's access. | `…0200_authorization.sql` |
| Column grants | `UPDATE` is granted per column. `organization_id`, `created_by`, monitoring state and confirmation metadata are not writable by users at the privilege level. | `…0200` |
| Guard triggers | Assignment changes are admin-only. Org and user keys are immutable. No self-role changes; the last active admin is protected. Reminder status transitions are validated. Confirmation requires an authenticated lawyer or admin and is stamped server-side. Invitations can only be revoked. | `…0300_guards_and_audit.sql` |
| Referential integrity | Composite FKs `(organization_id, case_id)` and `(organization_id, assigned_user_id)` make cross-firm association impossible, **even for the service role**. | `…0100_schema.sql` |
| Server-only privileged access | The service-role key is used only by `check-case.ts` (manual checks after RLS-verified access; scheduled checks on cases handed out by the service-role RPC `claim_due_case_checks`), `scheduler.ts` and `dal/audit.ts`. An ESLint rule forbids importing it anywhere else. It is never in a `NEXT_PUBLIC_*` variable. | `src/lib/supabase/admin.ts`, `eslint.config.mjs` |
| DAL | Strict Zod schemas (unknown keys rejected). Whitelisted form keys. App-level role checks. `organization_id` taken from verified rows. Minimal column selection. “Not found” and “forbidden” are indistinguishable. | `src/server/dal/*` |

SECURITY DEFINER functions live in the unexposed `private` schema, use
`search_path = ''` with fully qualified names, and only ever answer questions
about `auth.uid()`. See ARCHITECTURE.md §4 for the full matrix and the
ownership audit query.

## 3. Application protections

- **HTTPS**: production config validation rejects non-HTTPS `APP_URL` /
  `SUPABASE_URL`. HSTS (2 years, `includeSubDomains`) and `upgrade-insecure-requests`.
- **Cookies**: Supabase session cookies are `HttpOnly`, `SameSite=Lax`, and
  `Secure` in production. There is no browser Supabase client, so page scripts
  cannot read tokens.
- **CSP**: a per-request nonce with `script-src 'self' 'nonce-…' 'strict-dynamic'`
  (no `unsafe-eval` in production), plus `connect-src 'self'`,
  `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'` and
  `form-action 'self'`. `style-src` allows `'unsafe-inline'`, because UI
  primitives use style attributes; scripts remain nonce-locked.
- **Other headers**: `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive
  `Permissions-Policy`, COOP/CORP `same-origin`, and no `X-Powered-By`.
- **Scheduler endpoint** (`POST /api/internal/scheduled-checks`): returns 404
  unless `SCHEDULED_CHECKS_ENABLED=true` and a secret is set. It requires
  `Authorization: Bearer <SCHEDULER_SECRET>` (at least 32 characters, compared
  in constant time; 401 otherwise), runs one batch at a time per instance, and
  returns counts only, never case data. It uses no cookies or session. In
  production, also restrict it at the network level (only the cron caller) and
  keep the secret in the host's secret store.
- **CSRF**: mutations are Server Actions only (POST). Next.js checks
  `Origin` against `Host`, and `SameSite=Lax` cookies add a second layer. The
  only GET route handler (`/auth/confirm`) consumes single-use tokens and
  redirects only to sanitized same-origin paths.
- **XSS**: React escapes all output. There is no `dangerouslySetInnerHTML`.
  Court text is treated as untrusted and truncated.
- **SQL injection**: there is no raw SQL from the app. PostgREST uses
  parameterized queries. Search terms are restricted to a safe character set
  before they are used in filter expressions.
- **IDOR**: every ID is validated as a UUID and resolved through RLS. Scenario
  B/D tests and the E2E URL-manipulation test cover this.
- **Open redirect**: `safeNextPath()` accepts only same-origin relative paths.
- **Rate limiting**:
  - login: per IP and per email
  - sign-up and reset: per IP and per email
  - invitations and monitoring checks: per user
  - audit writes: per actor, to prevent log flooding
  - Supabase Auth applies its own server-side limits on top
  - **Limitation**: these limits are in-memory, so they apply per instance (see §8).
- **Interface language**: the `dosaria_locale` cookie and
  `profiles.preferred_locale` affect presentation only, never authorization.
  Unknown values fall back to Romanian. The column accepts only `en` and `ro`
  (CHECK constraint). Users can update it on their own profile only, through
  RLS and a single-column grant, and tests cover this.
- **Errors**: users see generic messages in their interface language. Server logs contain a context
  label and an error code only, never payloads, tokens or case content. The
  error boundary never renders exception text.
- **Caching**: authenticated responses carry `Cache-Control: private, no-store`.
  All app pages are dynamically rendered (`cacheComponents: false`,
  `force-dynamic`), so private data is never statically generated.
- **CORS**: the app exposes no cross-origin API. Server Actions are same-origin
  only. The Supabase API is not called from browsers; in production, restrict
  its allowed origins to the app domain in the Supabase dashboard.
- **Files**: no file storage in the MVP. Supabase Storage is disabled. If added
  later, use private buckets, object paths prefixed by the organization ID with
  RLS on `storage.objects`, short-lived signed URLs, size and type limits, and
  malware scanning.
- **Invitations**: a 256-bit random token is shown once, and only its SHA-256
  hash is stored. It expires after 72 h (the DB caps it at 7 days), is single
  use and revocable, and can only be accepted by an account whose **verified**
  email matches.

## 4. Audit trail

Recorded in `audit_logs`, mostly by database triggers, so the record does not
depend on application code:
- organization created or renamed
- member added, role changed, status changed
- invitation created, accepted, revoked
- case created, updated (changed column *names* only), assignment changed,
  status changed, archived
- reminder created, updated, confirmed, completed, deleted
- monitoring run completed (with outcome and error code)
- security events: case access denied, assignment denied, role change denied,
  invitation denied

Each entry has the organization, actor (user or system), action, resource type
and ID, a timestamp, and minimal metadata. Entries **exclude** passwords,
tokens, keys, invitee emails, case titles and court payloads. The table is
append-only: UPDATE is rejected for everyone including `service_role`, and
DELETE is possible only inside the owner-only `private.purge_organization`.
Only admins of the organization can read their entries. Security events about
another tenant's resource are stored with `organization_id = NULL`, so they are
never shown to that tenant.

## 5. Privacy and GDPR

- **Roles**: the law firm is the controller; Agora Origin acts as processor. A
  **Data Processing Agreement (Art. 28 GDPR)** must be signed with every firm
  *before* real data is processed. It should cover:
  - subject matter and duration
  - categories of data and data subjects
  - TOMs (this document)
  - sub-processors
  - assistance with data-subject requests
  - breach notification (without undue delay)
  - deletion or return at the end of the contract
  - audits
- **Professional secrecy**: lawyers' confidentiality obligations go beyond
  GDPR. The DPA and service terms must reflect them.
- **Data minimization**:
  - The app stores court-file metadata, hearing data and party names as
    published by the court source.
  - Case titles should avoid client personal data; the UI says so.
  - No documents are stored.
  - Profiles hold an email and a display name only.
  - Audit metadata is minimal.
- **Encryption**: TLS in transit (HTTPS; Supabase endpoints are TLS-only in the
  cloud). Supabase encrypts data at rest (AES-256) and backups. Verify this for
  the chosen plan.
- **Hosting**: deploy the Supabase project and the app in an **EU region**
  (e.g. Frankfurt `eu-central-1`). See §7. Confirm in writing where each
  sub-processor stores and processes data, including logs and backups.
- **Retention (proposal, to be confirmed with the pilot firm and documented in the DPA)**:

  | Data | Retention |
  |---|---|
  | Cases and their events, snapshots, reminders | While the case is active, plus a firm-defined period after archiving (e.g. 5 years, aligned with professional-record obligations), then deletion |
  | `monitoring_runs` | 12 months |
  | `case_snapshots` | Latest complete one + those referenced by events; older ones pruned after 12 months |
  | `audit_logs` | 24 months, or as the DPA requires |
  | Accounts | Deleted on request or 30 days after the contract ends |
  | Backups | According to the Supabase plan (point-in-time recovery window), expiring automatically |

  Automated pruning jobs are **not yet implemented**.
- **Export and deletion (architecture in place; UI deferred)**:
  - `private.export_organization(org_id)` (service role) returns all of a
    tenant's data as JSON.
  - `private.purge_organization(org_id, 'DELETE <org_id>')` (DB owner only)
    irreversibly deletes a tenant, including its audit history, and leaves a
    platform-level purge record. Run it only after a verified, documented
    request.
  - Users' auth accounts are deleted separately via the Auth admin API, since
    they may belong to other organizations.
- **Sub-processors (expected; confirm before the pilot)**:

  | Sub-processor | Purpose | Location to confirm |
  |---|---|---|
  | Supabase Inc. (on AWS) | Database, Auth, backups | EU region chosen at project creation |
  | Hosting provider for Next.js (e.g. Vercel, or a container host such as Hetzner, OVHcloud or Scaleway) | Application runtime, logs | Pin functions and logs to the EU |
  | Transactional email provider (production SMTP for Auth emails) | Verification and reset emails | EU-based provider recommended |
  | *(future)* LLM provider | Summaries | Only with EU processing, zero retention, no training, DPA |

- **AI**: disabled. The interface enforces EU-processing, DPA and tenant
  authorization flags, a minimal allow-listed payload (no party names or
  documents), and treats court content as untrusted data, never as
  instructions. Summaries are labelled as automatic and not legal advice.

## 6. Backups and recovery

- Use a Supabase plan with daily backups and **point-in-time recovery**, in the
  same EU region.
- Test a restore into a separate project **before the pilot**, and quarterly
  afterwards. Record the RPO and RTO achieved.
- Migrations in `supabase/migrations` can rebuild the schema from scratch:
  `supabase db reset` locally, `supabase db push` remotely.
- Keep the service-role key and database password in the hosting provider's
  secret manager. Rotate them on staff changes and after any suspected exposure.

## 7. EU deployment guidance

1. Create the Supabase project in an EU region (e.g. `eu-central-1` Frankfurt).
   Enable PITR, SSL enforcement and network restrictions for direct DB access.
2. Apply the schema: `npx supabase link --project-ref <ref>` then `npx supabase db push`.
3. Auth settings, mirroring `supabase/config.jsonc`:
   - email confirmations on
   - 12-character minimum, lower/upper/digits
   - secure password change
   - Site URL = `https://<your-domain>`, redirect URL `https://<your-domain>/auth/confirm`
   - custom SMTP (an EU provider) with the templates in `supabase/templates/`
   - sensible rate limits; consider CAPTCHA on sign-up
4. Disable unused services: Storage, Realtime, Edge Functions.
5. Deploy Next.js to an EU region, with HTTPS only and a custom domain.
   Set the variables from `.env.example` in the provider's **encrypted** env
   store. `SUPABASE_SECRET_KEY` must be server-only and never `NEXT_PUBLIC_*`.
6. Run a single instance, or replace the in-memory rate limiter before scaling out.
7. Configure log retention on the host. Make sure request bodies are not logged.
8. Turn on dependency scanning (Dependabot/Renovate), secret scanning (GitHub
   secret scanning or gitleaks in CI) and `npm audit` in CI.

## 8. Known limitations and remaining risks

- **Rate limiting** is per process (in-memory). With multiple instances or
  serverless scale-out the limits weaken. Move it to Postgres or the platform
  before production.
- **Organization creation** is open to any verified account (max 3 per
  account). For the pilot, consider disabling public sign-up and provisioning
  firms manually.
- **No MFA/SSO yet.** Strongly recommended before handling real client data.
  Supabase supports TOTP MFA; enforce it for admins as a minimum.
- **Session revocation on suspension**: suspended or removed members lose data
  access immediately (RLS checks the *current* membership), but their auth
  session stays valid until they sign out or it expires.
- **Membership visibility**: active members can see the names and emails of
  their own organization's members. This is intended within a firm; it is not
  restricted per case.
- **Party names** from the court source are stored in snapshots. Decide
  retention and visibility with the pilot firm.
- **Invitation email delivery** is not automated. The admin copies a one-time
  link and must send it through a trusted channel.
- **Mock data only.** The real portal integration is unverified: availability,
  HTTPS, terms of use, polling limits, data completeness. The `http://`
  endpoint would be refused by design.
- **`style-src 'unsafe-inline'`** is required by UI primitives. Scripts remain
  nonce-locked.
- **Audit coverage**: failed authorization is recorded where the app observes
  it. Attempts that RLS silently filters (e.g. listing) cannot be distinguished
  from legitimate empty results.
- **Dependency review**: dependencies are current stable releases as of
  November 2026. The shadcn/ui CLI added `cn` (class-name merging). Its npm
  publisher is the shadcn maintainer account, and 0.5.2 carries an SLSA
  provenance attestation. Run `npm audit` and review new transitive
  dependencies on every update.
- **Court summaries contain personal data** (finding from live portal
  validation, 2026-11-25). The portal's `solutieSumar` texts name parties and
  practitioners, so snapshots of real cases contain personal data even though
  the structured party list is dropped. DPA, retention and erasure must cover
  this. The (disabled) LLM allow-list includes `solution_text`, so
  **pseudonymization is a precondition** for ever enabling an LLM.
- **Portal transport**: the portal's HTTPS endpoint fails (Cloudflare 525) and
  the provider refuses HTTP by design. See `docs/PORTAL-INTEGRATION.md`.
- **Dev-only advisory (open)**: `npm audit` reports 4 *moderate* findings, all in
  one chain: `shadcn` (CLI) → `ts-morph` → `@ts-morph/common` → `minimatch`
  10.x (GHSA-g3hv-75wg-m249, a ReDoS via glob patterns, fixed in ≥ 11.0.1).
  - It is reachable only when a developer runs the shadcn CLI. `shadcn` is a
    devDependency, and `npm audit --omit=dev` reports **0** vulnerabilities.
  - npm's suggested fix is a breaking *downgrade* to shadcn 1.0.0 and was not
    applied. A cross-major `overrides` entry was also not applied, because it
    could break the CLI.
  - Re-check when shadcn updates ts-morph.
- **Snapshot baseline ordering** uses the database insertion time
  (`created_at`), never the provider-supplied `fetched_at`. Provider timestamps
  are untrusted and may be equal or skewed; this was found and fixed during
  verification.
- **No penetration test** has been performed.

## 9. Go-live checklist before real client data

- [ ] DPA signed with the pilot firm; sub-processor list confirmed in writing (EU locations)
- [ ] Legal review of professional-secrecy obligations, retention periods and terms of service
- [ ] Independent security review / penetration test of the deployed system
- [ ] MFA enforced (at least for admins); public sign-up disabled or restricted
- [ ] Shared-store rate limiting; production SMTP; CAPTCHA on sign-up
- [ ] Backups + PITR enabled and a restore tested
- [ ] Incident response and breach-notification procedure (72 h to the ANSPDCP when required)
- [ ] Retention/pruning jobs implemented
- [ ] Portal integration approved (terms, HTTPS, polling limits) before any live data source is enabled

## 10. Reporting a vulnerability

Report suspected vulnerabilities privately to Agora Origin's security contact
(to be defined before the pilot). Do not open public issues for security reports.
