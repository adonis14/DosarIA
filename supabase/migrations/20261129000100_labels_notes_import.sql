-- =============================================================================
-- DosarIA — case labels, case notes, and bulk case import
--
--   * case_labels / case_label_assignments: colour labels defined per
--     organization (e.g. "CLIENT A", "PRO BONO") and attached to cases.
--     The label list is visible to every member; attaching follows the
--     existing write rule (admin, or the assigned lawyer).
--   * case_notes: free-text notes on a case. "team" notes are visible to
--     everyone who can read the case; "private" notes only to their author.
--     Only the author can edit or delete a note. Note text is never written
--     to the audit log, notifications, the calendar feed or any external
--     service.
--   * public.import_cases(): inserts many cases in one call, row by row, as
--     the CALLER (SECURITY INVOKER: RLS, grants and guard triggers apply to
--     every row), reporting per-row success or the reason for failure.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Labels
-- ---------------------------------------------------------------------------
-- A fixed palette: no arbitrary colour strings ever reach the page's CSS.
create type public.label_color as enum ('gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink');

create table public.case_labels (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null,
  color            public.label_color not null default 'gray',
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint case_labels_org_id_key unique (organization_id, id),
  constraint case_labels_name_length check (char_length(btrim(name)) between 1 and 40),
  constraint case_labels_name_trimmed check (name = btrim(name))
);
create unique index case_labels_org_name_key on public.case_labels (organization_id, lower(name));

create table public.case_label_assignments (
  organization_id  uuid not null,
  case_id          uuid not null,
  label_id         uuid not null,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  primary key (case_id, label_id),
  -- Composite keys: a label can only be attached to a case of the SAME organization.
  constraint case_label_assignments_case_fk
    foreign key (organization_id, case_id) references public.cases (organization_id, id) on delete cascade,
  constraint case_label_assignments_label_fk
    foreign key (organization_id, label_id) references public.case_labels (organization_id, id) on delete cascade
);
create index case_label_assignments_label_idx on public.case_label_assignments (label_id);
create index case_label_assignments_org_idx on public.case_label_assignments (organization_id);

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------
create table public.case_notes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  case_id          uuid not null,
  author_id        uuid not null default auth.uid(),
  body             text not null,
  visibility       text not null default 'team',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint case_notes_case_fk
    foreign key (organization_id, case_id) references public.cases (organization_id, id) on delete cascade,
  constraint case_notes_author_member_fk
    foreign key (organization_id, author_id)
    references public.organization_memberships (organization_id, user_id) on delete cascade,
  constraint case_notes_body_length check (char_length(btrim(body)) between 1 and 5000),
  constraint case_notes_visibility_values check (visibility in ('team', 'private'))
);
create index case_notes_case_created_idx on public.case_notes (case_id, created_at desc);
create index case_notes_author_idx on public.case_notes (author_id);

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on table public.case_labels, public.case_label_assignments, public.case_notes from anon, authenticated;
grant select, insert, update, delete on table public.case_labels, public.case_label_assignments, public.case_notes
  to service_role;

grant select on public.case_labels to authenticated;
grant insert (organization_id, name, color) on public.case_labels to authenticated;
grant update (name, color) on public.case_labels to authenticated;
grant delete on public.case_labels to authenticated;

grant select on public.case_label_assignments to authenticated;
grant insert (organization_id, case_id, label_id) on public.case_label_assignments to authenticated;
grant delete on public.case_label_assignments to authenticated;

grant select on public.case_notes to authenticated;
grant insert (organization_id, case_id, body, visibility) on public.case_notes to authenticated;
grant update (body, visibility) on public.case_notes to authenticated;
grant delete on public.case_notes to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.case_labels            enable row level security;
alter table public.case_label_assignments enable row level security;
alter table public.case_notes             enable row level security;

-- Every active member sees the organization's label list.
create policy case_labels_select_member on public.case_labels
  for select to authenticated
  using (organization_id in (select private.member_org_ids()));
-- Admins and lawyers create labels.
create policy case_labels_insert_admin_or_lawyer on public.case_labels
  for insert to authenticated
  with check (organization_id in (select private.case_creator_org_ids()));
