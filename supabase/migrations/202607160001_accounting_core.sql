create extension if not exists pgcrypto;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(), name text not null,
  currency text not null default 'BTN', fiscal_year text not null default '2026-27',
  logo_url text, address text, phone text, created_at timestamptz not null default now()
);
create table if not exists public.parties (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  name text not null, party_type text not null default 'customer' check (party_type in ('customer','supplier','both')),
  place text, phone text, tax_no text, opening_balance numeric(18,2) not null default 0,
  created_at timestamptz not null default now(), unique(company_id,name)
);
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  sku text, name text not null, unit text not null default 'pcs', sale_price numeric(18,2) not null default 0,
  purchase_price numeric(18,2) not null default 0, stock_qty numeric(18,3) not null default 0,
  low_stock_at numeric(18,3) not null default 0, active boolean not null default true,
  created_at timestamptz not null default now(), unique(company_id,name)
);
create table if not exists public.vouchers (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  party_id uuid references public.parties(id), voucher_type text not null check(voucher_type in ('sale','purchase','receipt','payment','expense','journal')),
  voucher_no text not null, voucher_date date not null default current_date, payment_mode text,
  narration text, total numeric(18,2) not null default 0, created_at timestamptz not null default now(),
  unique(company_id,voucher_no)
);
create table if not exists public.voucher_lines (
  id uuid primary key default gen_random_uuid(), voucher_id uuid not null references public.vouchers(id) on delete cascade,
  product_id uuid references public.products(id), description text not null, quantity numeric(18,3) not null default 1,
  rate numeric(18,2) not null default 0, amount numeric(18,2) not null default 0, inventory_item boolean not null default false
);
create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  party_id uuid references public.parties(id), voucher_id uuid not null references public.vouchers(id) on delete cascade,
  entry_date date not null, account_name text not null, debit numeric(18,2) not null default 0,
  credit numeric(18,2) not null default 0, created_at timestamptz not null default now(),
  check (debit >= 0 and credit >= 0 and not (debit > 0 and credit > 0))
);
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id), voucher_id uuid not null references public.vouchers(id) on delete cascade,
  movement_date date not null, quantity numeric(18,3) not null, movement_type text not null check(movement_type in ('in','out','adjustment')),
  created_at timestamptz not null default now()
);
create index if not exists parties_company_idx on public.parties(company_id);
create index if not exists vouchers_company_date_idx on public.vouchers(company_id,voucher_date desc);
create index if not exists ledger_party_date_idx on public.ledger_entries(party_id,entry_date);
create index if not exists stock_product_date_idx on public.stock_movements(product_id,movement_date);

alter table public.companies enable row level security;
alter table public.parties enable row level security;
alter table public.products enable row level security;
alter table public.vouchers enable row level security;
alter table public.voucher_lines enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.stock_movements enable row level security;

insert into public.companies(name) select 'Himalayan Link Trading'
where not exists(select 1 from public.companies);
