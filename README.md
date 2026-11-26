# DosarIA — MVP

AI-assisted Romanian court-case monitoring and deadline tracking for law firms,
built by **Agora Origin**.

This MVP demonstrates a **securely isolated multi-tenant** application in which
lawyers can:
- manage court files
- run (simulated) court-update checks
- read summaries in English or Romanian
- track reminders that a lawyer must confirm

> ⚠️ **Synthetic data only.** Court data comes from a deterministic mock
> provider. The real portal.just.ro integration is **not** active. DosarIA
> does not calculate procedural deadlines and does not give legal advice.
> Read [SECURITY.md](SECURITY.md) before using any real data.

- Architecture, data model and access matrix: [ARCHITECTURE.md](ARCHITECTURE.md)
- Security, GDPR, EU deployment and known risks: [SECURITY.md](SECURITY.md)

## Interface language

The interface is in **Romanian by default**, with a full **English** version.
Use the **EN / RO** switch in the header, on the sign-in pages or on the
Profile page:
- The choice is kept in a cookie and, for signed-in users, saved to their
  profile, so it follows them to another browser.
- In English, court-published terms (court names, stages, statuses, outcomes)
  are shown with the Romanian original next to them, e.g. *Bucharest Tribunal
  (Tribunalul București)*. Unknown terms are shown unchanged.
- Update summaries are stored in both languages. The other language is one
  click away.
- Free text written by the court, such as a ruling's summary, stays in
  Romanian. Auth emails contain both languages.

The walkthrough below quotes the Romanian labels. The English interface shows
the equivalents, for example *Check for updates* instead of *Verifică
actualizări*.

## Stack

- Next.js 16 (App Router, Server Actions, `proxy.ts`), React 19, TypeScript
- Tailwind CSS 4, shadcn/ui
- Supabase: Auth, PostgreSQL 17 and Row Level Security; local stack via Supabase CLI and Docker
- Zod 4, Vitest 5, Playwright

## Prerequisites

- Node.js ≥ 22
- Docker Desktop, running (for the local Supabase stack)
- The Supabase CLI is installed as a dev dependency (`npx supabase …`)

No external services or credentials are required for local development.

## Local setup

```bash
npm install
npx supabase start          # starts Postgres, Auth, PostgREST and Mailpit in Docker; applies migrations
npm run env:local           # writes .env.local from `supabase status` (keys are not printed)
npm run seed                # creates synthetic demo firms and users; prints the demo password
npm run dev                 # http://localhost:3000
```

Useful local URLs:
- App: http://localhost:3000
- Mailpit test inbox (verification and reset emails): http://127.0.0.1:54324
- Supabase Studio: http://127.0.0.1:54323

### Migrations

- **Fresh start**: `npm run db:reset` re-applies `supabase/migrations/*` to a
  clean database, then `npm run seed`.
- **Regenerate DB types** after a schema change: `npm run db:types`.
- **Remote (EU) project**: `npx supabase link --project-ref <ref> && npx supabase db push`.
  See SECURITY.md §7.

### Demo users (`npm run seed`)

