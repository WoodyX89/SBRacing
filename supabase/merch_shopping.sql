-- ============================================================
-- SB Racing — Merch shopping upgrades
-- Run in Supabase SQL Editor after schema.sql / merch_admin.sql
-- ============================================================

-- Product sizes (comma-separated, e.g. "S,M,L,XL" or empty for one-size)
alter table public.products
  add column if not exists sizes text default '';

-- Shipping / contact fields on orders
alter table public.orders
  add column if not exists customer_phone text,
  add column if not exists shipping_address text,
  add column if not exists shipping_city text,
  add column if not exists shipping_province text,
  add column if not exists shipping_postal text,
  add column if not exists notes text;

-- Admins can view and update all orders
drop policy if exists "Admins can view all orders" on public.orders;
create policy "Admins can view all orders"
  on public.orders for select
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

drop policy if exists "Admins can update orders" on public.orders;
create policy "Admins can update orders"
  on public.orders for update
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- Ensure anonymous checkout can insert
drop policy if exists "Anyone can create order" on public.orders;
create policy "Anyone can create order"
  on public.orders for insert
  with check (true);

-- Optional: set common apparel sizes on existing tees/hoodies/jerseys
update public.products
set sizes = 'S,M,L,XL,2XL'
where sizes is null or sizes = ''
  and (
    lower(name) like '%tee%'
    or lower(name) like '%shirt%'
    or lower(name) like '%hoodie%'
    or lower(name) like '%jersey%'
    or lower(name) like '%hat%'
    or lower(name) like '%beanie%'
  );

-- Admins can delete orders
drop policy if exists "Admins can delete orders" on public.orders;
create policy "Admins can delete orders"
  on public.orders for delete
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );
