# Private staging deployment plan (EU, synthetic data, restricted access)

Purpose: a **controlled technical demonstration** environment that mirrors
production configuration closely enough to validate security, without any
real client data.

**Status: plan only. Nothing has been deployed.**

## 1. Non-negotiable constraints

1. **Synthetic data only.** No real client files, names or case numbers.
   `COURT_DATA_PROVIDER=mock`. The portal provider stays disabled
   (`PORTAL_JUST_INTEGRATION_APPROVED=false`).
2. **EU hosting** for the database, auth, app runtime, logs and backups.
3. **Restricted access**: only named people. Not indexable, not publicly
   signable.
4. **Separate project and secrets**: nothing is shared with local, demo or
   future production environments.
5. Every deployment runs the full test gate (§6) first.

## 2. Target architecture

```
Named users ──HTTPS──▶ Access gate (SSO/MFA allow-list)
                        │
                        ▼
              Next.js container (EU region, 1 instance)
                        │  server-only secrets
                        ▼
              Supabase project "dosaria-staging" (eu-central-1, Frankfurt)
              Postgres + Auth + PostgREST (Storage/Realtime/Edge disabled)
                        │
              EU SMTP provider (auth emails only)
```

| Component | Recommendation | Why |
|---|---|---|
| Database / Auth | Supabase, new project `dosaria-staging`, region **eu-central-1** | Same stack as local; region chosen at creation and immutable |
| App runtime | An EU-headquartered container host: **Scaleway** (Paris), **Hetzner Cloud** (Germany/Finland), or **OVHcloud** (France). A single instance, Node 22, `next start` behind the platform's TLS. | Keeps the runtime and logs in the EU under EU-incorporated providers. A single instance is required while rate limiting is in-memory. |
| Alternative runtime | Vercel with functions pinned to `fra1` | Workable for synthetic staging, but parts of the control plane and logs are US-based. Decide before production. |
| Access gate | Cloudflare Access / Zero Trust (email allow-list + IdP MFA), **or** a WireGuard/Tailscale-only network, **or** the platform's IP allow-list plus basic auth | Defence in front of the app's own auth. Pick one and document the choice. |
| Email | EU transactional provider (e.g. Brevo/Mailjet, FR) via Supabase custom SMTP | Verification and reset emails |
| Error tracking (optional) | Sentry **EU region** with PII scrubbing, or none | No request bodies; no case content |

## 3. Supabase project setup (staging)

1. Create the project `dosaria-staging` in **eu-central-1**, using a strong
   database password stored in the team password manager.
2. Apply the schema from CI only:
   `npx supabase link --project-ref <ref>` then `npx supabase db push`.
   Never run `db reset` against a remote project.
3. Run `npx supabase db advisors --remote --fail-on warn` and
   `npx supabase db lint --linked`. Both must be clean; locally they report 0
   security findings.
4. **Auth settings**, mirroring `supabase/config.jsonc`:
   - **Disable public sign-up** (`enable_signup = false`). Staging users are
     created by an admin.
   - Email confirmations on, secure password change on, minimum length 12
     with mixed case and digits.
   - Site URL `https://staging.<domain>`; redirect allow-list
     `https://staging.<domain>/auth/confirm` only.
   - Upload `supabase/templates/confirmation.html` and `recovery.html`.
   - Custom SMTP (EU) and conservative auth rate limits.
   - Enable **TOTP MFA**, and require it for admins (application work: see the roadmap).
5. Disable Storage, Realtime and Edge Functions. Confirm the Data API exposes
   only `public` and `graphql_public`.
6. **Network restrictions** for direct Postgres access: allow only CI egress
   IPs. Turn on SSL enforcement.
7. Backups: the default daily backups are enough for synthetic data. Note the
   restore procedure, and rehearse it once before any pilot.

## 4. Application configuration (staging)

Set the following in the host's **encrypted secret store**. There must be no
`.env` file on the server.

