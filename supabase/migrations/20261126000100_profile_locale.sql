-- ---------------------------------------------------------------------------
-- Interface language preference (presentation only).
--
-- * Nullable: null means "not chosen yet" (the app then saves the language
--   active at the user's next sign-in).
-- * Only 'en' and 'ro' are accepted.
-- * Users may update this column on their OWN profile only: the existing
--   profiles_update_self policy limits rows to auth.uid(), and the column
--   grant below adds this single column next to full_name. Email and id stay
--   non-updatable for clients.
-- * Never used for authorization.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column preferred_locale text;

alter table public.profiles
  add constraint profiles_preferred_locale_values
  check (preferred_locale is null or preferred_locale in ('en', 'ro'));

comment on column public.profiles.preferred_locale is
  'Interface language chosen by the user (en|ro). Presentation only; never used for authorization.';

grant update (preferred_locale) on public.profiles to authenticated;
