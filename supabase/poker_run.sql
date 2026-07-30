-- ============================================================
-- SB Racing — Poker Run
-- Run in Supabase SQL Editor after schema.sql
-- ============================================================

-- Locations (checkpoints) for a poker-run event
create table if not exists public.poker_locations (
  id bigint generated always as identity primary key,
  event_id bigint not null references public.events(id) on delete cascade,
  name text not null,
  description text,
  sort_order int default 0,
  lat double precision,
  lng double precision,
  qr_token text not null unique default encode(gen_random_bytes(12), 'hex'),
  is_active boolean default true,
  created_at timestamptz default now()
);

-- One entry (hand) per rider per event
create table if not exists public.poker_entries (
  id bigint generated always as identity primary key,
  event_id bigint not null references public.events(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  rider_name text not null,
  rider_email text,
  created_at timestamptz default now()
);

create unique index if not exists poker_entries_event_email_uidx
  on public.poker_entries (event_id, lower(rider_email))
  where rider_email is not null;

create unique index if not exists poker_entries_event_user_uidx
  on public.poker_entries (event_id, user_id)
  where user_id is not null;

-- Cards drawn at a stop (one draw per entry per location)
create table if not exists public.poker_draws (
  id bigint generated always as identity primary key,
  entry_id bigint not null references public.poker_entries(id) on delete cascade,
  location_id bigint not null references public.poker_locations(id) on delete cascade,
  cards text[] not null, -- e.g. {'AS','KH'}
  drawn_at timestamptz default now(),
  unique (entry_id, location_id)
);

create index if not exists idx_poker_locations_event on public.poker_locations(event_id);
create index if not exists idx_poker_entries_event on public.poker_entries(event_id);
create index if not exists idx_poker_draws_entry on public.poker_draws(entry_id);

alter table public.poker_locations enable row level security;
alter table public.poker_entries enable row level security;
alter table public.poker_draws enable row level security;

-- Public can read active locations (need name for UI; token checked client-side + via lookup)
drop policy if exists "poker_locations_select" on public.poker_locations;
create policy "poker_locations_select" on public.poker_locations
  for select using (true);

drop policy if exists "poker_locations_admin" on public.poker_locations;
create policy "poker_locations_admin" on public.poker_locations
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- Entries: anyone can insert (join run); read all for leaderboard; update own
drop policy if exists "poker_entries_select" on public.poker_entries;
create policy "poker_entries_select" on public.poker_entries
  for select using (true);

drop policy if exists "poker_entries_insert" on public.poker_entries;
create policy "poker_entries_insert" on public.poker_entries
  for insert with check (true);

drop policy if exists "poker_entries_update" on public.poker_entries;
create policy "poker_entries_update" on public.poker_entries
  for update using (
    user_id = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- Draws: public read (leaderboard); insert allowed for participants
drop policy if exists "poker_draws_select" on public.poker_draws;
create policy "poker_draws_select" on public.poker_draws
  for select using (true);

drop policy if exists "poker_draws_insert" on public.poker_draws;
create policy "poker_draws_insert" on public.poker_draws
  for insert with check (true);

-- Allow category poker_run on events (if check constraint exists, widen it)
-- events.category is free text in base schema — no migration needed if text.

-- Optional: mark poker runs via category = 'poker_run'