-- Admins change or delete any label; lawyers only the labels they created.
create policy case_labels_update_admin_or_creator on public.case_labels
  for update to authenticated
  using (organization_id in (select private.admin_org_ids())
         or (created_by = (select auth.uid()) and organization_id in (select private.case_creator_org_ids())))
  with check (organization_id in (select private.admin_org_ids())
         or (created_by = (select auth.uid()) and organization_id in (select private.case_creator_org_ids())));
create policy case_labels_delete_admin_or_creator on public.case_labels
  for delete to authenticated
  using (organization_id in (select private.admin_org_ids())
         or (created_by = (select auth.uid()) and organization_id in (select private.case_creator_org_ids())));

-- Labels on a case are visible to whoever can read the case; changed by whoever can write it.
create policy case_label_assignments_select_readable on public.case_label_assignments
  for select to authenticated
  using (case_id in (select private.readable_case_ids()));
create policy case_label_assignments_insert_writable on public.case_label_assignments
  for insert to authenticated
  with check (case_id in (select private.writable_case_ids()));
create policy case_label_assignments_delete_writable on public.case_label_assignments
  for delete to authenticated
  using (case_id in (select private.writable_case_ids()));

-- Team notes: everyone who can read the case. Private notes: the author only.
create policy case_notes_select on public.case_notes
  for select to authenticated
  using (case_id in (select private.readable_case_ids())
         and (visibility = 'team' or author_id = (select auth.uid())));
create policy case_notes_insert_reader on public.case_notes
  for insert to authenticated
  with check (author_id = (select auth.uid()) and case_id in (select private.readable_case_ids()));
create policy case_notes_update_author on public.case_notes
  for update to authenticated
  using (author_id = (select auth.uid()) and case_id in (select private.readable_case_ids()))
  with check (author_id = (select auth.uid()) and case_id in (select private.readable_case_ids()));
create policy case_notes_delete_author on public.case_notes
  for delete to authenticated
  using (author_id = (select auth.uid()) and case_id in (select private.readable_case_ids()));

-- ---------------------------------------------------------------------------
-- Guards: provenance columns are set by the database, never by the caller.
-- ---------------------------------------------------------------------------
create or replace function private.guard_case_labels()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if private.is_privileged_role() then
    return new;
  end if;
  new.name := btrim(new.name);
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.created_at := now();
  else
    if new.organization_id is distinct from old.organization_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'label provenance is immutable' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger guard_case_labels before insert or update on public.case_labels
  for each row execute function private.guard_case_labels();

create or replace function private.guard_case_label_assignments()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.is_privileged_role() then
    new.created_by := (select auth.uid());
    new.created_at := now();
  end if;
  return new;
end;
$$;

create trigger guard_case_label_assignments before insert on public.case_label_assignments
  for each row execute function private.guard_case_label_assignments();

create or replace function private.guard_case_notes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if private.is_privileged_role() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.author_id  := (select auth.uid());
    new.created_at := now();
  elsif new.organization_id is distinct from old.organization_id
     or new.case_id is distinct from old.case_id
     or new.author_id is distinct from old.author_id
     or new.created_at is distinct from old.created_at then
    raise exception 'note provenance is immutable' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger guard_case_notes before insert or update on public.case_notes
  for each row execute function private.guard_case_notes();

