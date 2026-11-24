-- =============================================================================
-- DosarIA — integrity guards and audit trail
-- =============================================================================
-- Guard triggers are a second layer behind column grants and RLS. They are
-- SECURITY INVOKER so that `current_user` is the role that issued the
-- statement (authenticated vs. service_role) and so that their own lookups
-- remain subject to RLS.
-- Audit triggers are SECURITY DEFINER because ordinary users have no INSERT
-- privilege on audit_logs.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.organization_memberships
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.cases
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.deadline_reminders
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Profiles mirror auth.users (email only; no auth secrets are copied).
-- ---------------------------------------------------------------------------
create or replace function private.handle_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- full_name from sign-up metadata is a display name only; it is never
    -- used for authorization (roles live in organization_memberships).
    insert into public.profiles (id, email, full_name)
    values (
      new.id,
      lower(coalesce(new.email, new.id::text || '@invalid.local')),
      nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120), '')
    )
    on conflict (id) do nothing;
  elsif tg_op = 'UPDATE' and new.email is distinct from old.email and new.email is not null then
    update public.profiles set email = lower(new.email) where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_auth_user_change();
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function private.handle_auth_user_change();

-- ---------------------------------------------------------------------------
-- Generic: forbid changing tenant/ownership keys on child records.
-- ---------------------------------------------------------------------------
create or replace function private.guard_immutable_tenant_keys()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.case_id is distinct from old.case_id then
    raise exception 'organization_id and case_id are immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guard_immutable_tenant_keys before update on public.case_snapshots
  for each row execute function private.guard_immutable_tenant_keys();
create trigger guard_immutable_tenant_keys before update on public.case_events
  for each row execute function private.guard_immutable_tenant_keys();
create trigger guard_immutable_tenant_keys before update on public.monitoring_runs
  for each row execute function private.guard_immutable_tenant_keys();
create trigger guard_immutable_tenant_keys before update on public.deadline_reminders
  for each row execute function private.guard_immutable_tenant_keys();

-- ---------------------------------------------------------------------------
-- cases guard
-- ---------------------------------------------------------------------------
create or replace function private.guard_cases()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_privileged boolean := private.is_privileged_role();
  v_role public.membership_role;
begin
  -- Referential actions (ON DELETE SET NULL when a user/membership is
  -- deleted) are system-initiated by the FK definitions themselves.
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    return new;
  end if;

  -- BEFORE triggers run before RLS WITH CHECK: reject inserts into an
  -- organization the caller does not belong to as an authorization failure
  -- (42501) before any other validation can produce a different signal.
  if tg_op = 'INSERT' and not v_privileged
     and new.organization_id not in (select private.member_org_ids()) then
    raise exception 'not a member of the target organization' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if not v_privileged then
      -- System-managed fields cannot be supplied by users.
      new.created_by               := (select auth.uid());
      new.status                   := 'active';
      new.archived_at              := null;
      new.court_status             := null;
      new.last_check_attempt_at    := null;
      new.last_successful_check_at := null;
      new.last_check_outcome       := 'never_checked';
    end if;
  else
    if new.organization_id is distinct from old.organization_id then
      raise exception 'organization_id is immutable' using errcode = '42501';
    end if;
    if not v_privileged then
      if new.created_by is distinct from old.created_by
         or new.court_status is distinct from old.court_status
         or new.last_check_attempt_at is distinct from old.last_check_attempt_at
         or new.last_successful_check_at is distinct from old.last_successful_check_at
         or new.last_check_outcome is distinct from old.last_check_outcome then
        raise exception 'monitoring fields are system-managed' using errcode = '42501';
      end if;
      if (new.assigned_user_id is distinct from old.assigned_user_id
          or new.assigned_assistant_id is distinct from old.assigned_assistant_id)
         and not private.is_org_admin(new.organization_id) then
        raise exception 'only an organization admin may change case assignment'
          using errcode = '42501';
      end if;
    end if;
  end if;

  -- Archive bookkeeping is derived from status.
  if new.status = 'archived' then
    new.archived_at := coalesce(case when tg_op = 'UPDATE' then old.archived_at end, now());
  else
    new.archived_at := null;
  end if;

  -- Responsible lawyer must be an ACTIVE admin/lawyer of the same org.
  if new.assigned_user_id is not null
     and (tg_op = 'INSERT' or new.assigned_user_id is distinct from old.assigned_user_id) then
    select m.role into v_role
    from public.organization_memberships m
    where m.organization_id = new.organization_id
      and m.user_id = new.assigned_user_id
      and m.status = 'active';
    if v_role is null or v_role not in ('admin', 'lawyer') then
      raise exception 'assigned lawyer must be an active lawyer or admin of this organization'
        using errcode = '23514';
    end if;
  end if;

  -- Assistant must be an ACTIVE assistant of the same org.
  if new.assigned_assistant_id is not null
     and (tg_op = 'INSERT' or new.assigned_assistant_id is distinct from old.assigned_assistant_id) then
    v_role := null;
    select m.role into v_role
    from public.organization_memberships m
    where m.organization_id = new.organization_id
      and m.user_id = new.assigned_assistant_id
      and m.status = 'active';
    if v_role is distinct from 'assistant' then
      raise exception 'assigned assistant must be an active assistant of this organization'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger guard_cases before insert or update on public.cases
  for each row execute function private.guard_cases();

