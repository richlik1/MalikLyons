-- 0007: found by the end-to-end test "deleting the account removes the user".
-- Deleting an auth user sets generations.user_id to NULL (FK on delete set null). That UPDATE
-- runs as Supabase Auth's internal role, which is neither 'service_role' nor a JWT user, so the
-- guard trigger from 0001 rejected it and account deletion failed for anyone with generations.
-- Guards now apply only to requests running as the API's end-user roles.

create or replace function public.generations_user_update_guard()
returns trigger language plpgsql as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if (new.status, new.cost_usd, new.provider, new.model, new.result_path, new.user_id)
     is distinct from (old.status, old.cost_usd, old.provider, old.model, old.result_path, old.user_id) then
    raise exception 'only "saved" may be changed by users';
  end if;
  return new;
end;
$$;

create or replace function public.prevent_role_escalation()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') and new.role is distinct from old.role and not public.is_admin() then
    raise exception 'role changes require admin';
  end if;
  return new;
end;
$$;
