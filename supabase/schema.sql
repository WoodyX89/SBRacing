-- ============================================================
-- SB Racing — Supabase Schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL → New query)
-- Project: vuqwfpwtwacwvaofqjdp
-- ============================================================

-- 1. Profiles (extends auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  phone text,
  membership_tier text check (membership_tier in ('trail_rider', 'coulee_crusher', 'youth', 'none')) default 'none',
  membership_status text check (membership_status in ('active', 'pending', 'expired', 'cancelled')) default 'pending',
  membership_expires_at timestamptz,
  is_admin boolean default false,
  avatar_url text,
  emergency_contact text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. Events
create table if not exists public.events (
  id bigint generated always as identity primary key,
  title text not null,
  description text,
  event_date date not null,
  event_time time,
  location text,
  difficulty text check (difficulty in ('easy', 'intermediate', 'advanced', 'all_levels')),
  capacity int default 40,
  spots_taken int default 0,
  is_members_only boolean default false,
  is_featured boolean default false,
  category text default 'ride', -- ride, clinic, social
  created_at timestamptz default now()
);

-- 3. RSVPs
create table if not exists public.rsvps (
  id bigint generated always as identity primary key,
  event_id bigint references public.events(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  email text not null,
  emergency_contact text,
  waiver_accepted boolean default false,
  status text default 'confirmed' check (status in ('confirmed', 'waitlist', 'cancelled')),
  created_at timestamptz default now(),
  unique (event_id, email)
);

-- 4. Ride logs (members only)
create table if not exists public.rides (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  trail_name text not null,
  ride_date date not null default current_date,
  distance text,
  duration text,
  rating int check (rating between 1 and 5),
  notes text,
  created_at timestamptz default now()
);

-- 5. Community posts (members only)
create table if not exists public.posts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  likes int default 0,
  created_at timestamptz default now()
);

-- 6. Products (merch)
create table if not exists public.products (
  id bigint generated always as identity primary key,
  name text not null,
  description text,
  price numeric(10,2) not null,
  image_url text,
  badge text,
  is_active boolean default true,
  sort_order int default 0,
  created_at timestamptz default now()
);

-- 7. Orders (simple demo store)
create table if not exists public.orders (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  customer_name text,
  customer_email text,
  items jsonb not null, -- [{name, price, qty}]
  total numeric(10,2) not null,
  status text default 'pending' check (status in ('pending', 'paid', 'shipped', 'cancelled')),
  created_at timestamptz default now()
);

-- ============================================================
-- Indexes
-- ============================================================
create index if not exists idx_rsvps_event on public.rsvps(event_id);
create index if not exists idx_rsvps_user on public.rsvps(user_id);
create index if not exists idx_rides_user on public.rides(user_id);
create index if not exists idx_posts_created on public.posts(created_at desc);
create index if not exists idx_events_date on public.events(event_date);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.rsvps enable row level security;
alter table public.rides enable row level security;
alter table public.posts enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;

-- Profiles
create policy "Public profiles are viewable by everyone"
  on public.profiles for select using (true);

create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert with check (auth.uid() = id);

-- Events (public read)
create policy "Events are viewable by everyone"
  on public.events for select using (true);

create policy "Admins can manage events"
  on public.events for all using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- RSVPs
create policy "Anyone can create RSVP"
  on public.rsvps for insert with check (true);

create policy "Users can view own RSVPs"
  on public.rsvps for select using (
    auth.uid() = user_id or email = (select email from auth.users where id = auth.uid())
  );

create policy "Admins can view all RSVPs"
  on public.rsvps for select using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- Rides
create policy "Users can manage own rides"
  on public.rides for all using (auth.uid() = user_id);

create policy "Users can view own rides"
  on public.rides for select using (auth.uid() = user_id);

-- Posts
create policy "Authenticated users can read posts"
  on public.posts for select using (auth.role() = 'authenticated');

create policy "Authenticated users can create posts"
  on public.posts for insert with check (auth.uid() = user_id);

create policy "Users can update own posts"
  on public.posts for update using (auth.uid() = user_id);

-- Products (public)
create policy "Products are viewable by everyone"
  on public.products for select using (is_active = true);

-- Orders
create policy "Anyone can create order"
  on public.orders for insert with check (true);

create policy "Users can view own orders"
  on public.orders for select using (auth.uid() = user_id);

-- ============================================================
-- Auto-create profile on signup
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- Updated_at helper
-- ============================================================
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

-- ============================================================
-- Seed sample data
-- ============================================================
insert into public.events (title, description, event_date, event_time, location, difficulty, capacity, spots_taken, is_featured, category)
values
  ('Friday Night Coulee Cruise', 'Social paced ride through the coulees. Perfect for newer riders or anyone wanting a relaxed start to the weekend.', '2026-08-07', '18:30', 'Echo Dale Park', 'intermediate', 40, 24, false, 'ride'),
  ('Badlands Epic 40K', 'Our signature endurance ride. 40km of mixed terrain through the stunning badlands. Bring lights and a big smile.', '2026-08-15', '08:00', 'Cypress Hills', 'advanced', 40, 31, true, 'ride'),
  ('Winter Skills & Maintenance', 'Hands-on clinic covering cold weather riding, tire choice, and basic bike maintenance. Coffee & donuts provided.', '2026-08-22', '10:00', 'UFA Hall', 'all_levels', 25, 13, false, 'clinic'),
  ('Full Moon Night Ride', 'Members-only night ride under the full moon. Lights required.', '2026-08-29', '20:00', 'Cypress Hills', 'advanced', 20, 0, false, 'ride')
on conflict do nothing;

insert into public.products (name, description, price, badge, sort_order)
values
  ('Classic SB Logo Tee', 'Heavyweight cotton • 3 colors', 28.00, 'NEW', 1),
  ('Coulee Crusher Jersey', 'Technical MTB • UV protection', 65.00, 'BESTSELLER', 2),
  ('Soggy Bottom Hoodie', 'Premium fleece • Embroidered', 55.00, null, 3),
  ('Badlands Trail Beanie', 'Merino wool blend', 22.00, null, 4),
  ('SB Insulated Bottle', '20oz • Keeps drinks cold', 18.00, null, 5),
  ('SB Sticker Pack', 'Weatherproof • 3 designs', 8.00, '3-PACK', 6)
on conflict do nothing;

-- ============================================================
-- Done. After running:
-- 1. Go to Authentication → Providers → enable Email
-- 2. (Optional) disable "Confirm email" for faster testing
-- 3. Test signup from the site
-- ============================================================

-- Optional helper to increment spots_taken safely
create or replace function public.increment_spots(event_id_input bigint)
returns void
language plpgsql
security definer
as $$
begin
  update public.events
  set spots_taken = spots_taken + 1
  where id = event_id_input
    and spots_taken < capacity;
end;
$$;

grant execute on function public.increment_spots(bigint) to anon, authenticated;

-- Admins manage products
create policy "Admins can manage products"
  on public.products for all
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true))
  with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

create policy "Admins can view all products"
  on public.products for select
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));
