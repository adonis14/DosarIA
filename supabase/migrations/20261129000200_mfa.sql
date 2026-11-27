-- =============================================================================
-- DosarIA — two-step verification (TOTP authenticator app)
--
-- Users can turn on an authenticator-app code in their profile (Supabase Auth
-- MFA). Once a user has a VERIFIED factor, a password-only session (AAL1) is
-- not enough: the database itself refuses every read and write until the
-- session has been upgraded with a code (AAL2). The application redirects to
-- the code page, but the guarantee does not depend on it: a stolen password
-- used directly against the API still sees nothing.
--
-- Users without a factor are unaffected.
-- =============================================================================

-- True when the caller's session satisfies their own two-step setting.
-- SECURITY DEFINER only to read auth.mfa_factors; it reveals nothing but a boolean
-- about the caller themself.
create or replace function private.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
      or not exists (
        select 1
        from auth.mfa_factors f
        where f.user_id = (select auth.uid())
          and f.status = 'verified'
      );
$$;

revoke execute on function private.mfa_satisfied() from public, anon;
grant execute on function private.mfa_satisfied() to authenticated, service_role;

-- A RESTRICTIVE policy is AND-ed with every permissive policy, so it narrows
-- access on every table without touching the existing rules.
do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format(
      'create policy mfa_required on public.%I as restrictive for all to authenticated
         using ((select private.mfa_satisfied())) with check ((select private.mfa_satisfied()))',
      t.relname);
  end loop;
end;
$$;

-- The two public functions that write through SECURITY DEFINER helpers (and so
-- bypass RLS) check the same rule explicitly.
create or replace function public.create_organization(p_name text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.mfa_satisfied() then
    raise exception 'two-step verification required' using errcode = '42501';
  end if;
  return private.create_organization(p_name);
end;
$$;

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.mfa_satisfied() then
    raise exception 'two-step verification required' using errcode = '42501';
  end if;
  return private.accept_invitation(p_token);
end;
$$;

revoke execute on function public.create_organization(text) from public, anon;
grant  execute on function public.create_organization(text) to authenticated;
revoke execute on function public.accept_invitation(text) from public, anon;
grant  execute on function public.accept_invitation(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Security self-check (service role only): every public table must have RLS
-- on and the two-step policy. Run by the test suite, so a future table that
-- forgets either fails the build.
-- ---------------------------------------------------------------------------
create or replace function public.security_self_check()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'tables_without_rls', coalesce((
      select jsonb_agg(c.relname order by c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), '[]'::jsonb),
    'tables_without_mfa_policy', coalesce((
      select jsonb_agg(c.relname order by c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and not exists (
          select 1 from pg_policy p
          where p.polrelid = c.oid and p.polname = 'mfa_required' and not p.polpermissive)), '[]'::jsonb)
  );
$$;

revoke execute on function public.security_self_check() from public, anon, authenticated;
grant execute on function public.security_self_check() to service_role;
