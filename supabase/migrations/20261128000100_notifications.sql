-- =============================================================================
-- DosarIA — per-person in-app notifications
-- =============================================================================
-- Who is told about a case:
--   * its responsible lawyer and its assistant, and
--   * anyone who chose to follow it (opt-in), if they may still read it.
-- Nobody else — not colleagues, not admins — unless they follow the case.
-- This answers the feedback from lawyers using a competing product: alerts
-- about colleagues' files are noise.
--
-- What creates a notification (database triggers, so manual and scheduled
-- checks behave the same and record_monitoring_run is unchanged):
--   court_update           a new court event on the case          (can be switched off)
--   check_problem          checks on the case started failing    (can be switched off)
--   reminder_added         a deadline was added or suggested      (always on)
--   reminder_needs_review  a deadline must be checked again       (always on)
--   case_assigned          the case was assigned to you           (always on)
-- Deadline items cannot be switched off.
--
-- A notification stores references only (case, event, reminder), never a
-- copy of case content. Reading it goes through the same RLS as the case:
-- a person who loses access to a case also stops seeing its notifications.
-- The person who caused a change is not notified about their own action.
-- =============================================================================

-- Target for the composite FK below: a notification can only cite a reminder
-- of the SAME case.
alter table public.deadline_reminders
  add constraint deadline_reminders_case_id_key unique (case_id, id);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.notification_preferences (
  organization_id  uuid not null,
  user_id          uuid not null,
  court_updates    boolean not null default true,
  check_problems   boolean not null default true,
  updated_at       timestamptz not null default now(),
  primary key (organization_id, user_id),
  constraint notification_preferences_member_fk
    foreign key (organization_id, user_id)
    references public.organization_memberships (organization_id, user_id) on delete cascade
);

create table public.case_followers (
  organization_id  uuid not null,
  case_id          uuid not null,
  user_id          uuid not null,
  created_at       timestamptz not null default now(),
  primary key (case_id, user_id),
  constraint case_followers_case_fk
    foreign key (organization_id, case_id) references public.cases (organization_id, id) on delete cascade,
  constraint case_followers_member_fk
    foreign key (organization_id, user_id)
    references public.organization_memberships (organization_id, user_id) on delete cascade
);
create index case_followers_user_idx on public.case_followers (user_id, organization_id);

create table public.notifications (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  user_id          uuid not null,
  case_id          uuid not null,
  kind             text not null,
  event_id         uuid,
  reminder_id      uuid,
  check_outcome    public.check_outcome,
  created_at       timestamptz not null default now(),
  read_at          timestamptz,
  constraint notifications_case_fk
    foreign key (organization_id, case_id) references public.cases (organization_id, id) on delete cascade,
  constraint notifications_member_fk
    foreign key (organization_id, user_id)
    references public.organization_memberships (organization_id, user_id) on delete cascade,
  constraint notifications_event_fk
    foreign key (case_id, event_id) references public.case_events (case_id, id) on delete cascade,
  constraint notifications_reminder_fk
    foreign key (case_id, reminder_id) references public.deadline_reminders (case_id, id) on delete cascade,
  constraint notifications_kind_values check (kind in (
    'court_update', 'check_problem', 'reminder_added', 'reminder_needs_review', 'case_assigned')),
  constraint notifications_kind_refs check (
    case kind
      when 'court_update'          then event_id is not null and reminder_id is null and check_outcome is null
      when 'check_problem'         then event_id is null and reminder_id is null
                                        and check_outcome in ('failed', 'incomplete', 'source_unavailable')
      when 'reminder_added'        then event_id is null and reminder_id is not null and check_outcome is null
      when 'reminder_needs_review' then event_id is null and reminder_id is not null and check_outcome is null
      when 'case_assigned'         then event_id is null and reminder_id is null and check_outcome is null
    end),
  constraint notifications_read_after_created check (read_at is null or read_at >= created_at)
);
-- One notification per person per court event / per added reminder.
create unique index notifications_user_event_key on public.notifications (user_id, event_id)
  where kind = 'court_update';
create unique index notifications_user_reminder_added_key on public.notifications (user_id, reminder_id)
  where kind = 'reminder_added';
create index notifications_user_org_created_idx on public.notifications (user_id, organization_id, created_at desc);
create index notifications_user_unread_idx on public.notifications (user_id, organization_id)
  where read_at is null;
create index notifications_case_idx on public.notifications (case_id);

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
revoke all on table public.notification_preferences, public.case_followers, public.notifications
  from anon, authenticated;
grant select, insert, update, delete on table
  public.notification_preferences, public.case_followers, public.notifications
  to service_role;

-- Own preferences only.
grant select on public.notification_preferences to authenticated;
grant insert (organization_id, user_id, court_updates, check_problems)
  on public.notification_preferences to authenticated;
grant update (court_updates, check_problems) on public.notification_preferences to authenticated;

-- Own follows only, on cases the caller can read.
grant select on public.case_followers to authenticated;
grant insert (organization_id, case_id, user_id) on public.case_followers to authenticated;
grant delete on public.case_followers to authenticated;

