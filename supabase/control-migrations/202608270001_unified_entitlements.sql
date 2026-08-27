-- Kritech Control registry additions for a shared multi-tenant business database.
-- Safe to apply before the business-data migration.

create extension if not exists pgcrypto;

alter table public.platform_companies
  add column if not exists app_company_id uuid;

create table if not exists public.platform_entitlements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.platform_tenants(id) on delete cascade,
  feature_key text not null,
  enabled boolean not null default false,
  limits jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(tenant_id, feature_key)
);

create index if not exists platform_entitlements_tenant_idx
  on public.platform_entitlements(tenant_id, enabled);

alter table public.platform_entitlements enable row level security;
revoke all on table public.platform_entitlements from anon, authenticated;

insert into public.platform_entitlements(tenant_id, feature_key, enabled)
select tenant.id, feature_key, true
from public.platform_tenants tenant
cross join unnest(array[
  'accounting','sales','purchases','inventory','manufacturing','crm','tasks',
  'orders','customer_portal','cash_bank','cheques','reports'
]) feature_key
where tenant.slug = 'hamro'
on conflict(tenant_id, feature_key) do nothing;
