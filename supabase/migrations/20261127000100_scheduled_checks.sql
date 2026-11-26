-- =============================================================================
-- Scheduled court checks
-- =============================================================================
-- * case_check_schedule holds, per case, when the next automatic check is due
--   and why. It is a separate table (not columns on cases) so the scheduler
--   never fires the cases audit/updated_at triggers and never reorders lists.
-- * Users can READ the schedule of cases they can read (to show "next check")
--   and can never write it. Only the trusted monitoring process (service role)
--   writes it, through record_monitoring_run and claim_due_case_checks.
-- * Nothing here starts any polling: the scheduler endpoint is disabled unless
--   SCHEDULED_CHECKS_ENABLED=true, and the real court provider has its own,
--   separate approval flag.
-- =============================================================================

create table public.case_check_schedule (
  case_id          uuid primary key,
  organization_id  uuid not null,
  next_check_at    timestamptz not null,
  reason           text not null,
  -- Lease taken by a scheduler run; prevents two runners checking one file.
  claimed_until    timestamptz,
  updated_at       timestamptz not null default now(),
  constraint case_check_schedule_case_fk
    foreign key (organization_id, case_id) references public.cases (organization_id, id) on delete cascade,
  constraint case_check_schedule_reason_values
    check (reason in ('regular', 'after_hearing', 'awaiting_result', 'retry'))
);
create index case_check_schedule_due_idx on public.case_check_schedule (next_check_at);
create index case_check_schedule_org_idx on public.case_check_schedule (organization_id);

alter table public.case_check_schedule enable row level security;
revoke all on table public.case_check_schedule from anon, authenticated;
grant select on public.case_check_schedule to authenticated;

create policy case_check_schedule_select_authorized on public.case_check_schedule
  for select to authenticated
  using (case_id in (select private.readable_case_ids()));

comment on table public.case_check_schedule is
  'When each case is next checked automatically, and why. Written only by the trusted monitoring process.';

-- ---------------------------------------------------------------------------
-- claim_due_case_checks — hands a batch of due ACTIVE cases to one scheduler
-- run and leases them, so concurrent runners never check the same file.
-- A case with no schedule row yet (new, or created before this migration) is
-- due immediately. Optionally limited to one organization (a pilot firm, or
-- tests that must not touch other tenants' cases). Service role only.
-- ---------------------------------------------------------------------------
create or replace function public.claim_due_case_checks(
  p_limit            integer,
  p_lease_seconds    integer default 300,
  p_organization_id  uuid default null
)
returns table (
  case_id               uuid,
  organization_id       uuid,
  court_case_number     text,
  court_name            text,
  matter_type           public.matter_type,
  last_check_outcome    public.check_outcome,
  last_check_attempt_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.is_privileged_role() then
    raise exception 'privileged operation' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'p_limit must be between 1 and 100' using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'p_lease_seconds must be between 30 and 3600' using errcode = '22023';
  end if;

  return query
  with due as (
    select c.id, c.organization_id
      from public.cases c
      left join public.case_check_schedule s on s.case_id = c.id
     where c.status = 'active'
       and (p_organization_id is null or c.organization_id = p_organization_id)
       and (s.case_id is null
            or (s.next_check_at <= now() and (s.claimed_until is null or s.claimed_until <= now())))
     order by s.next_check_at asc nulls first, c.created_at asc
     limit p_limit
       for update of c skip locked
  ),
  claimed as (
    insert into public.case_check_schedule as s (case_id, organization_id, next_check_at, reason, claimed_until)
    select d.id, d.organization_id, now(), 'regular', now() + make_interval(secs => p_lease_seconds)
      from due d
    on conflict (case_id) do update
       set claimed_until = excluded.claimed_until,
           updated_at    = now()
    returning s.case_id
  )
  select c.id, c.organization_id, c.court_case_number, c.court_name, c.matter_type,
         c.last_check_outcome, c.last_check_attempt_at
    from public.cases c
    join claimed k on k.case_id = c.id;
end;
$$;

revoke execute on function public.claim_due_case_checks(integer, integer, uuid) from public, anon, authenticated;
grant  execute on function public.claim_due_case_checks(integer, integer, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- record_monitoring_run, extended: it now also stores the next planned check
-- (and releases the scheduler lease) in the same transaction. The body is
-- otherwise unchanged from 20261125000400_rpc_functions.sql.
-- ---------------------------------------------------------------------------
drop function public.record_monitoring_run(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, public.check_outcome, text, text, jsonb, jsonb);

create function public.record_monitoring_run(
  p_case_id            uuid,
  p_organization_id    uuid,
  p_triggered_by       uuid,
  p_trigger_type       text,
  p_provider           text,
  p_started_at         timestamptz,
  p_finished_at        timestamptz,
  p_outcome            public.check_outcome,
  p_error_code         text default null,
  p_court_status       text default null,
  p_snapshot           jsonb default null,
  p_events             jsonb default '[]'::jsonb,
  p_next_check_at      timestamptz default null,
  p_next_check_reason  text default null
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

  -- A scheduled run is system-initiated: it never claims a user as its trigger.
  if p_trigger_type = 'scheduled' and p_triggered_by is not null then
    raise exception 'a scheduled run has no triggering user' using errcode = '22023';
  end if;
  if (p_next_check_at is null) <> (p_next_check_reason is null) then
    raise exception 'next check time and reason go together' using errcode = '22023';
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

  -- Next automatic check; releases any scheduler lease on this case.
  if p_next_check_at is not null then
    insert into public.case_check_schedule (case_id, organization_id, next_check_at, reason, claimed_until)
    values (p_case_id, p_organization_id, p_next_check_at, p_next_check_reason, null)
    on conflict (case_id) do update
       set next_check_at = excluded.next_check_at,
           reason        = excluded.reason,
           claimed_until = null,
           updated_at    = now();
  end if;

  perform private.write_audit(p_organization_id, 'monitoring.run_completed', 'case', p_case_id,
    jsonb_build_object(
      'run_id', v_run_id,
      'outcome', v_outcome,
      'events_created', v_events_created,
      'triggered_by', p_triggered_by,
      'trigger_type', p_trigger_type,
      'error_code', p_error_code));

  return jsonb_build_object(
    'run_id', v_run_id,
    'outcome', v_outcome,
    'events_created', v_events_created,
    'snapshot_id', v_snapshot_id);
end;
$$;

revoke execute on function public.record_monitoring_run(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, public.check_outcome, text, text, jsonb, jsonb, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.record_monitoring_run(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, public.check_outcome, text, text, jsonb, jsonb, timestamptz, text)
  to service_role;
