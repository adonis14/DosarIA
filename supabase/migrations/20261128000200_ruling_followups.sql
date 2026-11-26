-- =============================================================================
-- DosarIA — ruling follow-up: "record when the ruling was communicated"
-- =============================================================================
-- An appeal deadline usually runs from the date the ruling is COMMUNICATED to
-- the party, and the court portal does not show that date reliably. So the
-- app never calculates the deadline. Instead, every detected ruling opens a
-- task for the responsible lawyer:
--
--   awaiting_communication → recorded     the lawyer enters the communication
--                                         date and the deadline date THEY
--                                         determined; this creates an ordinary
--                                         deadline reminder (proposed), which
--                                         they then confirm as usual
--   awaiting_communication → not_needed   e.g. the ruling is final, or no
--                                         appeal will be filed
--   not_needed → awaiting_communication   reopened
--
-- The task stays open (and visible on the case, the dashboard and the
-- Notifications page) until a lawyer resolves it. If the deadline it created
-- is deleted, the task reopens.
--
-- Who may act: an admin of the firm or the case's assigned lawyer (the same
-- "writable case" rule as deadlines). Assistants can see the task.
-- =============================================================================

create table public.ruling_followups (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  case_id           uuid not null,
  event_id          uuid not null,
  status            text not null default 'awaiting_communication',
  communicated_on   date,
  reminder_id       uuid,
  note              text,
  resolved_by       uuid references public.profiles (id) on delete set null,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint ruling_followups_case_fk
    foreign key (organization_id, case_id) references public.cases (organization_id, id) on delete cascade,
  constraint ruling_followups_event_fk
    foreign key (case_id, event_id) references public.case_events (case_id, id) on delete cascade,
  constraint ruling_followups_reminder_fk
    foreign key (case_id, reminder_id) references public.deadline_reminders (case_id, id) on delete set null (reminder_id),
  constraint ruling_followups_event_key unique (event_id),
  constraint ruling_followups_status_values
    check (status in ('awaiting_communication', 'recorded', 'not_needed')),
  constraint ruling_followups_recorded_consistency
    check (status <> 'recorded' or (communicated_on is not null and reminder_id is not null)),
  constraint ruling_followups_resolved_consistency
    check ((status = 'awaiting_communication') = (resolved_at is null)),
  constraint ruling_followups_communicated_range
    check (communicated_on is null or communicated_on between date '2000-01-01' and date '2100-12-31'),
  constraint ruling_followups_note_length check (note is null or char_length(note) <= 500)
);
create index ruling_followups_org_open_idx on public.ruling_followups (organization_id, created_at)
  where status = 'awaiting_communication';
create index ruling_followups_case_idx on public.ruling_followups (case_id);

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
revoke all on table public.ruling_followups from anon, authenticated;
grant select, insert, update, delete on table public.ruling_followups to service_role;
grant select on public.ruling_followups to authenticated;
-- Only these columns; the guard below validates every change.
grant update (status, communicated_on, reminder_id, note) on public.ruling_followups to authenticated;

alter table public.ruling_followups enable row level security;

create policy ruling_followups_select_authorized on public.ruling_followups
  for select to authenticated
  using (case_id in (select private.readable_case_ids()));
create policy ruling_followups_update_case_writer on public.ruling_followups
  for update to authenticated
  using (case_id in (select private.writable_case_ids()))
  with check (case_id in (select private.writable_case_ids()));
-- No INSERT/DELETE policy: tasks are opened by the trigger below and removed
-- only with their case or ruling event.

create trigger set_updated_at before update on public.ruling_followups
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Guard (SECURITY INVOKER: current_user is the caller; lookups use RLS)
-- ---------------------------------------------------------------------------
create or replace function private.guard_ruling_followups()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ruling_date date;
  v_today date := (now() at time zone 'Europe/Bucharest')::date;
