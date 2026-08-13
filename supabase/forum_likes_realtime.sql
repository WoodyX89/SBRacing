-- Enable realtime for forum likes (Supabase Dashboard → Database → Replication, or run:)
alter publication supabase_realtime add table public.forum_likes;
-- If already added, ignore the error.
