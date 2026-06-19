
-- EXTENSÕES
create extension if not exists "pgcrypto";

-- TABELAS
create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  state text,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  auth_user_id uuid not null unique,
  full_name text,
  role text not null check (role in ('owner','admin','manager','sales','stock','finance','viewer')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_profiles_store on public.profiles(store_id);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  unique (store_id, name)
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  notes text,
  created_at timestamptz not null default now(),
  unique (store_id, name)
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  doc_id text,
  created_at timestamptz not null default now()
);
create index if not exists idx_customers_store_name on public.customers(store_id, name);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  sku text not null,
  barcode text,
  name text not null,
  brand text,
  model text,
  cost_price numeric(12,2) not null default 0 check (cost_price >= 0),
  sale_price numeric(12,2) not null default 0 check (sale_price >= 0),
  minimum_stock int not null default 0 check (minimum_stock >= 0),
  on_hand int not null default 0 check (on_hand >= 0),
  is_active boolean not null default true,
  image_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, sku)
);
create index if not exists idx_products_store_name on public.products(store_id, name);
create index if not exists idx_products_store_brand_model on public.products(store_id, brand, model);
create index if not exists idx_products_store_onhand on public.products(store_id, on_hand);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  movement_type text not null check (movement_type in ('purchase_in','sale_out','adjustment','return_in','loss')),
  qty int not null check (qty <> 0),
  unit_cost numeric(12,2),
  reference_type text,
  reference_id uuid,
  reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_stock_movements_store_product_time on public.stock_movements(store_id, product_id, created_at desc);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  status text not null check (status in ('draft','paid','cancelled','refunded','partial_refund')),
  gross_total numeric(12,2) not null default 0,
  discount_total numeric(12,2) not null default 0 check (discount_total >= 0),
  shipping_fee numeric(12,2) not null default 0 check (shipping_fee >= 0),
  net_total numeric(12,2) not null default 0,
  cost_total numeric(12,2) not null default 0,
  profit_gross numeric(12,2) not null default 0,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_sales_store_time on public.sales(store_id, created_at desc);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  qty int not null check (qty > 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  line_total numeric(12,2) not null default 0 check (line_total >= 0)
);
create index if not exists idx_sale_items_sale on public.sale_items(sale_id);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  method text not null check (method in ('pix','cash','card','transfer')),
  amount numeric(12,2) not null check (amount > 0),
  provider text,
  external_tx_id text,
  paid_at timestamptz not null default now()
);
create index if not exists idx_payments_sale on public.payments(sale_id);

create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  method text not null check (method in ('pickup','correios','99','motoboy')),
  status text not null check (status in ('pending','packed','sent','delivered','cancelled','problem')),
  tracking_code text,
  external_delivery_id text,
  delivery_cost numeric(12,2) not null default 0 check (delivery_cost >= 0),
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_deliveries_sale on public.deliveries(sale_id);

create table if not exists public.returns (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sale_id uuid references public.sales(id) on delete set null,
  status text not null check (status in ('requested','approved','received','rejected','closed')),
  reason text not null check (reason in ('defect','damaged','wrong_item','customer_regret','other')),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.returns(id) on delete cascade,
  sale_item_id uuid references public.sale_items(id) on delete set null,
  product_id uuid not null references public.products(id) on delete restrict,
  qty int not null check (qty > 0),
  restock boolean not null default false,
  refund_amount numeric(12,2) not null default 0 check (refund_amount >= 0)
);
create index if not exists idx_return_items_return on public.return_items(return_id);

create table if not exists public.cash_ledger (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  currency text not null default 'BRL',
  is_default boolean not null default false,
  unique (store_id, name)
);