-- ---------------------------------------------------------------------------
-- memberships guard
-- ---------------------------------------------------------------------------
create or replace function private.guard_memberships()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.user_id is distinct from old.user_id then
    raise exception 'membership organization and user are immutable' using errcode = '42501';
  end if;

  if not private.is_privileged_role() and old.user_id = (select auth.uid())
     and (new.role is distinct from old.role or new.status is distinct from old.status) then
    raise exception 'members cannot change their own role or status' using errcode = '42501';
  end if;

  -- Keep at least one active admin. Lock the org row to serialize concurrent
  -- demotions.
  if old.role = 'admin' and old.status = 'active'
     and (new.role <> 'admin' or new.status <> 'active') then
    perform 1 from public.organizations o where o.id = old.organization_id for update;
    if not exists (
      select 1 from public.organization_memberships m
      where m.organization_id = old.organization_id
        and m.id <> old.id
        and m.role = 'admin'
        and m.status = 'active'
    ) then
      raise exception 'an organization must keep at least one active admin' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_memberships before update on public.organization_memberships
  for each row execute function private.guard_memberships();

-- ---------------------------------------------------------------------------
-- invitations guard
-- ---------------------------------------------------------------------------
create or replace function private.guard_invitations()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if private.is_privileged_role() or (tg_op = 'UPDATE' and pg_trigger_depth() > 1) then
    return new;  -- trusted roles, or FK referential actions (accepted_by → NULL)
  end if;

  if tg_op = 'INSERT' then
    new.invited_by  := (select auth.uid());
    new.accepted_at := null;
    new.accepted_by := null;
    new.revoked_at  := null;
    new.created_at  := now();
    return new;
  end if;

  -- UPDATE by a user: the only permitted change is revoking a pending invite.
  if old.accepted_at is not null or old.revoked_at is not null then
    raise exception 'invitation is no longer pending' using errcode = '42501';
  end if;
  if new.revoked_at is null
     or row(new.organization_id, new.email, new.role, new.token_hash, new.invited_by,
            new.expires_at, new.accepted_at, new.accepted_by, new.created_at)
        is distinct from
        row(old.organization_id, old.email, old.role, old.token_hash, old.invited_by,
            old.expires_at, old.accepted_at, old.accepted_by, old.created_at) then
    raise exception 'only revocation is permitted' using errcode = '42501';
  end if;
  new.revoked_at := now();
  return new;
end;
$$;

create trigger guard_invitations before insert or update on public.organization_invitations
  for each row execute function private.guard_invitations();

