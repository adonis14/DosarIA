-- =============================================================================
-- DosarIA — authorization helpers, privileges and Row Level Security
-- =============================================================================
-- Design rules
--  * Deny by default: every table has RLS enabled, and every privilege for
--    anon/authenticated is revoked, then re-granted per column. RLS is not
--    FORCED: the table owner (used only by migrations and the audited
--    SECURITY DEFINER helpers below) must be able to evaluate membership
--    without recursing into these same policies.
--  * Identity comes only from auth.uid() (the verified JWT `sub`), never from
--    a client-supplied parameter. Roles come only from organization_memberships,
--    never from JWT/user metadata.
--  * SECURITY DEFINER helpers live in the `private` schema, which is NOT in
--    the PostgREST exposed schemas. They take no user id parameter, so they
--    can only ever answer questions about the *calling* user.
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- New functions in `private` must never be executable by PUBLIC implicitly.
alter default privileges in schema private revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- Is the current database role a trusted/privileged role?
-- SECURITY INVOKER on purpose: current_user is the *calling* role here.
-- (Inside a SECURITY DEFINER function current_user is the owner — those
-- functions perform their own explicit checks.)
-- ---------------------------------------------------------------------------
create or replace function private.is_privileged_role()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select current_user in ('service_role', 'postgres', 'supabase_admin');
$$;

-- ---------------------------------------------------------------------------
-- Membership helpers (SECURITY DEFINER to avoid recursive RLS evaluation on
-- organization_memberships). All are scoped to auth.uid().
-- ---------------------------------------------------------------------------
create or replace function private.member_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id
  from public.organization_memberships m
  where m.user_id = (select auth.uid())
    and m.status = 'active';
$$;

create or replace function private.admin_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id
  from public.organization_memberships m
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.role = 'admin';
$$;

-- Organizations where the caller may create cases (admin or lawyer).
create or replace function private.case_creator_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id
  from public.organization_memberships m
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.role in ('admin', 'lawyer');
$$;

create or replace function private.active_role(p_organization_id uuid)
returns public.membership_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.organization_memberships m
  where m.organization_id = p_organization_id
    and m.user_id = (select auth.uid())
    and m.status = 'active';
$$;

create or replace function private.is_org_admin(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = 'admin'
  );
$$;

-- Cases the caller may READ: all cases in orgs where they are admin, plus
-- cases explicitly assigned to them (as lawyer or assistant) in orgs where
-- they are an ACTIVE member.
create or replace function private.readable_case_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.cases c
  join public.organization_memberships m
    on m.organization_id = c.organization_id
   and m.user_id = (select auth.uid())
   and m.status = 'active'
  where m.role = 'admin'
     or c.assigned_user_id = m.user_id
     or c.assigned_assistant_id = m.user_id;
$$;

-- Cases the caller may WRITE child records for (reminders): admins of the
-- org, or the assigned lawyer. Assistants are read-only.
create or replace function private.writable_case_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.cases c
  join public.organization_memberships m
    on m.organization_id = c.organization_id
   and m.user_id = (select auth.uid())
   and m.status = 'active'
  where m.role = 'admin'
     or (m.role = 'lawyer' and c.assigned_user_id = m.user_id);
$$;

-- Does the given profile share any organization with the caller?
-- Returns only a boolean; reveals nothing beyond what the caller could
-- already see in the membership list of their own organizations.
create or replace function private.shares_org_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships mine
    join public.organization_memberships theirs
      on theirs.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid())
      and mine.status = 'active'
      and theirs.user_id = p_user_id
  );
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on function
  private.is_privileged_role(),
  private.member_org_ids(),
  private.admin_org_ids(),
  private.case_creator_org_ids(),
  private.active_role(uuid),
  private.is_org_admin(uuid),
  private.readable_case_ids(),
  private.writable_case_ids(),
  private.shares_org_with(uuid)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Table privileges: revoke everything Supabase grants by default, then grant
-- the minimum, column by column where writes are allowed.
-- ---------------------------------------------------------------------------
revoke all on table
  public.profiles,
  public.organizations,
  public.organization_memberships,
  public.organization_invitations,
  public.cases,
  public.case_snapshots,
  public.case_events,
  public.deadline_reminders,
  public.monitoring_runs,
  public.audit_logs
from anon, authenticated;

-- profiles: read (RLS-filtered), update own display name only.
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

-- organizations: read (members), rename (admins). Creation only via RPC.
grant select on public.organizations to authenticated;
grant update (name) on public.organizations to authenticated;

-- memberships: read; admins may change role/status only. No INSERT/DELETE:
-- memberships are created by create_organization() / accept_invitation().
grant select on public.organization_memberships to authenticated;
grant update (role, status) on public.organization_memberships to authenticated;

-- invitations: admins create and revoke.
grant select on public.organization_invitations to authenticated;
grant insert (organization_id, email, role, token_hash, invited_by, expires_at)
  on public.organization_invitations to authenticated;
grant update (revoked_at) on public.organization_invitations to authenticated;

-- cases: no grant at all on organization_id/created_by/monitoring columns for UPDATE.
grant select on public.cases to authenticated;
grant insert (organization_id, court_case_number, court_name, title, matter_type,
              assigned_user_id, assigned_assistant_id, created_by)
  on public.cases to authenticated;
grant update (court_case_number, court_name, title, matter_type, status,
              assigned_user_id, assigned_assistant_id)
  on public.cases to authenticated;

-- monitoring artefacts: read-only for users; written by the trusted process.
grant select on public.case_snapshots  to authenticated;
grant select on public.case_events     to authenticated;
grant select on public.monitoring_runs to authenticated;

