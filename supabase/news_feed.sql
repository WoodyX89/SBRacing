-- Soggy Scoop / home news feed
-- Run in Supabase SQL Editor

create table if not exists public.news_posts (
  id bigint generated always as identity primary key,
  title text not null,
  body text not null,
  category text not null default 'club'
    check (category in ('club', 'event', 'ride', 'alert')),
  link_url text,
  link_label text,
  is_pinned boolean not null default false,
  published boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists news_posts_published_idx
  on public.news_posts (published, is_pinned desc, created_at desc);

-- Anyone can read published posts (app + website if needed)
alter table public.news_posts enable row level security;

drop policy if exists "Public read published news" on public.news_posts;
create policy "Public read published news"
  on public.news_posts for select
  using (published = true);

-- Admins can do everything
drop policy if exists "Admins manage news" on public.news_posts;
create policy "Admins manage news"
  on public.news_posts for all
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- Optional seed so the feed isn't empty on first open
insert into public.news_posts (title, body, category, is_pinned, published)
select
  'Welcome to Soggy Scoop',
  'Club news, trail updates, and what''s happening around Medicine Hat — all in one place.',
  'club',
  true,
  true
where not exists (
  select 1 from public.news_posts where title = 'Welcome to Soggy Scoop'
);