-- ---------------------------------------------------------------------------
-- reminders guard — enforces the proposed → confirmed → completed workflow.
-- Confirmation is a human act: it always requires an authenticated user who
-- is an active admin or lawyer able to write the case.
-- ---------------------------------------------------------------------------
create or replace function private.guard_reminders()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_privileged boolean := private.is_privileged_role();
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if not v_privileged then
      new.origin       := 'manual';
      new.status       := 'proposed';
      new.created_by   := v_uid;
    elsif new.status not in ('proposed', 'needs_review') then
      raise exception 'system-created reminders must start as proposed or needs_review'
        using errcode = '42501';
    end if;
    new.confirmed_by := null;
    new.confirmed_at := null;
    new.completed_by := null;
    new.completed_at := null;
    return new;
  end if;

  -- UPDATE caused by an FK referential action (e.g. confirmed_by → NULL on user deletion).
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.origin is distinct from old.origin
     or new.source_event_id is distinct from old.source_event_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'reminder provenance is immutable' using errcode = '42501';
  end if;

  if not v_privileged and (
       new.confirmed_by is distinct from old.confirmed_by
    or new.confirmed_at is distinct from old.confirmed_at
    or new.completed_by is distinct from old.completed_by
    or new.completed_at is distinct from old.completed_at) then
    raise exception 'confirmation fields are system-managed' using errcode = '42501';
  end if;

  -- Editing the substance of a confirmed/completed reminder voids confirmation.
  if old.status in ('confirmed', 'completed')
     and new.status = old.status
     and (new.due_date is distinct from old.due_date or new.title is distinct from old.title) then
    new.status := 'proposed';
  end if;

  if new.status is distinct from old.status then
    if not (
         (old.status = 'proposed'     and new.status in ('confirmed', 'needs_review'))
      or (old.status = 'needs_review' and new.status in ('proposed', 'confirmed'))
      or (old.status = 'confirmed'    and new.status in ('completed', 'needs_review', 'proposed'))
      or (old.status = 'completed'    and new.status in ('confirmed', 'proposed'))
    ) then
      raise exception 'invalid reminder status transition % -> %', old.status, new.status
        using errcode = '23514';
    end if;

    if new.status = 'confirmed' and old.status <> 'completed' then
      if v_uid is null
         or coalesce(private.active_role(new.organization_id)::text, '') not in ('admin', 'lawyer') then
        raise exception 'only an authorized lawyer can confirm a deadline' using errcode = '42501';
      end if;
      new.confirmed_by := v_uid;
      new.confirmed_at := now();
    end if;

    if new.status = 'completed' then
      if v_uid is null then
        raise exception 'completion requires an authenticated user' using errcode = '42501';
      end if;
      new.completed_by := v_uid;
      new.completed_at := now();
    elsif old.status = 'completed' then
      new.completed_by := null;
      new.completed_at := null;
    end if;

    if new.status in ('proposed', 'needs_review') then
      new.confirmed_by := null;
      new.confirmed_at := null;
    end if;
  end if;

  return new;
end;
$$;