create table if not exists public.cash_entries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  ledger_id uuid not null references public.cash_ledger(id) on delete restrict,
  entry_type text not null check (entry_type in ('income','expense')),
  category text not null,
  amount numeric(12,2) not null check (amount > 0),
  occurred_at timestamptz not null default now(),
  reference_type text,
  reference_id uuid,
  description text,
  created_by uuid references public.profiles(id) on delete set null
);
create index if not exists idx_cash_entries_store_time on public.cash_entries(store_id, occurred_at desc);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id uuid,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_store_time on public.audit_logs(store_id, created_at desc);

create table if not exists public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  idem_key text not null,
  action text not null,
  request_hash text not null,
  response_json jsonb,
  created_at timestamptz not null default now(),
  unique (store_id, idem_key)
);

-- FUNÇÕES AUXILIARES
create or replace function public.current_profile()
returns table(profile_id uuid, store_id uuid, role text, is_active boolean)
language sql
stable
as $$
  select p.id, p.store_id, p.role, p.is_active
  from public.profiles p
  where p.auth_user_id = auth.uid()
  limit 1
$$;

create or replace function public.require_active_profile()
returns void
language plpgsql
stable
as $$
declare
  v record;
begin
  select * into v from public.current_profile();
  if v.profile_id is null then
    raise exception 'perfil_nao_encontrado';
  end if;
  if v.is_active is not true then
    raise exception 'usuario_inativo';
  end if;
end;
$$;

-- RPC CRÍTICO: create_sale_atomic
create or replace function public.create_sale_atomic(
  p_store_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_delivery jsonb,
  p_discount numeric default 0
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_sale_id uuid := gen_random_uuid();
  v_gross numeric := 0;
  v_cost numeric := 0;
  v_net numeric := 0;
  v_profit numeric := 0;
  v_item jsonb;
  v_pay jsonb;
  v_product record;
  v_qty int;
  v_unit_price numeric;
  v_line_total numeric;
  v_ship_fee numeric := coalesce((p_delivery->>'shipping_fee')::numeric,0);
  v_delivery_cost numeric := coalesce((p_delivery->>'delivery_cost')::numeric,0);
begin
  perform public.require_active_profile();
  select * into v_ctx from public.current_profile();
  if v_ctx.store_id <> p_store_id then
    raise exception 'store_invalida';
  end if;
  if v_ctx.role not in ('owner','admin','manager','sales') then
    raise exception 'sem_permissao_para_vender';
  end if;

  insert into public.sales(id, store_id, customer_id, status, discount_total, created_by)
  values (v_sale_id, p_store_id, p_customer_id, 'paid', coalesce(p_discount,0), v_ctx.profile_id);

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'qty')::int;
    select * into v_product
      from public.products
      where id = (v_item->>'product_id')::uuid
        and store_id = p_store_id
        and is_active = true
      for update;

    if not found then raise exception 'produto_invalido'; end if;
    if v_qty <= 0 then raise exception 'qty_invalida'; end if;
    if v_product.on_hand < v_qty then raise exception 'estoque_insuficiente'; end if;

    v_unit_price := coalesce(nullif(v_item->>'unit_price','')::numeric, v_product.sale_price);
    v_line_total := v_unit_price * v_qty;

    insert into public.sale_items(sale_id, product_id, qty, unit_price, unit_cost, line_total)
    values (v_sale_id, v_product.id, v_qty, v_unit_price, v_product.cost_price, v_line_total);

    insert into public.stock_movements(store_id, product_id, movement_type, qty, unit_cost, reference_type, reference_id, created_by)
    values (p_store_id, v_product.id, 'sale_out', -v_qty, v_product.cost_price, 'sale', v_sale_id, v_ctx.profile_id);

    update public.products
      set on_hand = on_hand - v_qty, updated_at = now()
      where id = v_product.id;

    v_gross := v_gross + v_line_total;
    v_cost := v_cost + (v_product.cost_price * v_qty);
  end loop;

  v_net := v_gross - coalesce(p_discount,0) + v_ship_fee;
  v_profit := v_net - v_cost;

  update public.sales
    set gross_total = v_gross,
        shipping_fee = v_ship_fee,
        net_total = v_net,
        cost_total = v_cost,
        profit_gross = v_profit
    where id = v_sale_id;

  for v_pay in select * from jsonb_array_elements(p_payments)
  loop
    insert into public.payments(store_id, sale_id, method, amount, provider, external_tx_id)
    values (
      p_store_id, v_sale_id,
      (v_pay->>'method')::text,
      (v_pay->>'amount')::numeric,
      v_pay->>'provider',
      v_pay->>'external_tx_id'
    );

    insert into public.cash_entries(store_id, ledger_id, entry_type, category, amount, reference_type, reference_id, description, created_by)
    select p_store_id, l.id, 'income', 'venda', (v_pay->>'amount')::numeric, 'sale', v_sale_id, 'Recebimento de venda', v_ctx.profile_id
    from public.cash_ledger l
    where l.store_id = p_store_id and l.is_default = true
    limit 1;
  end loop;

  if p_delivery is not null then
    insert into public.deliveries(store_id, sale_id, method, status, tracking_code, external_delivery_id, delivery_cost)
    values (
      p_store_id, v_sale_id,
      coalesce(p_delivery->>'method','pickup'),
      'pending',
      p_delivery->>'tracking_code',
      p_delivery->>'external_delivery_id',
      v_delivery_cost
    );
  end if;

  insert into public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
  values (p_store_id, v_ctx.profile_id, 'create', 'sale', v_sale_id, jsonb_build_object('gross',v_gross,'net',v_net,'profit',v_profit));

  return v_sale_id;
