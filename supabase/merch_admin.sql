-- ============================================================
-- SB Racing — Merch admin policies + better seed products
-- Run this in SQL Editor AFTER schema.sql
-- ============================================================

-- Admins can do everything on products
drop policy if exists "Admins can manage products" on public.products;
create policy "Admins can manage products"
  on public.products for all
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- Also allow admins to see inactive products (select already restricted to is_active for public)
drop policy if exists "Admins can view all products" on public.products;
create policy "Admins can view all products"
  on public.products for select
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- Optional: Storage bucket for product images
-- Create bucket in Dashboard → Storage → New bucket → name: merch → Public
-- Then run:
/*
insert into storage.buckets (id, name, public)
values ('merch', 'merch', true)
on conflict (id) do nothing;

create policy "Public read merch images"
  on storage.objects for select using (bucket_id = 'merch');

create policy "Admins upload merch images"
  on storage.objects for insert with check (
    bucket_id = 'merch'
    and exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

create policy "Admins update merch images"
  on storage.objects for update using (
    bucket_id = 'merch'
    and exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

create policy "Admins delete merch images"
  on storage.objects for delete using (
    bucket_id = 'merch'
    and exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );
*/

-- Clear old seed and insert better SB Racing items
-- (safe if you already have custom products — only deletes the original seed names)
delete from public.products
where name in (
  'Classic SB Logo Tee',
  'Coulee Crusher Jersey',
  'Soggy Bottom Hoodie',
  'Badlands Trail Beanie',
  'SB Insulated Bottle',
  'SB Sticker Pack'
);

insert into public.products (name, description, price, image_url, badge, sort_order, is_active) values
  (
    'Classic SB Logo Tee',
    'Heavyweight cotton tee with the SB Racing mark. Black, charcoal, or burnt orange.',
    28.00,
    'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600&h=450&fit=crop',
    'NEW',
    1,
    true
  ),
  (
    'Coulee Crusher Jersey',
    'Technical MTB jersey with UV protection. Breathable mesh back for summer rides.',
    65.00,
    'https://images.unsplash.com/photo-1517466787929-bc90951d0974?w=600&h=450&fit=crop',
    'BESTSELLER',
    2,
    true
  ),
  (
    'Soggy Bottom Hoodie',
    'Premium fleece hoodie with embroidered SB mark. Built for post-ride chill.',
    55.00,
    'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=600&h=450&fit=crop',
    null,
    3,
    true
  ),
  (
    'Badlands Trail Beanie',
    'Merino wool blend beanie. Warm, breathable, no-itch. One size.',
    22.00,
    'https://images.unsplash.com/photo-1576871337622-98d48d1cf531?w=600&h=450&fit=crop',
    null,
    4,
    true
  ),
  (
    'SB Insulated Bottle',
    '20oz stainless bottle. Keeps drinks cold through a full epic.',
    18.00,
    'https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=600&h=450&fit=crop',
    null,
    5,
    true
  ),
  (
    'SB Sticker Pack',
    'Weatherproof vinyl stickers. 3 designs: logo, mud splat, badlands outline.',
    8.00,
    'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&h=450&fit=crop',
    '3-PACK',
    6,
    true
  ),
  (
    'Trail Cap',
    'Structured dad hat with embroidered SB. Adjustable strap. Black / orange.',
    26.00,
    'https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=600&h=450&fit=crop',
    null,
    7,
    true
  ),
  (
    'Mud Season Socks (2-pack)',
    'Cushioned crew socks. Moisture-wicking. SB logo on cuff.',
    16.00,
    'https://images.unsplash.com/photo-1586350977771-b3b0abd50c82?w=600&h=450&fit=crop',
    null,
    8,
    true
  );

-- ============================================================
-- Make YOUR account an admin (run after you sign up once):
--
--   update public.profiles
--   set is_admin = true
--   where email = 'your-email@example.com';
--
-- ============================================================