| Variable | Value |
|---|---|
| `APP_URL` | `https://staging.<domain>` |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | project publishable key |
| `SUPABASE_SECRET_KEY` | project secret key (**server-only**; never a `NEXT_PUBLIC_*` variable) |
| `COURT_DATA_PROVIDER` | `mock` |
| `PORTAL_JUST_INTEGRATION_APPROVED` | `false` |
| `AI_PROVIDER_ENABLED` / `AI_EU_PROCESSING_VERIFIED` / `AI_DPA_SIGNED` | `false` |
| `NODE_ENV` | `production` (the env validator then *requires* https URLs) |

Platform requirements:
- TLS termination with HSTS. Forward `X-Forwarded-Proto: https`; the CSP's
  `upgrade-insecure-requests` keys off it.
- The proxy **overwrites** `X-Forwarded-For`, because the login rate limiter
  reads it. A client-supplied value must never pass through.
- Request bodies must not be logged. Log retention: 14–30 days.
- One instance only, until rate limiting moves to a shared store.

Container build (to be added in the staging work package; not yet in the repo):
```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
USER node
COPY --from=build --chown=node:node /app ./
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
```
(Consider `output: "standalone"` for a smaller image. That is a `next.config.ts`
change, and needs re-running the E2E gate.)

## 5. Synthetic data and accounts

- Create the demo firms and users with a **staging variant of the seed
  script**. The current `scripts/seed.ts` intentionally refuses any non-local
  URL. Add an explicit `--target staging --project-ref <ref>` confirmation
  rather than removing the guard.
- Use only `@example.com`-style synthetic users. Real people get their own
  accounts, created by an admin invitation, with MFA.
- Recommended mock case numbers for the demo, including the failure
  scenarios: `1234/3/2026`, `2468/299/2026`, and `9999/3/2026` (unavailable).
- Data handling: the environment may be wiped and re-seeded at any time. No
  exports leave the environment.

## 6. CI/CD gate (GitHub Actions or equivalent)

Pull requests to `develop` run all of the following, and every step must pass:
1. `npm ci`, `npm run typecheck`, `npm run lint`
2. `npm run test:unit`
3. `npx supabase start` (CI Docker), `npm run env:local`, `npm run test:integration`
4. `npx playwright install --with-deps chromium`, `npm run test:e2e`
5. `npm run audit:deps` (production deps: 0 vulnerabilities), `npm run scan:secrets`, plus **gitleaks** on the full history
6. `npx supabase db advisors --fail-on warn` against the CI database

Deploying to staging (merge to `develop`, with a **manual approval**):
- `supabase db push` (migrations)
- build and deploy the container
- smoke test: `/login` returns 200 with the CSP header; anonymous `/cases`
  redirects to `/login`

`npm run test:portal-live` is **never** part of CI.

## 7. Access control matrix (staging)

| Who | Access path | App role |
|---|---|---|
| Agora engineers (named) | Access gate + Supabase dashboard (MFA) | Admin of the synthetic firms as needed |
| Pilot-firm evaluators (named, invited) | Access gate (email allow-list) | Lawyer / assistant in a synthetic firm |
| Anyone else | Blocked at the gate | — |

Review the allow-list after every demo, and remove evaluators within 7 days.

## 8. Go / no-go checklist for the demonstration

- [ ] Project in eu-central-1; app region EU; SMTP EU. Locations recorded.
- [ ] Sign-up disabled; access gate active; MFA on for all admins.
- [ ] Advisors and lint clean on the remote; full CI gate green on the deployed commit.
- [ ] `COURT_DATA_PROVIDER=mock`, portal and AI flags `false` (screenshot of the config).
- [ ] Only synthetic data present (query the DB and confirm `@example.com` users only).
- [ ] Secrets only in the host secret store; rotated from any value ever shared in chat.
- [ ] Demo script rehearsed; rollback = redeploy the previous tag.
- [ ] Teardown or retention decision recorded for after the demo.

## 9. Estimated effort

| Work package | Effort |
|---|---|
| Supabase project and auth configuration | 0.5 day |
| Container build, host and access gate | 1–1.5 days |
| CI pipeline (including Supabase in CI) | 1 day |
| Staging seed variant and demo script | 0.5 day |
| Security review of the deployed environment (headers, auth flows, advisors) | 0.5 day |
