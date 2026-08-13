-- Stock column + admin order delete (run in Supabase SQL Editor)

alter table public.products
  add column if not exists stock_qty integer default 0;

alter table public.products
  add column if not exists sizes text default '';

-- Ensure admins can delete orders permanently
drop policy if exists "Admins can delete orders" on public.orders;
create policy "Admins can delete orders"
  on public.orders for delete
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_admin = true
    )
  );
