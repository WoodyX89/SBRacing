-- Colour variants + stock for merch (run in Supabase SQL Editor)

alter table public.products add column if not exists stock_qty integer default 0;
alter table public.products add column if not exists sizes text default '';
alter table public.products add column if not exists color text default '';
alter table public.products add column if not exists color_hex text default '';
alter table public.products add column if not exists variant_group text default '';

-- Optional: put existing rows in one group so they show as one product
-- update public.products set variant_group = 'classic-tee' where variant_group is null or variant_group = '';
