-- =============================================================================
-- DosarIA — privileged operations exposed as RPC
-- =============================================================================
-- Pattern: the SECURITY DEFINER implementation lives in the unexposed
-- `private` schema; `public` only contains a thin SECURITY INVOKER wrapper so
-- that PostgREST can route the call. Every implementation:
--   * derives the caller from auth.uid() (never from a parameter),
--   * fully qualifies every relation, with search_path = '',
--   * validates every target resource explicitly.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- create_organization(name) — caller becomes the first admin.
-- ---------------------------------------------------------------------------
create or replace function private.create_organization(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_name      text := btrim(coalesce(p_name, ''));
  v_confirmed timestamptz;
  v_org_id    uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select u.email_confirmed_at into v_confirmed from auth.users u where u.id = v_uid;
  if v_confirmed is null then
    raise exception 'email address not verified' using errcode = '42501';
  end if;

  -- Abuse limit: a single account may found at most 3 organizations.
  if (select count(*) from public.organizations o where o.created_by = v_uid) >= 3 then
    raise exception 'organization limit reached' using errcode = '54000';
  end if;

  insert into public.organizations (name, created_by)
  values (v_name, v_uid)
  returning id into v_org_id;

  insert into public.organization_memberships (organization_id, user_id, role, status)
  values (v_org_id, v_uid, 'admin', 'active');

  return v_org_id;
end;
$$;

create or replace function public.create_organization(p_name text)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_organization(p_name);
$$;

-- ---------------------------------------------------------------------------
-- accept_invitation(token) — the token is single use, expiring, and bound to
-- the invitee's VERIFIED email address.
-- ---------------------------------------------------------------------------
create or replace function private.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_inv       public.organization_invitations%rowtype;
  v_email     text;
  v_confirmed timestamptz;
  v_existing  public.organization_memberships%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'invalid or expired invitation' using errcode = '22023';
  end if;

  select i.* into v_inv
  from public.organization_invitations i
  where i.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  for update;

  if not found
     or v_inv.accepted_at is not null
     or v_inv.revoked_at is not null
     or v_inv.expires_at <= now() then
    raise exception 'invalid or expired invitation' using errcode = '22023';
  end if;

  select lower(u.email), u.email_confirmed_at
    into v_email, v_confirmed
  from auth.users u where u.id = v_uid;

  if v_confirmed is null then
    raise exception 'email address not verified' using errcode = '42501';
  end if;
  if v_email is distinct from v_inv.email then
    raise exception 'invitation was issued for a different email address' using errcode = '42501';
  end if;

  select m.* into v_existing
  from public.organization_memberships m
  where m.organization_id = v_inv.organization_id and m.user_id = v_uid
  for update;

  if found then
    if v_existing.status <> 'removed' then
      raise exception 'already a member of this organization' using errcode = '23505';
    end if;
    update public.organization_memberships
       set role = v_inv.role, status = 'active'
     where id = v_existing.id;
  else
    insert into public.organization_memberships (organization_id, user_id, role, status)
    values (v_inv.organization_id, v_uid, v_inv.role, 'active');
  end if;

  update public.organization_invitations
     set accepted_at = now(), accepted_by = v_uid
   where id = v_inv.id;

  return v_inv.organization_id;
end;
$$;

create or replace function public.accept_invitation(p_token text)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.accept_invitation(p_token);
$$;

-- ---------------------------------------------------------------------------
-- record_monitoring_run — the ONLY write path for snapshots, events and
-- monitoring state. Executable by service_role only. Runs as the caller
-- (SECURITY INVOKER) and re-validates that the case belongs to the given
-- organization and that the triggering user is an active member.
-- All writes happen in one transaction.
-- ---------------------------------------------------------------------------
create or replace function public.record_monitoring_run(
  p_case_id          uuid,
  p_organization_id  uuid,
  p_triggered_by     uuid,
  p_trigger_type     text,
  p_provider         text,
  p_started_at       timestamptz,
  p_finished_at      timestamptz,
  p_outcome          public.check_outcome,
  p_error_code       text default null,
  p_court_status     text default null,
  p_snapshot         jsonb default null,
  p_events           jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_outcome         public.check_outcome := p_outcome;
  v_successful      boolean;
  v_snapshot_id     uuid;
  v_event           jsonb;
  v_event_id        uuid;
  v_events_created  integer := 0;
  v_run_id          uuid;
  v_prev_date       date;
begin
  if not private.is_privileged_role() then
    raise exception 'privileged operation' using errcode = '42501';
  end if;

  perform 1 from public.cases c
   where c.id = p_case_id and c.organization_id = p_organization_id
   for update;
  if not found then
    raise exception 'case not found in organization' using errcode = 'P0002';
  end if;

  if p_triggered_by is not null and not exists (
    select 1 from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = p_triggered_by
      and m.status = 'active'
  ) then
    raise exception 'triggering user is not an active member of the organization' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_events, '[]'::jsonb)) <> 'array' then
    raise exception 'p_events must be an array' using errcode = '22023';
  end if;
  if p_outcome <> 'changes_detected' and jsonb_array_length(coalesce(p_events, '[]'::jsonb)) > 0 then
    raise exception 'events may only be recorded for changes_detected' using errcode = '22023';
  end if;
  if p_snapshot is not null and p_outcome in ('failed', 'source_unavailable') then
    raise exception 'a failed run cannot store a snapshot' using errcode = '22023';
  end if;

  if p_snapshot is not null then
    insert into public.case_snapshots (
      organization_id, case_id, provider, source_reference, fetched_at,
      completeness, content_hash, data)
    values (
      p_organization_id, p_case_id, p_provider,
      p_snapshot ->> 'source_reference',
      (p_snapshot ->> 'fetched_at')::timestamptz,
      p_snapshot ->> 'completeness',
      p_snapshot ->> 'content_hash',
      p_snapshot -> 'data')
    returning id into v_snapshot_id;
  end if;

  for v_event in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    v_event_id := null;
    insert into public.case_events (
      organization_id, case_id, snapshot_id, event_type, event_key, occurred_on,
      details, summary_ro, summary_en, summary_source, requires_review)
    values (
      p_organization_id, p_case_id, v_snapshot_id,
      (v_event ->> 'event_type')::public.event_type,
      v_event ->> 'event_key',
      (v_event ->> 'occurred_on')::date,
      coalesce(v_event -> 'details', '{}'::jsonb),
      v_event ->> 'summary_ro',
      v_event ->> 'summary_en',
      v_event ->> 'summary_source',
      coalesce((v_event ->> 'requires_review')::boolean, false))
    on conflict (case_id, event_key) do nothing
    returning id into v_event_id;

    if v_event_id is null then
      continue;  -- duplicate event, already recorded
    end if;
    v_events_created := v_events_created + 1;

    -- A hearing moved: reminders pinned to the old date need human review.
    if (v_event ->> 'event_type') in ('hearing_rescheduled', 'hearing_postponed')
       and (v_event -> 'details' ->> 'previous_date') is not null then
      v_prev_date := (v_event -> 'details' ->> 'previous_date')::date;
      update public.deadline_reminders r
         set status = 'needs_review'
       where r.case_id = p_case_id
         and r.organization_id = p_organization_id
         and r.due_date = v_prev_date
         and r.status in ('proposed', 'confirmed');
    end if;

    -- Optional suggestion (e.g. a new hearing date). Always 'suggested' and
    -- 'proposed': it is never a confirmed legal deadline.
    if v_event ? 'suggested_reminder' then
      insert into public.deadline_reminders (
        organization_id, case_id, source_event_id, title, description, due_date,
        origin, status, created_by)
      values (
        p_organization_id, p_case_id, v_event_id,
        v_event -> 'suggested_reminder' ->> 'title',
        v_event -> 'suggested_reminder' ->> 'description',
        (v_event -> 'suggested_reminder' ->> 'due_date')::date,
        'suggested', 'proposed', null);
    end if;
  end loop;

  -- Everything detected was already known: that is "no changes".
  if v_outcome = 'changes_detected' and v_events_created = 0 then
    v_outcome := 'no_changes';
  end if;
  v_successful := v_outcome in ('changes_detected', 'no_changes');

  insert into public.monitoring_runs (
    organization_id, case_id, triggered_by, trigger_type, provider, started_at,
    finished_at, outcome, events_created, snapshot_id, error_code)
  values (
    p_organization_id, p_case_id, p_triggered_by, p_trigger_type, p_provider, p_started_at,
    p_finished_at, v_outcome, v_events_created, v_snapshot_id, p_error_code)
  returning id into v_run_id;

  update public.cases c
     set last_check_attempt_at    = p_finished_at,
         last_check_outcome       = v_outcome,
         last_successful_check_at = case when v_successful then p_finished_at else c.last_successful_check_at end,
         court_status             = case when v_successful and p_court_status is not null
                                         then left(p_court_status, 200) else c.court_status end
   where c.id = p_case_id and c.organization_id = p_organization_id;

  perform private.write_audit(p_organization_id, 'monitoring.run_completed', 'case', p_case_id,
    jsonb_build_object(
      'run_id', v_run_id,
      'outcome', v_outcome,
      'events_created', v_events_created,
      'triggered_by', p_triggered_by,
      'error_code', p_error_code));

  return jsonb_build_object(
    'run_id', v_run_id,
    'outcome', v_outcome,
    'events_created', v_events_created,
    'snapshot_id', v_snapshot_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- GDPR: organization-scoped export (service_role only) and purge (owner only)
-- ---------------------------------------------------------------------------
create or replace function private.export_organization(p_organization_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'format', 'dosaria-export-v1',
    'exported_at', now(),
    'organization', (select to_jsonb(o) from public.organizations o where o.id = p_organization_id),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'email', p.email, 'full_name', p.full_name,
        'role', m.role, 'status', m.status, 'created_at', m.created_at))
      from public.organization_memberships m join public.profiles p on p.id = m.user_id
      where m.organization_id = p_organization_id), '[]'::jsonb),
    'cases', coalesce((select jsonb_agg(to_jsonb(c)) from public.cases c
      where c.organization_id = p_organization_id), '[]'::jsonb),
    'case_snapshots', coalesce((select jsonb_agg(to_jsonb(s)) from public.case_snapshots s
      where s.organization_id = p_organization_id), '[]'::jsonb),
    'case_events', coalesce((select jsonb_agg(to_jsonb(e)) from public.case_events e
      where e.organization_id = p_organization_id), '[]'::jsonb),
    'deadline_reminders', coalesce((select jsonb_agg(to_jsonb(r)) from public.deadline_reminders r
      where r.organization_id = p_organization_id), '[]'::jsonb),
    'monitoring_runs', coalesce((select jsonb_agg(to_jsonb(r)) from public.monitoring_runs r
      where r.organization_id = p_organization_id), '[]'::jsonb),
    'audit_logs', coalesce((select jsonb_agg(to_jsonb(a)) from public.audit_logs a
      where a.organization_id = p_organization_id), '[]'::jsonb)
  );