-- reminders
grant select on public.deadline_reminders to authenticated;
grant insert (organization_id, case_id, source_event_id, title, description, due_date, created_by)
  on public.deadline_reminders to authenticated;
grant update (title, description, due_date, status) on public.deadline_reminders to authenticated;
grant delete on public.deadline_reminders to authenticated;

-- audit logs: admins read their org's history. Nobody but the table owner may
-- UPDATE/DELETE — not even service_role.
grant select on public.audit_logs to authenticated;
revoke update, delete, truncate on public.audit_logs from service_role;

-- ---------------------------------------------------------------------------
-- Enable Row Level Security on every table (no policy = no access).
-- ---------------------------------------------------------------------------
alter table public.profiles                 enable row level security;
alter table public.organizations            enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.cases                    enable row level security;
alter table public.case_snapshots           enable row level security;
alter table public.case_events              enable row level security;
alter table public.deadline_reminders       enable row level security;
alter table public.monitoring_runs          enable row level security;
alter table public.audit_logs               enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy profiles_select_self_or_colleague on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_org_with(id));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
create policy organizations_select_member on public.organizations
  for select to authenticated
  using (id in (select private.member_org_ids()));

create policy organizations_update_admin on public.organizations
  for update to authenticated
  using (id in (select private.admin_org_ids()))
  with check (id in (select private.admin_org_ids()));

-- ---------------------------------------------------------------------------
-- organization_memberships
-- ---------------------------------------------------------------------------
create policy memberships_select_own_or_same_org on public.organization_memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or organization_id in (select private.member_org_ids())
  );

-- Admins may update other members of their organization. Self-modification
-- and last-admin removal are blocked by trigger (see guards migration).
create policy memberships_update_admin on public.organization_memberships
  for update to authenticated
  using (organization_id in (select private.admin_org_ids()))
  with check (organization_id in (select private.admin_org_ids()));

-- ---------------------------------------------------------------------------
-- organization_invitations
-- ---------------------------------------------------------------------------
create policy invitations_select_admin on public.organization_invitations
  for select to authenticated
  using (organization_id in (select private.admin_org_ids()));

create policy invitations_insert_admin on public.organization_invitations
  for insert to authenticated
  with check (
    organization_id in (select private.admin_org_ids())
    and invited_by = (select auth.uid())
  );

create policy invitations_update_admin on public.organization_invitations
  for update to authenticated
  using (organization_id in (select private.admin_org_ids()))
  with check (organization_id in (select private.admin_org_ids()));

-- ---------------------------------------------------------------------------
-- cases
-- ---------------------------------------------------------------------------
create policy cases_select_authorized on public.cases
  for select to authenticated
  using (
    organization_id in (select private.admin_org_ids())
    or (
      (assigned_user_id = (select auth.uid()) or assigned_assistant_id = (select auth.uid()))
      and organization_id in (select private.member_org_ids())
    )
  );

-- Admins may create any case in their org. Lawyers may only create cases
-- assigned to themselves, with no assistant (assignment is admin-only).
create policy cases_insert_admin_or_self_assigned_lawyer on public.cases
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      organization_id in (select private.admin_org_ids())
      or (
        organization_id in (select private.case_creator_org_ids())
        and assigned_user_id = (select auth.uid())
        and assigned_assistant_id is null
      )
    )
  );

-- Admins may update any case in their org; lawyers only cases assigned to
-- them, and the NEW row must still be assigned to them (no hand-off).
create policy cases_update_admin_or_assigned_lawyer on public.cases
  for update to authenticated
  using (
    organization_id in (select private.admin_org_ids())
    or (
      assigned_user_id = (select auth.uid())
      and organization_id in (select private.case_creator_org_ids())
    )
  )
  with check (
    organization_id in (select private.admin_org_ids())
    or (
      assigned_user_id = (select auth.uid())
      and organization_id in (select private.case_creator_org_ids())
    )
  );
-- No DELETE policy: cases are archived, never deleted by users.

-- ---------------------------------------------------------------------------
-- Child records inherit the parent case's read restrictions.
-- ---------------------------------------------------------------------------
create policy case_snapshots_select_authorized on public.case_snapshots
  for select to authenticated
  using (case_id in (select private.readable_case_ids()));

create policy case_events_select_authorized on public.case_events
  for select to authenticated
  using (case_id in (select private.readable_case_ids()));

create policy monitoring_runs_select_authorized on public.monitoring_runs
  for select to authenticated
  using (case_id in (select private.readable_case_ids()));

-- ---------------------------------------------------------------------------
-- deadline_reminders
-- ---------------------------------------------------------------------------
create policy reminders_select_authorized on public.deadline_reminders
  for select to authenticated
  using (case_id in (select private.readable_case_ids()));

create policy reminders_insert_case_writer on public.deadline_reminders
  for insert to authenticated
  with check (
    case_id in (select private.writable_case_ids())
    and created_by = (select auth.uid())
  );

create policy reminders_update_case_writer on public.deadline_reminders
  for update to authenticated
  using (case_id in (select private.writable_case_ids()))
  with check (case_id in (select private.writable_case_ids()));

-- Only unconfirmed proposals may be deleted; confirmed history is kept.
create policy reminders_delete_proposed_by_case_writer on public.deadline_reminders
  for delete to authenticated
  using (
    case_id in (select private.writable_case_ids())
    and status in ('proposed', 'needs_review')
  );

-- ---------------------------------------------------------------------------
-- audit_logs
-- ---------------------------------------------------------------------------
create policy audit_logs_select_admin on public.audit_logs
  for select to authenticated
  using (organization_id in (select private.admin_org_ids()));