| Firm | User | Role |
|---|---|---|
| București Legal Partners | `admin.a@bucuresti-legal.example.com` | Admin |
| | `avocat.a1@bucuresti-legal.example.com` | Lawyer (2 cases) |
| | `avocat.a2@bucuresti-legal.example.com` | Lawyer (2 cases) |
| | `asistent.a@bucuresti-legal.example.com` | Assistant (assigned to A1's first case) |
| Cluj Legal Group | `admin.b@cluj-legal.example.com` | Admin |
| | `avocat.b1@cluj-legal.example.com` | Lawyer (2 cases) |

All demo users share one password. It is printed by the seed script, or you
can set it with `DEMO_PASSWORD=...`. To create additional users, sign up at
`/signup`; the confirmation email arrives in Mailpit.

## Walking through the complete workflow

1. **Isolation.** Sign in as `avocat.a1`. You see only A1's cases. Copy the URL
   of a case, sign in as `avocat.a2` or `admin.b`, and open it: you get
   “Resursa nu a fost găsită”. `admin.a` sees every case of București Legal
   Partners, and none of Cluj Legal Group's.
2. **Monitoring.** Open a case and press **Verifică actualizări** repeatedly.
   The mock source moves through a fixed timeline:

   | Check # | Simulated source state | Displayed result |
   |---|---|---|
   | 1 | baseline | *Actualizare nouă detectată* (monitoring started) |
   | 2 | unchanged | *Nicio modificare* |
   | 3 | hearing moved by 7 days | *Termenul de judecată a fost reprogramat…* |
   | 4 | portal unreachable | *Sursă indisponibilă* (previous data kept) |
   | 5 | response without hearings | *Date incomplete* (not treated as a change) |
   | 6 | hearing postponed, new date | *Cauză amânată* |
   | 7 | ruling + status “Soluționat” | *Soluție pronunțată*, *Stare modificată* |
   | 8 | appeal opened, new hearing | *Stadiu procesual modificat*, *Termen nou* |
   | 9+ | unchanged | *Nicio modificare* |

   Case numbers starting with `9999/` are always unavailable, `9998/` return a
   malformed payload (*Verificare eșuată*), `9997/` are always incomplete, and
   `9996/` are not found at source. The seed includes `9999/3/2026`.
3. **Reminders.** New hearing dates appear as **Sugerat din sursă / Propus**
   reminders. When a hearing moves, the old reminder becomes **Necesită
   verificare**. Add a manual reminder, then press **Confirm termenul**: it
   becomes **Confirmat de avocat** with your name and the time, and appears on
   the dashboard under “Termene confirmate”. The assistant can see reminders
   but cannot confirm them.
4. **Administration.** As `admin.a`, open **Organizație**:
   - rename the firm
   - change roles and statuses
   - create an invitation: the link is shown once and expires after 72 h. Open
     it as a user signed in with the invited, verified email.
   - review the audit history
5. **Account.** Sign-up with email verification, password reset (via Mailpit),
   logout and profile editing.

## Notifications

Each person gets alerts only for **their own cases**: the ones where they are
the assigned lawyer or assistant, plus any case they choose to **follow** (the
“Follow this case” button on the case page). Colleagues' cases send nothing.

- The bell in the header shows the unread count. The **Notifications** page
  lists alerts (new court updates, checks that stopped working, deadlines added
  or flagged for review, new assignments) and **Your deadlines** (confirmed
  deadlines that are overdue or due within 7 days).
- **Alert settings** on the same page are personal, per firm: court updates
  and check problems can be switched off. Deadline alerts cannot.
- In-app only for now; email comes later.

Try it with the demo users:
1. Sign in as `avocat.a1`, open case **1234/3/2026** and press “Verifică actualizări”.
2. Sign in as `asistent.a` (assigned to that case): the bell shows the new alert.
   `avocat.a2` and `admin.a` get nothing for it.
3. As `admin.a`, open that case and press “Urmăriți dosarul” (Follow this case).
   After the next check, the admin gets its alerts too.

## Automatic checks (smart schedule)

Off by default; cases are then checked only when someone presses the button.
To try it locally with the simulated court source:

1. Add to `.env.local`:
   ```
   SCHEDULED_CHECKS_ENABLED=true
   SCHEDULER_SECRET=<32+ random characters>
   ```
   Generate one with
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
2. Restart `npm run dev`, then run `npm run scheduler` in a second terminal.
   It calls the app every minute; `npm run scheduler -- --once` runs one batch.

Each case page shows the **next automatic check** and why: regular (morning and
evening), after a hearing (every 30 minutes until the result appears), result
awaited (hourly), or a retry. The rules are in ARCHITECTURE.md §5.

Note: every check advances the simulated timeline of a case by one step, so
demo cases change faster than real ones would.

## Tests

```bash
npm run test:unit          # no infrastructure needed
npm run test:integration   # needs `npx supabase start` + `npm run env:local`
npx playwright install chromium   # once
npm run test:e2e           # builds and starts the app (production mode) on :3000
npm run test:all
```

**Live portal validation (opt-in, never in CI).** This sends a handful of
requests to the real public service, and contains no client data:
```bash
PORTAL_LIVE_VALIDATION=1 npm run test:portal-live                       # HTTPS check only
PORTAL_LIVE_VALIDATION=1 PORTAL_LIVE_ALLOW_HTTP_FOR_PUBLIC_QUERY=1 \
  npm run test:portal-live                                              # + public hearing list → one public case
```
The non-personal findings are written to `test-results/portal-live-report.json`.

Related documents:
- [docs/PORTAL-INTEGRATION.md](docs/PORTAL-INTEGRATION.md): API findings and the enablement gate
- [docs/STAGING-DEPLOYMENT.md](docs/STAGING-DEPLOYMENT.md): private EU staging plan
- [docs/ROADMAP.md](docs/ROADMAP.md): roadmap

- **Unit** (`tests/unit`): normalization, change detection, canonical hashing,
  the mock timeline, summaries (including the exact example from the brief),
  the LLM gate, validation, redirects and rate limiting.
- **RLS / database** (`tests/integration/rls.test.ts`): scenarios **A–G** run
  directly against PostgREST with real user JWTs, plus audit immutability.
- **Server Actions / Route Handler** (`tests/integration/actions.test.ts`):
  - every action, unauthenticated
  - injected `organization_id` / `assigned_user_id`
  - cross-tenant and cross-user IDs
  - role escalation
  - the invitation flow (expiry, wrong email, single use)
  - login and reset behaviour
- **Monitoring** (`tests/integration/monitoring.test.ts`): the full timeline,
  scenario **H** (failure keeps the previous snapshot and is never reported as
  “no changes”), deduplication under concurrency, suggestions and
  `needs_review`, and authorization.
- **E2E** (`tests/e2e`): sign-up with email verification through Mailpit,
  password reset, logout, the lawyer workflow, ID manipulation through URLs,
  admin and assistant views, security headers, and no keys in browser bundles.

Integration and E2E tests create uniquely named synthetic users and firms on
each run, and refuse to run against a non-local Supabase URL.

## Quality and security checks

```bash
npm run typecheck
npm run lint            # includes a rule restricting where the service-role client may be imported
npm run build
npm run audit:deps      # npm audit (production dependencies)
npm run scan:secrets    # scans files to be committed and .next/static bundles for credentials
```

## Environment variables

See [.env.example](.env.example). All variables are **server-only**; there are
no `NEXT_PUBLIC_*` variables, because the browser never talks to Supabase
directly.

| Variable | Required | Notes |
|---|---|---|
| `APP_URL` | yes | Used in email links; must be `https://` in production |
| `SUPABASE_URL` | yes | EU-region project in production |
| `SUPABASE_PUBLISHABLE_KEY` | yes | Publishable/anon key |
| `SUPABASE_SECRET_KEY` | yes | Service-role key. **Server only**; used by three reviewed modules (`check-case.ts`, `scheduler.ts`, `dal/audit.ts`) |
| `COURT_DATA_PROVIDER` | no | `mock` (default). `portaljust_soap` is a disabled interface |
| `MOCK_COURT_ANCHOR_DATE`, `MOCK_COURT_LATENCY_MS` | no | Mock timeline base date and demo latency |
| `SCHEDULED_CHECKS_ENABLED`, `SCHEDULER_SECRET`, `SCHEDULER_BATCH_SIZE` | no | Automatic checks; off by default. See *Automatic checks* |
| `PORTAL_JUST_*`, `AI_*` | no | Must remain `false` until separately approved |

### External service configuration

| Service | Local | Production |
|---|---|---|
| Supabase (DB, Auth, API) | `npx supabase start` (Docker) | Project in an EU region; apply migrations with `supabase db push`; mirror the Auth settings from `supabase/config.jsonc`; set Site URL and redirect URL `https://<domain>/auth/confirm`; upload `supabase/templates/*` |
| Email (Auth emails) | Mailpit (bundled) | Custom SMTP, preferably an EU provider |
| Hosting (Next.js) | `npm run dev` | EU region, HTTPS only, encrypted env store, single instance until rate limiting is shared |
| portal.just.ro | not used | **Not enabled.** Requires separate approval (SECURITY.md) |
| LLM | not used | **Not enabled.** Requires EU processing + DPA + authorization |

## Project layout

```
src/
  proxy.ts                    CSP nonce, session refresh, optimistic auth redirect
  app/(auth)/…                login, signup, forgot/update password, email landing pages
  app/(app)/…                 dashboard, cases, case detail/edit, notifications, settings, profile, onboarding, invite
  app/actions/*               Server Actions (re-verify the session, whitelist inputs)
  app/auth/confirm/route.ts   email token verification
  server/context.ts           verified identity + memberships
  server/dal/*                authorized data access
  server/monitoring/*         provider interface, mock + SOAP stub, normalize, diff, check service
  server/summaries/*          deterministic RO/EN summaries, gated LLM interface
  i18n/                       EN/RO dictionaries, locale cookie, court-term glossary
  lib/                        env, Supabase clients, validation, errors, rate limit, labels
supabase/
  migrations/                 schema, RLS, guards/audit, RPCs, scheduled checks, notifications
  templates/                  Auth email templates
  config.jsonc                local stack configuration (hardened Auth settings)
tests/                        unit, integration (DB/RLS/actions/monitoring), e2e
scripts/                      env:local, seed, secret scan
```

## Disclaimer

DosarIA is a support tool. Summaries are generated from templates based on
published court data and are not legal advice. A lawyer must verify every
deadline. No procedural deadlines are calculated in this version.
