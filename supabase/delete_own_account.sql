-- SB Racing — account self-deletion (App Store Guideline 5.1.1v)
-- Run this once in the Supabase SQL Editor (Dashboard → SQL → New query).
--
-- Allows a signed-in user to permanently delete their own auth account
-- and related app data via:  supabase.rpc('delete_own_account')

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Delete app data owned by this user (ignore missing tables)
  begin
    delete from public.rides where user_id = uid;
  exception when undefined_table then null;
  end;

  begin
    delete from public.ride_logs where user_id = uid;
  exception when undefined_table then null;
  end;

  begin
    delete from public.push_tokens where user_id = uid;
  exception when undefined_table then null;
  end;

  begin
    delete from public.forum_posts where user_id = uid;
  exception when undefined_table then null;
  end;

  begin
    delete from public.profiles where id = uid;
  exception when undefined_table then null;
  end;

  begin
    delete from public.members where id = uid;
  exception when undefined_table then null;
  end;

  begin
    delete from public.member_profiles where id = uid;
  exception when undefined_table then null;
  end;

  -- Remove the auth user (requires security definer)
  delete from auth.users where id = uid;
end;
$$;

-- Only authenticated users can call it; function always acts as auth.uid()
revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;

comment on function public.delete_own_account() is
  'Permanently deletes the calling user and their SB Racing data. Used by the in-app Delete Account flow.';