begin
  if new.organization_id is distinct from old.organization_id
     or new.case_id is distinct from old.case_id
     or new.event_id is distinct from old.event_id
     or new.created_at is distinct from old.created_at then
    raise exception 'follow-up provenance is immutable' using errcode = '42501';
  end if;

  -- FK action: the deadline created for this task was deleted → reopen it.
  if pg_trigger_depth() > 1 or private.is_privileged_role() then
    if new.reminder_id is null and old.reminder_id is not null and new.status = 'recorded' then
      new.status      := 'awaiting_communication';
      new.resolved_by := null;
      new.resolved_at := null;
    end if;
    return new;
  end if;

  if v_uid is null
     or coalesce(private.active_role(new.organization_id)::text, '') not in ('admin', 'lawyer') then
    raise exception 'only an authorized lawyer can resolve a ruling follow-up' using errcode = '42501';
  end if;
  if new.resolved_by is distinct from old.resolved_by or new.resolved_at is distinct from old.resolved_at then
    raise exception 'resolution fields are system-managed' using errcode = '42501';
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'awaiting_communication' and new.status in ('recorded', 'not_needed'))
    or (old.status = 'not_needed' and new.status = 'awaiting_communication')
  ) then
    raise exception 'invalid follow-up status transition % -> %', old.status, new.status
      using errcode = '23514';
  end if;

  if new.communicated_on is not null then
    select e.occurred_on into v_ruling_date from public.case_events e where e.id = new.event_id;
    if new.communicated_on > v_today then
      raise exception 'the communication date cannot be in the future' using errcode = '23514';
    end if;
    if v_ruling_date is not null and new.communicated_on < v_ruling_date then
      raise exception 'the communication date cannot be before the ruling' using errcode = '23514';
    end if;
  end if;

  -- The linked deadline must be a reminder of this case created for this ruling.
  if new.reminder_id is distinct from old.reminder_id then
    if new.reminder_id is null or not exists (
      select 1 from public.deadline_reminders r
      where r.id = new.reminder_id and r.case_id = new.case_id and r.source_event_id = new.event_id
    ) then
      raise exception 'the deadline must belong to this ruling' using errcode = '23514';
    end if;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'awaiting_communication' then
      new.resolved_by := null;
      new.resolved_at := null;
    else
      new.resolved_by := v_uid;
      new.resolved_at := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_ruling_followups before update on public.ruling_followups
  for each row execute function private.guard_ruling_followups();

-- ---------------------------------------------------------------------------
-- Every detected ruling opens a task. Ruling alerts are always on: a ruling
-- starts a deadline.
-- ---------------------------------------------------------------------------
create or replace function private.open_ruling_followup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event_type = 'decision_issued' then
    insert into public.ruling_followups (organization_id, case_id, event_id)
    values (new.organization_id, new.case_id, new.id)
    on conflict (event_id) do nothing;
  end if;
  return null;
end;
$$;

create trigger open_ruling_followup after insert on public.case_events
  for each row execute function private.open_ruling_followup();

create or replace function private.notify_case_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (organization_id, user_id, case_id, kind, event_id)
  select new.organization_id, r, new.case_id, 'court_update', new.id
  from private.case_notification_recipients(
         new.case_id,
         case when new.event_type = 'decision_issued' then 'always' else 'court_updates' end) as r
  on conflict do nothing;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Record the communication date and the lawyer's own deadline in one step.
