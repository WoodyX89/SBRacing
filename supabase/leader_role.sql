-- Leader role: can manage events; not merch admin
alter table public.profiles
  add column if not exists is_leader boolean default false;

comment on column public.profiles.is_leader is 'Ride leader: add/edit/delete events. Merch admin remains is_admin only.';

-- Events: allow admin OR leader to manage
drop policy if exists "Admins can manage events" on public.events;
create policy "Admins and leaders can manage events"
  on public.events for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and (is_admin = true or is_leader = true)
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and (is_admin = true or is_leader = true)
    )
  );

-- Optional: leaders can view all RSVPs for events they manage
drop policy if exists "Admins can view all RSVPs" on public.event_rsvps;
create policy "Admins and leaders can view all RSVPs"
  on public.event_rsvps for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and (is_admin = true or is_leader = true)
    )
  );

-- Promote a user to Leader (example — replace email):
-- update public.profiles
-- set is_leader = true
-- where email = 'leader@example.com';
--
-- Full admin still:
-- update public.profiles set is_admin = true where email = '...';
--
-- Merch policies stay is_admin only — no change required.
