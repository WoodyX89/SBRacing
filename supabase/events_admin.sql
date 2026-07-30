-- Ensure admins can insert/update/delete events
-- Run in Supabase SQL Editor if add/edit fails with RLS error

drop policy if exists "Admins can manage events" on public.events;
create policy "Admins can manage events"
  on public.events for all
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- Make yourself admin if needed:
-- update public.profiles set is_admin = true where email = 'your@email.com';