end;
$$;

-- RLS
alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.suppliers enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.stock_movements enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.payments enable row level security;
alter table public.deliveries enable row level security;
alter table public.returns enable row level security;
alter table public.return_items enable row level security;
alter table public.cash_ledger enable row level security;
alter table public.cash_entries enable row level security;
alter table public.audit_logs enable row level security;
alter table public.idempotency_keys enable row level security;

-- Helper function to avoid recursive RLS
create or replace function public.get_my_store_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select store_id from public.profiles where auth_user_id = auth.uid() limit 1
$$;

create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where auth_user_id = auth.uid() limit 1
$$;

-- STORES
create policy stores_select on public.stores for select to authenticated
using (id = public.get_my_store_id());

-- PROFILES
create policy profiles_select on public.profiles for select to authenticated
using (store_id = public.get_my_store_id());

create policy profiles_insert on public.profiles for insert to authenticated
with check (
  public.get_my_role() in ('owner','admin','manager')
  and store_id = public.get_my_store_id()
);

create policy profiles_update on public.profiles for update to authenticated
using (store_id = public.get_my_store_id() and public.get_my_role() in ('owner','admin','manager'))
with check (store_id = public.get_my_store_id());

-- CATEGORIES
create policy categories_select on public.categories for select to authenticated
using (store_id = public.get_my_store_id());

create policy categories_write on public.categories for insert to authenticated
with check (store_id = public.get_my_store_id() and public.get_my_role() in ('owner','admin','manager','stock'));

create policy categories_update on public.categories for update to authenticated
using (store_id = public.get_my_store_id() and public.get_my_role() in ('owner','admin','manager','stock'))
with check (store_id = public.get_my_store_id());

create policy categories_delete on public.categories for delete to authenticated
using (store_id = public.get_my_store_id() and public.get_my_role() in ('owner','admin','manager'));

-- SUPPLIERS
create policy suppliers_select on public.suppliers for select to authenticated
using (store_id = public.get_my_store_id());

create policy suppliers_write on public.suppliers for insert to authenticated
with check (store_id = public.get_my_store_id() and public.get_my_role() in ('owner','admin','manager','stock'));

create policy suppliers_update on public.suppliers for update to authenticated
using (store_id = public.get_my_store_id() and public.get_my_role() in ('owner','admin','manager','stock'))
with check (store_id = public.get_my_store_id());