create trigger guard_reminders before insert or update on public.deadline_reminders
  for each row execute function private.guard_reminders();

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------
create or replace function private.write_audit(
  p_organization_id uuid,
  p_action text,
  p_resource_type text,
  p_resource_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  insert into public.audit_logs (organization_id, actor_type, actor_user_id, action,
                                 resource_type, resource_id, metadata)
  values (p_organization_id,
          case when v_uid is null then 'system'::public.actor_type else 'user'::public.actor_type end,
          v_uid, p_action, p_resource_type, p_resource_id, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

-- Names of columns whose values changed (values themselves are NOT logged).
create or replace function private.changed_columns(p_old jsonb, p_new jsonb, p_ignore text[])
returns text[]
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(array_agg(k order by k), '{}')
  from jsonb_object_keys(p_new) as k
  where not (k = any (p_ignore))
    and (p_old -> k) is distinct from (p_new -> k);
$$;

create or replace function private.audit_cases()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed text[];
begin
  if tg_op = 'INSERT' then
    perform private.write_audit(new.organization_id, 'case.created', 'case', new.id,
      jsonb_build_object('matter_type', new.matter_type, 'assigned_user_id', new.assigned_user_id));
    return new;
  end if;

  if new.assigned_user_id is distinct from old.assigned_user_id
     or new.assigned_assistant_id is distinct from old.assigned_assistant_id then
    perform private.write_audit(new.organization_id, 'case.assignment_changed', 'case', new.id,
      jsonb_build_object(
        'from_user_id', old.assigned_user_id, 'to_user_id', new.assigned_user_id,
        'from_assistant_id', old.assigned_assistant_id, 'to_assistant_id', new.assigned_assistant_id));
  end if;

  if new.status is distinct from old.status then
    perform private.write_audit(new.organization_id,
      case when new.status = 'archived' then 'case.archived' else 'case.status_changed' end,
      'case', new.id, jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  v_changed := private.changed_columns(to_jsonb(old), to_jsonb(new), array[
    'updated_at', 'status', 'archived_at', 'assigned_user_id', 'assigned_assistant_id',
    'court_status', 'last_check_attempt_at', 'last_successful_check_at', 'last_check_outcome']);
  if cardinality(v_changed) > 0 then
    perform private.write_audit(new.organization_id, 'case.updated', 'case', new.id,
      jsonb_build_object('changed_fields', to_jsonb(v_changed)));
  end if;
  return new;
end;
$$;

create trigger audit_cases after insert or update on public.cases
  for each row execute function private.audit_cases();

create or replace function private.audit_memberships()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_audit(new.organization_id, 'member.added', 'membership', new.id,
      jsonb_build_object('user_id', new.user_id, 'role', new.role));
  else
    if new.role is distinct from old.role then
      perform private.write_audit(new.organization_id, 'member.role_changed', 'membership', new.id,
        jsonb_build_object('user_id', new.user_id, 'from', old.role, 'to', new.role));
    end if;
    if new.status is distinct from old.status then
      perform private.write_audit(new.organization_id, 'member.status_changed', 'membership', new.id,
        jsonb_build_object('user_id', new.user_id, 'from', old.status, 'to', new.status));
    end if;
  end if;
  return new;
end;
$$;

create trigger audit_memberships after insert or update on public.organization_memberships
  for each row execute function private.audit_memberships();

create or replace function private.audit_invitations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The invitee email is personal data and is deliberately not logged.
  if tg_op = 'INSERT' then
    perform private.write_audit(new.organization_id, 'invitation.created', 'invitation', new.id,
      jsonb_build_object('role', new.role, 'expires_at', new.expires_at));
  elsif new.accepted_at is not null and old.accepted_at is null then
    perform private.write_audit(new.organization_id, 'invitation.accepted', 'invitation', new.id,
      jsonb_build_object('role', new.role, 'accepted_by', new.accepted_by));
  elsif new.revoked_at is not null and old.revoked_at is null then
    perform private.write_audit(new.organization_id, 'invitation.revoked', 'invitation', new.id, '{}'::jsonb);
  end if;
  return new;
end;
$$;

create trigger audit_invitations after insert or update on public.organization_invitations
  for each row execute function private.audit_invitations();

create or replace function private.audit_reminders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed text[];
begin
  if tg_op = 'INSERT' then
    perform private.write_audit(new.organization_id, 'reminder.created', 'reminder', new.id,
      jsonb_build_object('case_id', new.case_id, 'origin', new.origin, 'status', new.status));
    return new;
  elsif tg_op = 'DELETE' then
    perform private.write_audit(old.organization_id, 'reminder.deleted', 'reminder', old.id,
      jsonb_build_object('case_id', old.case_id, 'status', old.status));
    return old;
  end if;

  if new.status is distinct from old.status then
    perform private.write_audit(new.organization_id,
      case new.status
        when 'confirmed' then 'reminder.confirmed'
        when 'completed' then 'reminder.completed'
        else 'reminder.status_changed' end,
      'reminder', new.id,
      jsonb_build_object('case_id', new.case_id, 'from', old.status, 'to', new.status));
  end if;

  v_changed := private.changed_columns(to_jsonb(old), to_jsonb(new), array[
    'updated_at', 'status', 'confirmed_by', 'confirmed_at', 'completed_by', 'completed_at']);
  if cardinality(v_changed) > 0 then
    perform private.write_audit(new.organization_id, 'reminder.updated', 'reminder', new.id,
      jsonb_build_object('case_id', new.case_id, 'changed_fields', to_jsonb(v_changed)));
  end if;
  return new;
end;
$$;

create trigger audit_reminders after insert or update or delete on public.deadline_reminders
  for each row execute function private.audit_reminders();

create or replace function private.audit_organizations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_audit(new.id, 'organization.created', 'organization', new.id, '{}'::jsonb);
  elsif new.name is distinct from old.name then
    perform private.write_audit(new.id, 'organization.renamed', 'organization', new.id, '{}'::jsonb);
  end if;
  return new;
end;
$$;

create trigger audit_organizations after insert or update on public.organizations
  for each row execute function private.audit_organizations();

-- ---------------------------------------------------------------------------
-- Append-only audit log. Updates are always rejected. Deletes are rejected
-- unless performed inside private.purge_organization() (owner-only, sets a
-- transaction-local flag) as part of a documented tenant-deletion request.
-- ---------------------------------------------------------------------------
create or replace function private.guard_audit_logs()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and current_setting('dosaria.allow_audit_purge', true) = 'on'
     and current_user in ('postgres', 'supabase_admin') then
    return old;
  end if;
  raise exception 'audit_logs is append-only' using errcode = '42501';
end;
$$;

create trigger guard_audit_logs before update or delete on public.audit_logs
  for each row execute function private.guard_audit_logs();

revoke execute on all functions in schema private from public, anon;
grant execute on function private.is_privileged_role() to authenticated, service_role;