-- ---------------------------------------------------------------------------
-- Audit: who did what, never the note text.
-- ---------------------------------------------------------------------------
create or replace function private.audit_labels_notes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'case_labels' then
    if tg_op = 'INSERT' then
      perform private.write_audit(new.organization_id, 'label.created', 'organization', new.organization_id,
        jsonb_build_object('label_id', new.id, 'name', new.name, 'color', new.color));
      return new;
    elsif tg_op = 'UPDATE' then
      if new.name is distinct from old.name or new.color is distinct from old.color then
        perform private.write_audit(new.organization_id, 'label.updated', 'organization', new.organization_id,
          jsonb_build_object('label_id', new.id, 'name', new.name, 'color', new.color));
      end if;
      return new;
    end if;
    -- Not when cascaded from the organization's own deletion (purge).
    if pg_trigger_depth() = 1 then
      perform private.write_audit(old.organization_id, 'label.deleted', 'organization', old.organization_id,
        jsonb_build_object('label_id', old.id, 'name', old.name));
    end if;
    return old;
  end if;

  if tg_table_name = 'case_label_assignments' then
    -- Cascaded removals (label or case deleted) are covered by those entries.
    if tg_op = 'INSERT' then
      perform private.write_audit(new.organization_id, 'case.label_added', 'case', new.case_id,
        jsonb_build_object('label_id', new.label_id));
      return new;
    end if;
    if pg_trigger_depth() = 1 then
      perform private.write_audit(old.organization_id, 'case.label_removed', 'case', old.case_id,
        jsonb_build_object('label_id', old.label_id));
    end if;
    return old;
  end if;

  -- case_notes: id and visibility only.
  if tg_op = 'INSERT' then
    perform private.write_audit(new.organization_id, 'note.created', 'case', new.case_id,
      jsonb_build_object('note_id', new.id, 'visibility', new.visibility));
    return new;
  elsif tg_op = 'UPDATE' then
    if new.body is distinct from old.body or new.visibility is distinct from old.visibility then
      perform private.write_audit(new.organization_id, 'note.updated', 'case', new.case_id,
        jsonb_build_object('note_id', new.id, 'visibility', new.visibility));
    end if;
    return new;
  end if;
  if pg_trigger_depth() = 1 then
    perform private.write_audit(old.organization_id, 'note.deleted', 'case', old.case_id,
      jsonb_build_object('note_id', old.id));
  end if;
  return old;
end;
$$;

create trigger audit_case_labels after insert or update or delete on public.case_labels
  for each row execute function private.audit_labels_notes();
create trigger audit_case_label_assignments after insert or delete on public.case_label_assignments
  for each row execute function private.audit_labels_notes();
create trigger audit_case_notes after insert or update or delete on public.case_notes
  for each row execute function private.audit_labels_notes();

revoke execute on function
  private.guard_case_labels(),
  private.guard_case_label_assignments(),
  private.guard_case_notes(),
  private.audit_labels_notes()
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Bulk import. The application validates and previews every row first; this
-- function is the write path. One sub-transaction per row: a duplicate or an
-- invalid row is reported and skipped, the others are imported.
-- ---------------------------------------------------------------------------
create or replace function public.import_cases(p_organization_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_row  jsonb;
  v_i    integer := 0;
  v_id   uuid;
  v_out  jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'between 0 and 500 rows per import' using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    begin
      insert into public.cases
        (organization_id, court_case_number, court_name, title, matter_type,
         assigned_user_id, assigned_assistant_id, created_by)
      values
        (p_organization_id,
         v_row ->> 'court_case_number',
         v_row ->> 'court_name',
         v_row ->> 'title',
         coalesce(nullif(v_row ->> 'matter_type', '')::public.matter_type, 'civil'),
         nullif(v_row ->> 'assigned_user_id', '')::uuid,
         null,
         v_uid)
      returning id into v_id;
      v_out := v_out || jsonb_build_array(jsonb_build_object('index', v_i, 'id', v_id));
    exception
      when unique_violation then
        v_out := v_out || jsonb_build_array(jsonb_build_object('index', v_i, 'error', 'duplicate'));
      when insufficient_privilege then
        v_out := v_out || jsonb_build_array(jsonb_build_object('index', v_i, 'error', 'forbidden'));
      when others then
        v_out := v_out || jsonb_build_array(jsonb_build_object('index', v_i, 'error', 'invalid', 'code', sqlstate));
    end;
  end loop;
  return v_out;
end;
$$;

revoke execute on function public.import_cases(uuid, jsonb) from public, anon;
grant execute on function public.import_cases(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Organization export: include labels and notes (all of them: the export is
-- the firm's own data, run by an operator, not shown to individual members).
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
    'case_labels', coalesce((select jsonb_agg(to_jsonb(l)) from public.case_labels l
      where l.organization_id = p_organization_id), '[]'::jsonb),
    'case_label_assignments', coalesce((select jsonb_agg(to_jsonb(a)) from public.case_label_assignments a
      where a.organization_id = p_organization_id), '[]'::jsonb),
    'case_notes', coalesce((select jsonb_agg(to_jsonb(n)) from public.case_notes n
      where n.organization_id = p_organization_id), '[]'::jsonb),
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