-- Own notifications only; the single writable thing is "read".
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

alter table public.notification_preferences enable row level security;
alter table public.case_followers           enable row level security;
alter table public.notifications            enable row level security;

create policy notification_preferences_select_own on public.notification_preferences
  for select to authenticated
  using (user_id = (select auth.uid()) and organization_id in (select private.member_org_ids()));
create policy notification_preferences_insert_own on public.notification_preferences
  for insert to authenticated
  with check (user_id = (select auth.uid()) and organization_id in (select private.member_org_ids()));
create policy notification_preferences_update_own on public.notification_preferences
  for update to authenticated
  using (user_id = (select auth.uid()) and organization_id in (select private.member_org_ids()))
  with check (user_id = (select auth.uid()) and organization_id in (select private.member_org_ids()));

create policy case_followers_select_own on public.case_followers
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy case_followers_insert_own_readable on public.case_followers
  for insert to authenticated
  with check (user_id = (select auth.uid()) and case_id in (select private.readable_case_ids()));
create policy case_followers_delete_own on public.case_followers
  for delete to authenticated
  using (user_id = (select auth.uid()));

create policy notifications_select_own_readable on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()) and case_id in (select private.readable_case_ids()));
create policy notifications_update_own_readable on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()) and case_id in (select private.readable_case_ids()))
  with check (user_id = (select auth.uid()) and case_id in (select private.readable_case_ids()));
-- No INSERT/DELETE policy: notifications are created by the triggers below
-- and removed only with the case, event, reminder or membership they cite.

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------
create trigger set_updated_at before update on public.notification_preferences
  for each row execute function private.set_updated_at();

-- Users can only mark read / unread; the time is the server's.
create or replace function private.guard_notifications()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if private.is_privileged_role() then
    return new;
  end if;
  if row(new.organization_id, new.user_id, new.case_id, new.kind, new.event_id,
         new.reminder_id, new.check_outcome, new.created_at)
     is distinct from
     row(old.organization_id, old.user_id, old.case_id, old.kind, old.event_id,
         old.reminder_id, old.check_outcome, old.created_at) then
    raise exception 'only read state may change' using errcode = '42501';
  end if;
  new.read_at := case when new.read_at is null then null else coalesce(old.read_at, now()) end;
  return new;
end;
$$;

create trigger guard_notifications before update on public.notifications
  for each row execute function private.guard_notifications();

-- ---------------------------------------------------------------------------
-- Recipients of a case notification.
--   p_topic: 'court_updates' | 'check_problems' (respect the person's
--   preference) or 'always' (deadline items: no opt-out).
-- A follower is included only while they may still read the case (admin of
-- its organization). Archived cases notify nobody. The caller (the person
-- who made the change, if any) is excluded.
-- Not granted to any API role: used only by the triggers below.
-- ---------------------------------------------------------------------------
create or replace function private.case_notification_recipients(p_case_id uuid, p_topic text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select id, organization_id, assigned_user_id, assigned_assistant_id
    from public.cases
    where id = p_case_id and status <> 'archived'
  ),
  candidates as (
    select c.assigned_user_id as uid from c where c.assigned_user_id is not null
    union
    select c.assigned_assistant_id from c where c.assigned_assistant_id is not null
    union
    select f.user_id from public.case_followers f join c on f.case_id = c.id
  )
  select m.user_id
  from candidates k
  cross join c
  join public.organization_memberships m
    on m.organization_id = c.organization_id
   and m.user_id = k.uid
   and m.status = 'active'
  left join public.notification_preferences p
    on p.organization_id = c.organization_id
   and p.user_id = m.user_id
  where (m.role = 'admin' or m.user_id = c.assigned_user_id or m.user_id = c.assigned_assistant_id)
    and m.user_id is distinct from (select auth.uid())
    and case p_topic
          when 'court_updates'  then coalesce(p.court_updates, true)
          when 'check_problems' then coalesce(p.check_problems, true)
          when 'always'         then true
          else false
        end;
$$;

-- New court event → court_update.
create or replace function private.notify_case_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (organization_id, user_id, case_id, kind, event_id)
  select new.organization_id, r, new.case_id, 'court_update', new.id
  from private.case_notification_recipients(new.case_id, 'court_updates') as r
  on conflict do nothing;
  return null;
end;
$$;

create trigger notify_case_event after insert on public.case_events
  for each row execute function private.notify_case_event();

-- Reminder added (manual or suggested) → reminder_added;
-- reminder flagged for review → reminder_needs_review.
create or replace function private.notify_reminder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notifications (organization_id, user_id, case_id, kind, reminder_id)
    select new.organization_id, r, new.case_id, 'reminder_added', new.id
    from private.case_notification_recipients(new.case_id, 'always') as r
    on conflict do nothing;
  elsif new.status = 'needs_review' and old.status is distinct from 'needs_review' then
    insert into public.notifications (organization_id, user_id, case_id, kind, reminder_id)
    select new.organization_id, r, new.case_id, 'reminder_needs_review', new.id
    from private.case_notification_recipients(new.case_id, 'always') as r;
  end if;
  return null;