$$;

-- Irreversible. Requires the confirmation phrase 'DELETE <organization uuid>'.
-- Not granted to any API role: run by an operator as the database owner after
-- a verified, documented deletion request (see SECURITY.md).
create or replace function private.purge_organization(p_organization_id uuid, p_confirmation text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_confirmation is distinct from ('DELETE ' || p_organization_id::text) then
    raise exception 'confirmation phrase mismatch' using errcode = '22023';
  end if;
  perform set_config('dosaria.allow_audit_purge', 'on', true);

  delete from public.deadline_reminders       where organization_id = p_organization_id;
  delete from public.case_events              where organization_id = p_organization_id;
  delete from public.monitoring_runs          where organization_id = p_organization_id;
  delete from public.case_snapshots           where organization_id = p_organization_id;
  delete from public.cases                    where organization_id = p_organization_id;
  delete from public.organization_invitations where organization_id = p_organization_id;
  delete from public.organization_memberships where organization_id = p_organization_id;
  delete from public.audit_logs               where organization_id = p_organization_id;
  delete from public.organizations            where id = p_organization_id;

  perform set_config('dosaria.allow_audit_purge', 'off', true);

  insert into public.audit_logs (organization_id, actor_type, action, resource_type, resource_id, metadata)
  values (null, 'system', 'organization.purged', 'organization', p_organization_id, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges (Supabase grants EXECUTE on public functions to anon
-- and authenticated by default — revoke explicitly).
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated;

-- RLS/guard helpers needed by authenticated requests (re-grant after the revoke above).
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

grant execute on function private.create_organization(text) to authenticated;
grant execute on function private.accept_invitation(text)   to authenticated;
grant execute on function private.write_audit(uuid, text, text, uuid, jsonb) to service_role;
grant execute on function private.export_organization(uuid) to service_role;
-- private.purge_organization: intentionally no grant (owner only).

revoke execute on function public.create_organization(text) from public, anon;
grant  execute on function public.create_organization(text) to authenticated;

revoke execute on function public.accept_invitation(text) from public, anon;
grant  execute on function public.accept_invitation(text) to authenticated;

revoke execute on function public.record_monitoring_run(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, public.check_outcome, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_monitoring_run(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, public.check_outcome, text, text, jsonb, jsonb)
  to service_role;
