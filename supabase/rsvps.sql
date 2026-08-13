-- Event RSVPs for SB Racing
create table if not exists public.rsvps (
  id bigint generated always as identity primary key,
  event_id bigint not null references public.events(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  email text not null,
  emergency_contact text,
  waiver_accepted boolean default false,
  status text default 'confirmed' check (status in ('confirmed', 'waitlist', 'cancelled')),
  created_at timestamptz default now()
);

create unique index if not exists rsvps_event_email_active_idx
  on public.rsvps (event_id, lower(email))
  where status is distinct from 'cancelled';

create index if not exists idx_rsvps_event on public.rsvps(event_id);
create index if not exists idx_rsvps_user on public.rsvps(user_id);

alter table public.rsvps enable row level security;

-- Clean old policies if re-running
drop policy if exists "Anyone can create RSVP" on public.rsvps;
drop policy if exists "Users can view own RSVPs" on public.rsvps;
drop policy if exists "Admins can view all RSVPs" on public.rsvps;
drop policy if exists "Admins and leaders can view all RSVPs" on public.rsvps;
drop policy if exists "Users can update own RSVPs" on public.rsvps;
drop policy if exists "Admins and leaders can update RSVPs" on public.rsvps;
drop policy if exists "Public can read rsvp counts" on public.rsvps;

-- Insert: anyone (guest or logged-in)
create policy "Anyone can create RSVP"
  on public.rsvps for insert
  with check (true);

-- Select: own rows (by user_id) OR admin/leader sees all
-- Also allow authenticated users to read confirmed rows for counts (event_id + status only via full row - acceptable for club app)
create policy "Users can view own RSVPs"
  on public.rsvps for select
  using (
    auth.uid() = user_id
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (coalesce(p.is_admin, false) or coalesce(p.is_leader, false))
    )
  );

-- Spots left uses events.spots_taken (kept in sync by trigger). No public read of all RSVP rows.

create policy "Users can update own RSVPs"
  on public.rsvps for update
  using (
    auth.uid() = user_id
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

create policy "Admins and leaders can update RSVPs"
  on public.rsvps for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (coalesce(p.is_admin, false) or coalesce(p.is_leader, false))
    )
  );

-- Keep events.spots_taken in sync (optional trigger)
create or replace function public.sync_event_spots_taken()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  eid bigint;
  cnt int;
begin
  eid := coalesce(new.event_id, old.event_id);
  select count(*)::int into cnt
  from public.rsvps
  where event_id = eid and status = 'confirmed';
  update public.events set spots_taken = cnt where id = eid;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_rsvps_sync_spots on public.rsvps;
create trigger trg_rsvps_sync_spots
  after insert or update or delete on public.rsvps
  for each row execute function public.sync_event_spots_taken();