end;
$$;

create trigger notify_reminder after insert or update of status on public.deadline_reminders
  for each row execute function private.notify_reminder();

-- Checks started failing → check_problem (only on the change from working to
-- failing, so repeated retries do not repeat the alert).
-- New assignee → case_assigned, to that person only.
create or replace function private.notify_case_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if new.status = 'archived' then
    return null;
  end if;

  if new.last_check_outcome in ('failed', 'incomplete', 'source_unavailable')
     and old.last_check_outcome in ('never_checked', 'changes_detected', 'no_changes') then
    insert into public.notifications (organization_id, user_id, case_id, kind, check_outcome)
    select new.organization_id, r, new.id, 'check_problem', new.last_check_outcome
    from private.case_notification_recipients(new.id, 'check_problems') as r;
  end if;

  if new.assigned_user_id is not null
     and new.assigned_user_id is distinct from old.assigned_user_id
     and new.assigned_user_id is distinct from v_actor then
    insert into public.notifications (organization_id, user_id, case_id, kind)
    values (new.organization_id, new.assigned_user_id, new.id, 'case_assigned');
  end if;
  if new.assigned_assistant_id is not null
     and new.assigned_assistant_id is distinct from old.assigned_assistant_id
     and new.assigned_assistant_id is distinct from v_actor then
    insert into public.notifications (organization_id, user_id, case_id, kind)
    values (new.organization_id, new.assigned_assistant_id, new.id, 'case_assigned');
  end if;
  return null;
end;
$$;

create trigger notify_case_change
  after update of last_check_outcome, assigned_user_id, assigned_assistant_id on public.cases
  for each row execute function private.notify_case_change();

-- ---------------------------------------------------------------------------
-- Audit: who changed their alerts or followed a case (no content logged).
-- ---------------------------------------------------------------------------
create or replace function private.audit_notification_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'case_followers' then
    if tg_op = 'INSERT' then
      perform private.write_audit(new.organization_id, 'case.followed', 'case', new.case_id,
        jsonb_build_object('user_id', new.user_id));
      return new;
    end if;
    perform private.write_audit(old.organization_id, 'case.unfollowed', 'case', old.case_id,
      jsonb_build_object('user_id', old.user_id));
    return old;
  end if;

  -- notification_preferences
  if tg_op = 'INSERT'
     or new.court_updates is distinct from old.court_updates
     or new.check_problems is distinct from old.check_problems then
    perform private.write_audit(new.organization_id, 'notification.preferences_changed', 'membership', null,
      jsonb_build_object('user_id', new.user_id,
                         'court_updates', new.court_updates,
                         'check_problems', new.check_problems));
  end if;
  return new;
end;
$$;

create trigger audit_case_followers after insert or delete on public.case_followers
  for each row execute function private.audit_notification_settings();
create trigger audit_notification_preferences after insert or update on public.notification_preferences
  for each row execute function private.audit_notification_settings();

revoke execute on function
  private.guard_notifications(),
  private.case_notification_recipients(uuid, text),
  private.notify_case_event(),
  private.notify_reminder(),
  private.notify_case_change(),
  private.audit_notification_settings()
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Organization export: include follows, alert settings and notifications
-- (they are personal data of the firm's members).
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

-- ---------------------------------------------------------------------------
-- The caller's own confirmed deadlines: overdue ones and those due in the
-- next p_days (Bucharest calendar), on cases assigned to them or followed by
-- them. SECURITY INVOKER: the caller's RLS applies to every row read.
-- Deadline alerts have no opt-out.
-- ---------------------------------------------------------------------------
create or replace function public.my_upcoming_deadlines(p_organization_id uuid, p_days integer default 7)
returns table (
  id                 uuid,
  case_id            uuid,
  title              text,
  description        text,
  due_date           date,
  origin             public.reminder_origin,
  court_case_number  text,
  case_title         text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.id, r.case_id, r.title, r.description, r.due_date, r.origin, c.court_case_number, c.title
  from public.deadline_reminders r
  join public.cases c on c.id = r.case_id and c.organization_id = r.organization_id
  where r.organization_id = p_organization_id
    and r.status = 'confirmed'
    and c.status <> 'archived'
    and r.due_date <= (now() at time zone 'Europe/Bucharest')::date + least(greatest(coalesce(p_days, 7), 0), 60)
    and (
      c.assigned_user_id = (select auth.uid())
      or c.assigned_assistant_id = (select auth.uid())
      or exists (select 1 from public.case_followers f
                 where f.case_id = c.id and f.user_id = (select auth.uid()))
    )
  order by r.due_date, r.title
  limit 50;
$$;

revoke execute on function public.my_upcoming_deadlines(uuid, integer) from public, anon;
grant execute on function public.my_upcoming_deadlines(uuid, integer) to authenticated;
