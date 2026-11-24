-- =============================================================================
-- DosarIA — core schema
-- =============================================================================
-- Every tenant-owned table carries organization_id. Child tables reference
-- their parent case through the composite key (organization_id, case_id) so
-- that the database itself rejects any row that pairs one organization with
-- another organization's case.
--
-- Row Level Security, grants and guard triggers are defined in later
-- migrations. Nothing in this file grants access to anyone.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------
create type public.membership_role   as enum ('admin', 'lawyer', 'assistant');
create type public.membership_status as enum ('active', 'suspended', 'removed');
create type public.case_status       as enum ('active', 'closed', 'archived');
create type public.matter_type       as enum (
  'civil', 'commercial', 'labor', 'administrative', 'family',
  'enforcement', 'insolvency', 'criminal', 'other'
);
create type public.check_outcome as enum (
  'never_checked',      -- case has never been checked
  'changes_detected',   -- successful check, at least one new event recorded
  'no_changes',         -- successful check, data identical to last snapshot
  'failed',             -- provider error / invalid response (NOT "no changes")
  'incomplete',         -- provider answered but required data was missing
  'source_unavailable'  -- provider reported the source as unreachable
);
create type public.event_type as enum (
  'monitoring_started',
  'hearing_scheduled',
  'hearing_rescheduled',
  'hearing_postponed',
  'decision_issued',
  'status_changed',
  'stage_changed'
);
create type public.reminder_status as enum ('proposed', 'confirmed', 'completed', 'needs_review');
create type public.reminder_origin as enum ('manual', 'suggested');
create type public.actor_type      as enum ('user', 'system');

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user (created by trigger on auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_email_format check (email = lower(email) and char_length(email) between 3 and 320),
  constraint profiles_full_name_length check (full_name is null or char_length(btrim(full_name)) between 1 and 120)
);

-- ---------------------------------------------------------------------------
-- organizations — one row per law firm (tenant)
-- ---------------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint organizations_name_length check (char_length(btrim(name)) between 2 and 120)
);

