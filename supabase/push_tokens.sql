-- ============================================================
-- SB Racing — Push Tokens table (for remote APNs / FCM)
-- Run this in the Supabase SQL Editor
-- Project: vuqwfpwtwacwvaofqjdp
-- ============================================================

create table if not exists public.push_tokens (
  id bigint generated always as identity primary key,
  token text not null unique,
  platform text not null default 'ios' check (platform in ('ios', 'android', 'web')),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Allow the anon key (and authenticated users) to upsert their own device token.
-- The edge function uses the service role to read all tokens when sending.
alter table public.push_tokens enable row level security;

create policy "Anyone can upsert their device token"
  on public.push_tokens
  for insert
  with check (true);

create policy "Anyone can update their own token row"
  on public.push_tokens
  for update
  using (true)
  with check (true);

create policy "Users can read their own tokens"
  on public.push_tokens
  for select
  using (auth.uid() = user_id or user_id is null);

-- Index for fast lookups by the edge function
create index if not exists push_tokens_platform_idx on public.push_tokens (platform);
create index if not exists push_tokens_updated_at_idx on public.push_tokens (updated_at desc);

comment on table public.push_tokens is 'Device tokens for remote push (APNs / FCM). Populated by the Capacitor app.';