-- CUSTOMERS
create policy customers_select on public.customers for select to authenticated
using (store_id = public.get_my_store_id());

create policy customers_write on public.customers for insert to authenticated
with check (store_id = public.get_my_store_id() and public.get_my_role() in ('owner','admin','manager','sales','finance'));

create policy customers_update on public.customers for update to authenticated
using (store_id = public.get_my_store_id() and public.get_my_role() in ('owner','admin','manager','sales','finance'))
with check (store_id = public.get_my_store_id());

-- PRODUCTS
create policy products_select on public.products for select to authenticated
using (store_id = public.get_my_store_id());

create policy products_write on public.products for insert to authenticated
with check (store_id = public.get_my_store_id() and public.get_my_role() in ('owner','admin','manager','stock'));

create policy products_update on public.products for update to authenticated
using (store_id = public.get_my_store_id() and public.get_my_role() in ('owner','admin','manager','stock'))
with check (store_id = public.get_my_store_id());

-- STOCK MOVEMENTS
create policy stock_movements_select on public.stock_movements for select to authenticated
using (store_id = public.get_my_store_id());

create policy stock_movements_insert on public.stock_movements for insert to authenticated
with check (store_id = public.get_my_store_id() and public.get_my_role() in ('owner','admin','manager','stock'));

-- SALES
create policy sales_select on public.sales for select to authenticated
using (store_id = public.get_my_store_id());

create policy sales_write on public.sales for insert to authenticated
with check (store_id = public.get_my_store_id() and public.get_my_role() in ('owner','admin','manager','sales'));

create policy sales_update on public.sales for update to authenticated
using (store_id = public.get_my_store_id() and public.get_my_role() in ('owner','admin','manager','sales'))
with check (store_id = public.get_my_store_id());

-- SALE ITEMS
create policy sale_items_select on public.sale_items for select to authenticated
using (exists (select 1 from public.sales s where s.id = sale_id and s.store_id = public.get_my_store_id()));

create policy sale_items_write on public.sale_items for insert to authenticated
with check (exists (select 1 from public.sales s where s.id = sale_id and s.store_id = public.get_my_store_id()));

-- PAYMENTS
create policy payments_select on public.payments for select to authenticated
using (store_id = public.get_my_store_id());

create policy payments_write on public.payments for insert to authenticated
with check (store_id = public.get_my_store_id() and public.get_my_role() in ('owner','admin','manager','sales','finance'));

-- DELIVERIES
create policy deliveries_select on public.deliveries for select to authenticated
using (store_id = public.get_my_store_id());

create policy deliveries_write on public.deliveries for insert to authenticated
with check (store_id = public.get_my_store_id() and public.get_my_role() in ('owner','admin','manager','sales','stock'));

create policy deliveries_update on public.deliveries for update to authenticated
using (store_id = public.get_my_store_id() and public.get_my_role() in ('owner','admin','manager','sales','stock'))
with check (store_id = public.get_my_store_id());

-- RETURNS
create policy returns_select on public.returns for select to authenticated
using (store_id = public.get_my_store_id());

create policy returns_write on public.returns for insert to authenticated
with check (store_id = public.get_my_store_id() and public.get_my_role() in ('owner','admin','manager','sales','stock'));

create policy returns_update on public.returns for update to authenticated
using (store_id = public.get_my_store_id() and public.get_my_role() in ('owner','admin','manager','sales','stock'))
with check (store_id = public.get_my_store_id());

-- RETURN ITEMS
create policy return_items_select on public.return_items for select to authenticated
using (exists (select 1 from public.returns r where r.id = return_id and r.store_id = public.get_my_store_id()));

create policy return_items_write on public.return_items for insert to authenticated
with check (exists (select 1 from public.returns r where r.id = return_id and r.store_id = public.get_my_store_id()));

-- CASH LEDGER
create policy cash_ledger_select on public.cash_ledger for select to authenticated
using (store_id = public.get_my_store_id());

