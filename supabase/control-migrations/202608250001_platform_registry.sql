-- Run this migration only in the dedicated Kritech Control Supabase project.
-- It stores routing metadata, never accounting records or database credentials.

create extension if not exists pgcrypto;

create table if not exists public.platform_tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name text not null,
  primary_domain text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_companies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.platform_tenants(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name text not null,
  connection_key text,
  status text not null default 'pending' check (status in ('active','pending','disabled')),
  login_enabled boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug)
);

create index if not exists platform_companies_tenant_idx
  on public.platform_companies(tenant_id, sort_order, name);

alter table public.platform_tenants enable row level security;
alter table public.platform_companies enable row level security;
revoke all on public.platform_tenants from anon, authenticated;
revoke all on public.platform_companies from anon, authenticated;
grant all on public.platform_tenants to service_role;
grant all on public.platform_companies to service_role;

insert into public.platform_tenants (id, slug, name, primary_domain, active)
values ('10000000-0000-4000-8000-000000000001', 'hamro', 'Hamro Business Group', 'hamro.kritechglobal.com', true)
on conflict (slug) do update set
  name = excluded.name,
  primary_domain = excluded.primary_domain,
  active = excluded.active,
  updated_at = now();

insert into public.platform_companies (id, tenant_id, slug, name, connection_key, status, login_enabled, sort_order)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'hamro-afno', 'Hamro Aafno Enterprises', 'HAE', 'active', true, 1),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'ag-manufacturing', 'A.G. Manufacturing & Trading', 'AG', 'pending', false, 2)
on conflict (tenant_id, slug) do update set
  name = excluded.name,
  connection_key = excluded.connection_key,
  status = excluded.status,
  login_enabled = excluded.login_enabled,
  sort_order = excluded.sort_order,
  updated_at = now();
