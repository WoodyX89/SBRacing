-- SB Racing — Member forum + event likes/comments
-- Run in Supabase SQL Editor

-- ========== FORUM POSTS ==========
create table if not exists public.forum_posts (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null default '',
  image_url text,
  post_type text not null default 'post' check (post_type in ('post', 'poll')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists forum_posts_created_idx on public.forum_posts (created_at desc);

-- ========== POLL OPTIONS ==========
create table if not exists public.forum_poll_options (
  id bigserial primary key,
  post_id bigint not null references public.forum_posts(id) on delete cascade,
  label text not null,
  sort_order int not null default 0
);

create index if not exists forum_poll_options_post_idx on public.forum_poll_options (post_id);

-- ========== POLL VOTES (one vote per user per poll) ==========
create table if not exists public.forum_poll_votes (
  id bigserial primary key,
  post_id bigint not null references public.forum_posts(id) on delete cascade,
  option_id bigint not null references public.forum_poll_options(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);

create index if not exists forum_poll_votes_post_idx on public.forum_poll_votes (post_id);

-- ========== FORUM COMMENTS ==========
create table if not exists public.forum_comments (
  id bigserial primary key,
  post_id bigint not null references public.forum_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists forum_comments_post_idx on public.forum_comments (post_id, created_at);

-- ========== FORUM LIKES ==========
create table if not exists public.forum_likes (
  id bigserial primary key,
  post_id bigint not null references public.forum_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);

-- ========== EVENT COMMENTS ==========
create table if not exists public.event_comments (
  id bigserial primary key,
  event_id bigint not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists event_comments_event_idx on public.event_comments (event_id, created_at);

-- ========== EVENT LIKES ==========
create table if not exists public.event_likes (
  id bigserial primary key,
  event_id bigint not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);

-- ========== RLS ==========
alter table public.forum_posts enable row level security;
alter table public.forum_poll_options enable row level security;
alter table public.forum_poll_votes enable row level security;
alter table public.forum_comments enable row level security;
alter table public.forum_likes enable row level security;
alter table public.event_comments enable row level security;
alter table public.event_likes enable row level security;

-- Forum posts: authenticated read/write
drop policy if exists "forum_posts_select" on public.forum_posts;
create policy "forum_posts_select" on public.forum_posts for select to authenticated using (true);

drop policy if exists "forum_posts_insert" on public.forum_posts;
create policy "forum_posts_insert" on public.forum_posts for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "forum_posts_update" on public.forum_posts;
create policy "forum_posts_update" on public.forum_posts for update to authenticated
  using (auth.uid() = user_id);

drop policy if exists "forum_posts_delete" on public.forum_posts;
create policy "forum_posts_delete" on public.forum_posts for delete to authenticated
  using (auth.uid() = user_id or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true
  ));

-- Poll options
drop policy if exists "forum_poll_options_select" on public.forum_poll_options;
create policy "forum_poll_options_select" on public.forum_poll_options for select to authenticated using (true);

drop policy if exists "forum_poll_options_insert" on public.forum_poll_options;
create policy "forum_poll_options_insert" on public.forum_poll_options for insert to authenticated
  with check (exists (
    select 1 from public.forum_posts fp where fp.id = post_id and fp.user_id = auth.uid()
  ));

drop policy if exists "forum_poll_options_delete" on public.forum_poll_options;
create policy "forum_poll_options_delete" on public.forum_poll_options for delete to authenticated
  using (exists (
    select 1 from public.forum_posts fp where fp.id = post_id and fp.user_id = auth.uid()
  ));

-- Poll votes
drop policy if exists "forum_poll_votes_select" on public.forum_poll_votes;
create policy "forum_poll_votes_select" on public.forum_poll_votes for select to authenticated using (true);

drop policy if exists "forum_poll_votes_insert" on public.forum_poll_votes;
create policy "forum_poll_votes_insert" on public.forum_poll_votes for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "forum_poll_votes_update" on public.forum_poll_votes;
create policy "forum_poll_votes_update" on public.forum_poll_votes for update to authenticated
  using (auth.uid() = user_id);

drop policy if exists "forum_poll_votes_delete" on public.forum_poll_votes;
create policy "forum_poll_votes_delete" on public.forum_poll_votes for delete to authenticated
  using (auth.uid() = user_id);

-- Forum comments
drop policy if exists "forum_comments_select" on public.forum_comments;
create policy "forum_comments_select" on public.forum_comments for select to authenticated using (true);

drop policy if exists "forum_comments_insert" on public.forum_comments;
create policy "forum_comments_insert" on public.forum_comments for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "forum_comments_delete" on public.forum_comments;
create policy "forum_comments_delete" on public.forum_comments for delete to authenticated
  using (auth.uid() = user_id or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true
  ));

-- Forum likes
drop policy if exists "forum_likes_select" on public.forum_likes;
create policy "forum_likes_select" on public.forum_likes for select to authenticated using (true);

drop policy if exists "forum_likes_insert" on public.forum_likes;
create policy "forum_likes_insert" on public.forum_likes for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "forum_likes_delete" on public.forum_likes;
create policy "forum_likes_delete" on public.forum_likes for delete to authenticated
  using (auth.uid() = user_id);

-- Event comments (logged-in members)
drop policy if exists "event_comments_select" on public.event_comments;
create policy "event_comments_select" on public.event_comments for select to authenticated using (true);

drop policy if exists "event_comments_insert" on public.event_comments;
create policy "event_comments_insert" on public.event_comments for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "event_comments_delete" on public.event_comments;
create policy "event_comments_delete" on public.event_comments for delete to authenticated
  using (auth.uid() = user_id or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true
  ));

-- Event likes
drop policy if exists "event_likes_select" on public.event_likes;
create policy "event_likes_select" on public.event_likes for select to authenticated using (true);

drop policy if exists "event_likes_insert" on public.event_likes;
create policy "event_likes_insert" on public.event_likes for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "event_likes_delete" on public.event_likes;
create policy "event_likes_delete" on public.event_likes for delete to authenticated
  using (auth.uid() = user_id);

-- ========== STORAGE: forum images ==========
insert into storage.buckets (id, name, public)
values ('forum', 'forum', true)
on conflict (id) do update set public = true;

drop policy if exists "forum_images_public_read" on storage.objects;
create policy "forum_images_public_read" on storage.objects
  for select using (bucket_id = 'forum');

drop policy if exists "forum_images_auth_upload" on storage.objects;
create policy "forum_images_auth_upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'forum' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "forum_images_auth_update" on storage.objects;
create policy "forum_images_auth_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'forum' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "forum_images_auth_delete" on storage.objects;
create policy "forum_images_auth_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'forum' and (storage.foldername(name))[1] = auth.uid()::text);