create policy cash_ledger_write on public.cash_ledger for insert to authenticated
with check (store_id = public.get_my_store_id() and public.get_my_role() in ('owner','admin','manager','finance'));

-- CASH ENTRIES
create policy cash_entries_select on public.cash_entries for select to authenticated
using (store_id = public.get_my_store_id());

create policy cash_entries_insert on public.cash_entries for insert to authenticated
with check (store_id = public.get_my_store_id() and public.get_my_role() in ('owner','admin','manager','finance','sales'));

-- AUDIT LOGS
create policy audit_select on public.audit_logs for select to authenticated
using (store_id = public.get_my_store_id());

create policy audit_insert on public.audit_logs for insert to authenticated
with check (store_id = public.get_my_store_id());

-- IDEMPOTENCY
create policy idem_select on public.idempotency_keys for select to authenticated
using (store_id = public.get_my_store_id());

create policy idem_write on public.idempotency_keys for insert to authenticated
with check (store_id = public.get_my_store_id());

-- SEEDS
do $$
declare
  v_store uuid := gen_random_uuid();
  v_cat_tela uuid;
  v_cat_bat uuid;
  v_cat_con uuid;
  v_cat_cab uuid;
begin
  insert into public.stores(id, name, city, state) values (v_store, 'Loja Demo (Atibaia)', 'Atibaia', 'SP');
  insert into public.cash_ledger(store_id, name, is_default) values (v_store, 'Caixa principal', true);

  insert into public.categories(id, store_id, name) values (gen_random_uuid(), v_store, 'Tela') returning id into v_cat_tela;
  insert into public.categories(id, store_id, name) values (gen_random_uuid(), v_store, 'Bateria') returning id into v_cat_bat;
  insert into public.categories(id, store_id, name) values (gen_random_uuid(), v_store, 'Conector') returning id into v_cat_con;
  insert into public.categories(id, store_id, name) values (gen_random_uuid(), v_store, 'Cabo/Carregador') returning id into v_cat_cab;

  insert into public.products(store_id, category_id, sku, name, brand, model, cost_price, sale_price, minimum_stock, on_hand) values
    (v_store, v_cat_tela, 'TEL-IP11', 'Tela iPhone 11 (incell)', 'Apple', 'iPhone 11', 120.00, 199.90, 2, 5),
    (v_store, v_cat_bat, 'BAT-IPX', 'Bateria iPhone X (alta)', 'Apple', 'iPhone X', 45.00, 89.90, 3, 8),
    (v_store, v_cat_tela, 'TEL-A12', 'Tela Samsung A12', 'Samsung', 'A12', 60.00, 119.90, 2, 6),
    (v_store, v_cat_bat, 'BAT-A32', 'Bateria Samsung A32', 'Samsung', 'A32', 35.00, 79.90, 3, 10),
    (v_store, v_cat_con, 'CON-TC', 'Conector Type-C universal', 'Genérico', 'Universal', 6.50, 19.90, 10, 40),
    (v_store, v_cat_cab, 'CAB-USB', 'Cabo USB 2m reforçado', 'Genérico', 'Universal', 8.00, 24.90, 10, 30),
    (v_store, v_cat_cab, 'CAR-20W', 'Carregador 20W (USB-C)', 'Genérico', 'Universal', 18.00, 49.90, 6, 20),
    (v_store, v_cat_tela, 'TEL-MOTOE7', 'Tela Moto E7', 'Motorola', 'Moto E7', 55.00, 109.90, 2, 4),
    (v_store, v_cat_bat, 'BAT-RED9', 'Bateria Xiaomi Redmi 9', 'Xiaomi', 'Redmi 9', 28.00, 69.90, 3, 9),
    (v_store, v_cat_con, 'CON-LG', 'Conector Micro-USB', 'Genérico', 'Universal', 4.50, 14.90, 10, 50);
end $$;