-- ---------------------------------------------------------------------------
-- organization_memberships — the ONLY source of truth for roles
-- ---------------------------------------------------------------------------
create table public.organization_memberships (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  role             public.membership_role not null,
  status           public.membership_status not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Referenced by cases(organization_id, assigned_user_id): an assignee must
  -- be a member of the case's own organization.
  constraint organization_memberships_org_user_key unique (organization_id, user_id)
);
create index organization_memberships_user_active_idx
  on public.organization_memberships (user_id, organization_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- organization_invitations — expiring, single-use, email-bound invitations
-- Only a SHA-256 hash of the token is stored; the raw token is shown once.
-- ---------------------------------------------------------------------------
create table public.organization_invitations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  email            text not null,
  role             public.membership_role not null,
  token_hash       text not null,
  invited_by       uuid not null references public.profiles (id) on delete cascade,
  expires_at       timestamptz not null,
  accepted_at      timestamptz,
  accepted_by      uuid references public.profiles (id) on delete set null,
  revoked_at       timestamptz,
  created_at       timestamptz not null default now(),
  constraint organization_invitations_token_hash_key unique (token_hash),
  constraint organization_invitations_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint organization_invitations_email_format check (
    email = lower(btrim(email))
    and char_length(email) between 3 and 320
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  constraint organization_invitations_expiry_window check (
    expires_at > created_at and expires_at <= created_at + interval '7 days'
  ),
  constraint organization_invitations_single_outcome check (
    not (accepted_at is not null and revoked_at is not null)
  ),
  -- accepted_by may later become NULL if the user is deleted, hence one-way.
  constraint organization_invitations_accepted_consistency check (
    accepted_by is null or accepted_at is not null
  )
);
-- At most one pending invitation per email per organization.
create unique index organization_invitations_pending_email_key
  on public.organization_invitations (organization_id, email)
  where accepted_at is null and revoked_at is null;
create index organization_invitations_org_idx on public.organization_invitations (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- cases
-- ---------------------------------------------------------------------------
create table public.cases (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.organizations (id) on delete cascade,
  court_case_number         text not null,
  court_name                text not null,
  title                     text not null,
  matter_type               public.matter_type not null default 'civil',
  status                    public.case_status not null default 'active',
  -- Responsible lawyer (role admin or lawyer) and optional assistant.
  assigned_user_id          uuid,
  assigned_assistant_id     uuid,
  -- Monitoring state: written ONLY by the trusted monitoring process.
  court_status              text,
  last_check_attempt_at     timestamptz,
  last_successful_check_at  timestamptz,
  last_check_outcome        public.check_outcome not null default 'never_checked',
  archived_at               timestamptz,
  created_by                uuid references public.profiles (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  -- Target for composite foreign keys from child tables.
  constraint cases_org_id_key unique (organization_id, id),

  -- Assignees must be members of THIS organization (role/status checked by trigger).
  constraint cases_assigned_user_member_fk
    foreign key (organization_id, assigned_user_id)
    references public.organization_memberships (organization_id, user_id)
    on delete set null (assigned_user_id),
  constraint cases_assigned_assistant_member_fk
    foreign key (organization_id, assigned_assistant_id)
    references public.organization_memberships (organization_id, user_id)
    on delete set null (assigned_assistant_id),

  -- Romanian court file numbers, e.g. 1234/3/2026 or 1234/3/2026/a1
  constraint cases_court_case_number_format check (
    court_case_number ~ '^[0-9]{1,7}/[0-9]{1,5}/[0-9]{4}(/[A-Za-z0-9.*]{1,12}){0,3}$'
  ),
  constraint cases_court_name_length check (char_length(btrim(court_name)) between 2 and 200),
  constraint cases_title_length check (char_length(btrim(title)) between 2 and 300),
  constraint cases_court_status_length check (court_status is null or char_length(court_status) <= 200),
  constraint cases_archived_consistency check ((status = 'archived') = (archived_at is not null)),
  constraint cases_distinct_assignees check (
    assigned_assistant_id is null or assigned_user_id is null or assigned_assistant_id <> assigned_user_id
  )
);
-- No duplicate active monitoring of the same file in one organization.
create unique index cases_org_number_court_key
  on public.cases (organization_id, court_case_number, lower(court_name))
  where status <> 'archived';
create index cases_org_assigned_idx  on public.cases (organization_id, assigned_user_id);
create index cases_org_assistant_idx on public.cases (organization_id, assigned_assistant_id) where assigned_assistant_id is not null;
create index cases_assigned_user_idx on public.cases (assigned_user_id);
create index cases_assistant_user_idx on public.cases (assigned_assistant_id) where assigned_assistant_id is not null;
create index cases_org_updated_idx   on public.cases (organization_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- case_snapshots — normalized provider responses, preserved for audit
-- ---------------------------------------------------------------------------
create table public.case_snapshots (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  case_id           uuid not null,
  provider          text not null,
  source_reference  text,
  fetched_at        timestamptz not null,
  completeness      text not null,
  content_hash      text not null,
  data              jsonb not null,
  created_at        timestamptz not null default now(),
  constraint case_snapshots_case_fk
    foreign key (organization_id, case_id) references public.cases (organization_id, id) on delete cascade,
  constraint case_snapshots_case_id_key unique (case_id, id),
  constraint case_snapshots_provider_format check (provider ~ '^[a-z0-9_-]{1,40}$'),
  constraint case_snapshots_source_reference_length check (source_reference is null or char_length(source_reference) <= 500),
  constraint case_snapshots_completeness_values check (completeness in ('complete', 'incomplete')),
  constraint case_snapshots_content_hash_format check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint case_snapshots_data_size check (pg_column_size(data) <= 262144)
);
create index case_snapshots_case_fetched_idx on public.case_snapshots (case_id, fetched_at desc);
create index case_snapshots_org_idx on public.case_snapshots (organization_id);

-- ---------------------------------------------------------------------------
-- case_events — detected, deduplicated court updates
-- ---------------------------------------------------------------------------
create table public.case_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  case_id          uuid not null,
  snapshot_id      uuid,
  event_type       public.event_type not null,
  -- Canonical SHA-256 of the event's identifying content; deduplicates events.
  event_key        text not null,
  occurred_on      date,
  details          jsonb not null default '{}'::jsonb,
  summary_ro       text not null,
  summary_en       text,
  summary_source   text not null,
  requires_review  boolean not null default false,
  detected_at      timestamptz not null default now(),
  constraint case_events_case_fk
    foreign key (organization_id, case_id) references public.cases (organization_id, id) on delete cascade,
  constraint case_events_snapshot_fk
    foreign key (case_id, snapshot_id) references public.case_snapshots (case_id, id) on delete set null (snapshot_id),
  constraint case_events_case_key unique (case_id, event_key),
  constraint case_events_case_id_key unique (case_id, id),
  constraint case_events_event_key_format check (event_key ~ '^[0-9a-f]{64}$'),
  constraint case_events_summary_ro_length check (char_length(summary_ro) between 1 and 2000),
  constraint case_events_summary_en_length check (summary_en is null or char_length(summary_en) <= 2000),
  constraint case_events_summary_source_values check (summary_source in ('deterministic_template', 'llm')),
  constraint case_events_details_size check (pg_column_size(details) <= 16384)
);
create index case_events_case_detected_idx on public.case_events (case_id, detected_at desc);
create index case_events_org_detected_idx  on public.case_events (organization_id, detected_at desc);

-- ---------------------------------------------------------------------------
-- deadline_reminders — manually managed; confirmation is a human act
-- ---------------------------------------------------------------------------
create table public.deadline_reminders (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  case_id          uuid not null,
  source_event_id  uuid,
  title            text not null,
  description      text,
  due_date         date not null,
  origin           public.reminder_origin not null default 'manual',
  status           public.reminder_status not null default 'proposed',
  created_by       uuid references public.profiles (id) on delete set null,
  confirmed_by     uuid references public.profiles (id) on delete set null,
  confirmed_at     timestamptz,
  completed_by     uuid references public.profiles (id) on delete set null,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint deadline_reminders_case_fk
    foreign key (organization_id, case_id) references public.cases (organization_id, id) on delete cascade,
  -- A reminder can only cite an event of the SAME case.
  constraint deadline_reminders_event_fk
    foreign key (case_id, source_event_id) references public.case_events (case_id, id) on delete set null (source_event_id),
  constraint deadline_reminders_title_length check (char_length(btrim(title)) between 2 and 200),
  constraint deadline_reminders_description_length check (description is null or char_length(description) <= 2000),
  constraint deadline_reminders_due_date_range check (due_date between date '2000-01-01' and date '2100-12-31'),
  constraint deadline_reminders_confirmed_consistency check (
    status not in ('confirmed', 'completed') or confirmed_at is not null
  ),
  constraint deadline_reminders_completed_consistency check ((status = 'completed') = (completed_at is not null))
);
create index deadline_reminders_org_status_due_idx on public.deadline_reminders (organization_id, status, due_date);
create index deadline_reminders_case_due_idx       on public.deadline_reminders (case_id, due_date);

-- ---------------------------------------------------------------------------
-- monitoring_runs — every check attempt, including failures
-- ---------------------------------------------------------------------------
create table public.monitoring_runs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  case_id          uuid not null,
  triggered_by     uuid references public.profiles (id) on delete set null,
  trigger_type     text not null,
  provider         text not null,
  started_at       timestamptz not null,
  finished_at      timestamptz not null,
  outcome          public.check_outcome not null,
  events_created   integer not null default 0,
  snapshot_id      uuid,
  error_code       text,
  created_at       timestamptz not null default now(),
  constraint monitoring_runs_case_fk
    foreign key (organization_id, case_id) references public.cases (organization_id, id) on delete cascade,
  constraint monitoring_runs_snapshot_fk
    foreign key (case_id, snapshot_id) references public.case_snapshots (case_id, id) on delete set null (snapshot_id),
  constraint monitoring_runs_trigger_type_values check (trigger_type in ('manual', 'scheduled')),
  constraint monitoring_runs_provider_format check (provider ~ '^[a-z0-9_-]{1,40}$'),
  constraint monitoring_runs_outcome_not_never check (outcome <> 'never_checked'),
  constraint monitoring_runs_events_nonnegative check (events_created >= 0),
  constraint monitoring_runs_error_code_format check (error_code is null or error_code ~ '^[a-z0-9_]{1,64}$'),
  constraint monitoring_runs_time_order check (finished_at >= started_at)
);
create index monitoring_runs_case_started_idx on public.monitoring_runs (case_id, started_at desc);
create index monitoring_runs_org_started_idx  on public.monitoring_runs (organization_id, started_at desc);

-- ---------------------------------------------------------------------------
-- audit_logs — append-only (see guard trigger); minimal metadata only
-- organization_id is NULL only for platform-level security events that cannot
-- be attributed to a tenant (e.g. an access attempt on an unknown resource).
-- actor_user_id intentionally has no FK so audit history survives user deletion.
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id               bigint generated always as identity primary key,
  organization_id  uuid references public.organizations (id) on delete cascade,
  actor_type       public.actor_type not null,
  actor_user_id    uuid,
  action           text not null,
  resource_type    text not null,
  resource_id      uuid,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  constraint audit_logs_action_format check (action ~ '^[a-z_]+(\.[a-z_]+)+$' and char_length(action) <= 80),
  constraint audit_logs_resource_type_format check (resource_type ~ '^[a-z_]{1,40}$'),
  constraint audit_logs_metadata_size check (pg_column_size(metadata) <= 4096),
  constraint audit_logs_user_actor check (actor_type = 'system' or actor_user_id is not null)
);
create index audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_resource_idx    on public.audit_logs (resource_type, resource_id);