-- SECURITY INVOKER: the caller's RLS, column grants and guards apply to both
-- writes (the reminder starts as 'proposed' and must still be confirmed).
-- ---------------------------------------------------------------------------
create or replace function public.record_ruling_communication(
  p_followup_id      uuid,
  p_communicated_on  date,
  p_deadline_date    date,
  p_deadline_title   text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_f          public.ruling_followups%rowtype;
  v_reminder   uuid;
begin
  select * into v_f from public.ruling_followups f where f.id = p_followup_id for update;
  if not found then
    raise exception 'follow-up not found' using errcode = 'P0002';
  end if;
  if v_f.status <> 'awaiting_communication' then
    raise exception 'follow-up is not open' using errcode = '23514';
  end if;
  if p_communicated_on is null or p_deadline_date is null then
    raise exception 'both dates are required' using errcode = '22023';
  end if;
  if p_deadline_date < p_communicated_on then
    raise exception 'the deadline cannot be before the communication date' using errcode = '23514';
  end if;

  insert into public.deadline_reminders (organization_id, case_id, source_event_id, title, due_date, created_by)
  values (v_f.organization_id, v_f.case_id, v_f.event_id, btrim(p_deadline_title), p_deadline_date, (select auth.uid()))
  returning id into v_reminder;

  update public.ruling_followups
     set status = 'recorded', communicated_on = p_communicated_on, reminder_id = v_reminder
   where id = v_f.id;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return v_reminder;
end;
$$;

revoke execute on function public.record_ruling_communication(uuid, date, date, text) from public, anon;
grant execute on function public.record_ruling_communication(uuid, date, date, text) to authenticated;

-- The caller's own open ruling tasks (assigned or followed cases).
create or replace function public.my_open_ruling_followups(p_organization_id uuid)
returns table (
  id                 uuid,
  case_id            uuid,
  ruling_date        date,
  created_at         timestamptz,
  court_case_number  text,
  case_title         text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select f.id, f.case_id, e.occurred_on, f.created_at, c.court_case_number, c.title
  from public.ruling_followups f
  join public.cases c on c.id = f.case_id and c.organization_id = f.organization_id
  join public.case_events e on e.id = f.event_id
  where f.organization_id = p_organization_id
    and f.status = 'awaiting_communication'
    and c.status <> 'archived'
    and (
      c.assigned_user_id = (select auth.uid())
      or c.assigned_assistant_id = (select auth.uid())
      or exists (select 1 from public.case_followers cf
                 where cf.case_id = c.id and cf.user_id = (select auth.uid()))
    )
  order by f.created_at
  limit 50;
$$;

revoke execute on function public.my_open_ruling_followups(uuid) from public, anon;
grant execute on function public.my_open_ruling_followups(uuid) to authenticated;

revoke execute on function
  private.guard_ruling_followups(),
  private.open_ruling_followup(),
  private.notify_case_event()
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Audit (no dates or notes logged, only the change)
-- ---------------------------------------------------------------------------
create or replace function private.audit_ruling_followups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_audit(new.organization_id, 'ruling_followup.opened', 'case', new.case_id,
      jsonb_build_object('followup_id', new.id, 'event_id', new.event_id));
  elsif new.status is distinct from old.status then
    perform private.write_audit(new.organization_id, 'ruling_followup.status_changed', 'case', new.case_id,
      jsonb_build_object('followup_id', new.id, 'from', old.status, 'to', new.status));
  elsif new.communicated_on is distinct from old.communicated_on then
    perform private.write_audit(new.organization_id, 'ruling_followup.updated', 'case', new.case_id,
      jsonb_build_object('followup_id', new.id, 'changed_fields', jsonb_build_array('communicated_on')));
  end if;
  return new;
end;
$$;

create trigger audit_ruling_followups after insert or update on public.ruling_followups
  for each row execute function private.audit_ruling_followups();

revoke execute on function private.audit_ruling_followups() from public, anon, authenticated;

-- Existing rulings (detected before this migration) get a task too.
insert into public.ruling_followups (organization_id, case_id, event_id, created_at)
select e.organization_id, e.case_id, e.id, e.detected_at
from public.case_events e
where e.event_type = 'decision_issued'
on conflict (event_id) do nothing;

-- ---------------------------------------------------------------------------
-- Organization export: include ruling tasks.
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
    'ruling_followups', coalesce((select jsonb_agg(to_jsonb(f)) from public.ruling_followups f
      where f.organization_id = p_organization_id), '[]'::jsonb),
    'monitoring_runs', coalesce((select jsonb_agg(to_jsonb(r)) from public.monitoring_runs r
      where r.organization_id = p_organization_id), '[]'::jsonb),
    'case_followers', coalesce((select jsonb_agg(to_jsonb(f)) from public.case_followers f
      where f.organization_id = p_organization_id), '[]'::jsonb),
    'notification_preferences', coalesce((select jsonb_agg(to_jsonb(np)) from public.notification_preferences np
      where np.organization_id = p_organization_id), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(to_jsonb(n)) from public.notifications n
      where n.organization_id = p_organization_id), '[]'::jsonb),
    'audit_logs', coalesce((select jsonb_agg(to_jsonb(a)) from public.audit_logs a
      where a.organization_id = p_organization_id), '[]'::jsonb)
  );
$$;

revoke execute on function private.export_organization(uuid) from public, anon, authenticated;
grant execute on function private.export_organization(uuid) to service_role;
