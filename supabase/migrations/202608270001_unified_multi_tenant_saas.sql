-- Unified Kritech multi-tenant foundation.
-- Non-destructive: existing HAE business rows remain in place and are linked
-- to the seeded Hamro organization/company registry.

create extension if not exists pgcrypto;

create table if not exists public.platform_tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  primary_domain text not null unique,
  status text not null default 'pending',
  active boolean not null default true,
  contact_name text,
  contact_email text,
  contact_phone text,
  address text,
  notes text,
  onboarding_stage text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_companies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.platform_tenants(id) on delete cascade,
  slug text not null,
  name text not null,
  legal_name text,
  connection_key text,
  status text not null default 'pending',
  login_enabled boolean not null default false,
  sort_order integer not null default 0,
  project_ref text,
  region text,
  database_status text not null default 'pending',
  portal_enabled boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, slug)
);

create table if not exists public.platform_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.platform_tenants(id) on delete cascade,
  plan_name text not null default 'Starter',
  status text not null default 'trial',
  starts_on date,
  expires_on date,
  company_limit integer not null default 1 check(company_limit > 0),
  user_limit integer not null default 10 check(user_limit > 0),
  monthly_amount numeric(14,2) not null default 0 check(monthly_amount >= 0),
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_entitlements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.platform_tenants(id) on delete cascade,
  feature_key text not null,
  enabled boolean not null default false,
  limits jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(tenant_id, feature_key)
);

alter table public.platform_companies add column if not exists app_company_id uuid;
alter table public.companies add column if not exists organization_id uuid;
alter table public.companies add column if not exists platform_company_id uuid;
alter table public.companies add column if not exists slug text;
alter table public.companies add column if not exists active boolean not null default true;
alter table public.companies add column if not exists settings jsonb not null default '{}'::jsonb;

do $$ begin
  alter table public.companies
    add constraint companies_organization_id_fkey foreign key (organization_id)
    references public.platform_tenants(id) on delete restrict;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.companies
    add constraint companies_platform_company_id_fkey foreign key (platform_company_id)
    references public.platform_companies(id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.platform_companies
    add constraint platform_companies_app_company_id_fkey foreign key (app_company_id)
    references public.companies(id) on delete set null;
exception when duplicate_object then null; end $$;

drop index if exists public.companies_slug_unique;
create unique index if not exists companies_organization_slug_unique
  on public.companies(organization_id,slug) where organization_id is not null and slug is not null;
create unique index if not exists companies_platform_company_unique
  on public.companies(platform_company_id) where platform_company_id is not null;
create index if not exists companies_organization_idx on public.companies(organization_id, active);
create index if not exists platform_entitlements_tenant_idx on public.platform_entitlements(tenant_id, enabled);

-- One Supabase Auth identity may be a member of many companies.
alter table public.team_members drop constraint if exists team_members_auth_user_id_key;
drop index if exists public.team_members_auth_user_id_key;
create unique index if not exists team_members_company_auth_user_unique
  on public.team_members(company_id, auth_user_id) where auth_user_id is not null;
create index if not exists team_members_auth_user_idx
  on public.team_members(auth_user_id, company_id, active) where auth_user_id is not null;

-- Customer portal identities may likewise access parties in different companies.
drop index if exists public.parties_auth_user_unique;
create unique index if not exists parties_company_auth_user_unique
  on public.parties(company_id, auth_user_id) where auth_user_id is not null;
create index if not exists parties_auth_user_company_idx
  on public.parties(auth_user_id, company_id) where auth_user_id is not null;

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.user_profiles(id, email, name)
select distinct tm.auth_user_id, lower(tm.email), tm.name
from public.team_members tm
where tm.auth_user_id is not null
on conflict(id) do update set
  email = coalesce(excluded.email, public.user_profiles.email),
  name = coalesce(excluded.name, public.user_profiles.name),
  updated_at = now();

-- Seed/link the current HAE workspace without changing its business records.
insert into public.platform_tenants
  (id, slug, name, primary_domain, status, active, onboarding_stage)
values
  ('10000000-0000-4000-8000-000000000001', 'hamro', 'Hamro Business Group', 'hamro.kritechglobal.com', 'active', true, 'ready')
on conflict(slug) do update set
  name = excluded.name,
  primary_domain = excluded.primary_domain,
  status = 'active', active = true, onboarding_stage = 'ready', updated_at = now();

insert into public.platform_companies
  (id, tenant_id, slug, name, legal_name, connection_key, status, login_enabled, sort_order, database_status, portal_enabled)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'hamro-afno', 'Hamro Aafno Enterprises', 'Hamro Aafno Enterprises', 'HAE', 'active', true, 1, 'ready', true)
on conflict(tenant_id, slug) do update set
  name = excluded.name, status = 'active', login_enabled = true,
  database_status = 'ready', portal_enabled = true, updated_at = now();

update public.companies c set
  organization_id = '10000000-0000-4000-8000-000000000001',
  platform_company_id = '20000000-0000-4000-8000-000000000001',
  slug = coalesce(c.slug, 'hamro-afno'),
  active = true
where c.id = (select id from public.companies order by created_at limit 1);

update public.platform_companies pc set app_company_id = c.id
from public.companies c
where pc.id = '20000000-0000-4000-8000-000000000001'
  and c.platform_company_id = pc.id;

insert into public.platform_subscriptions
  (tenant_id, plan_name, status, company_limit, user_limit, monthly_amount)
values
  ('10000000-0000-4000-8000-000000000001', 'Internal', 'active', 5, 50, 0)
on conflict(tenant_id) do nothing;

insert into public.platform_entitlements(tenant_id, feature_key, enabled)
select '10000000-0000-4000-8000-000000000001', feature_key, true
from unnest(array[
  'accounting','sales','purchases','inventory','manufacturing','crm','tasks',
  'orders','customer_portal','cash_bank','cheques','reports'
]) feature_key
on conflict(tenant_id, feature_key) do nothing;

-- RLS helper for future direct authenticated access. Server secret-key calls
-- continue to bypass RLS, but every API must also resolve the selected company.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.user_can_access_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1 from public.team_members tm
    where tm.company_id = p_company_id
      and tm.auth_user_id = (select auth.uid())
      and tm.active = true
  );
$$;

alter table public.user_profiles enable row level security;
alter table public.platform_tenants enable row level security;
alter table public.platform_companies enable row level security;
alter table public.platform_subscriptions enable row level security;
alter table public.platform_entitlements enable row level security;
revoke all on table public.user_profiles, public.platform_tenants, public.platform_companies, public.platform_subscriptions, public.platform_entitlements from anon, authenticated;
grant select on table public.user_profiles to authenticated;
grant update(name,phone,updated_at) on table public.user_profiles to authenticated;

drop policy if exists user_profiles_self_select on public.user_profiles;
create policy user_profiles_self_select on public.user_profiles for select to authenticated
  using ((select auth.uid()) = id);
drop policy if exists user_profiles_self_update on public.user_profiles;
create policy user_profiles_self_update on public.user_profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Leading tenant/company indexes keep authorization and business queries fast.
create index if not exists vouchers_company_fy_date_idx on public.vouchers(company_id, fiscal_year_id, voucher_date desc);
create index if not exists products_company_active_idx on public.products(company_id, active, name);
create index if not exists parties_company_name_idx on public.parties(company_id, name);
create index if not exists work_tasks_company_due_idx on public.work_tasks(company_id, due_at);
create index if not exists crm_activities_company_happened_idx on public.crm_activities(company_id, happened_at desc);

-- Prepare company-scoped RLS policies for every current/future table carrying
-- company_id. No browser table grants are added: application writes remain in
-- validated server APIs, while accidental direct grants remain tenant-safe.
do $$
declare table_row record;
begin
  for table_row in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema
     and t.table_name = c.table_name
     and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'company_id'
  loop
    execute format('alter table public.%I enable row level security', table_row.table_name);
    execute format('drop policy if exists company_member_select on public.%I', table_row.table_name);
    execute format('create policy company_member_select on public.%I for select to authenticated using (private.user_can_access_company(company_id))', table_row.table_name);
    execute format('drop policy if exists company_member_insert on public.%I', table_row.table_name);
    execute format('create policy company_member_insert on public.%I for insert to authenticated with check (private.user_can_access_company(company_id))', table_row.table_name);
    execute format('drop policy if exists company_member_update on public.%I', table_row.table_name);
    execute format('create policy company_member_update on public.%I for update to authenticated using (private.user_can_access_company(company_id)) with check (private.user_can_access_company(company_id))', table_row.table_name);
    execute format('drop policy if exists company_member_delete on public.%I', table_row.table_name);
    execute format('create policy company_member_delete on public.%I for delete to authenticated using (private.user_can_access_company(company_id))', table_row.table_name);
  end loop;
end $$;

create or replace function public.company_reconciliation(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'company_id', p_company_id,
    'parties', (select count(*) from public.parties where company_id = p_company_id),
    'products', (select count(*) from public.products where company_id = p_company_id),
    'vouchers', (select count(*) from public.vouchers where company_id = p_company_id),
    'voucher_total', (select coalesce(sum(total), 0) from public.vouchers where company_id = p_company_id),
    'ledger_entries', (select count(*) from public.ledger_entries where company_id = p_company_id),
    'ledger_debit', (select coalesce(sum(debit), 0) from public.ledger_entries where company_id = p_company_id),
    'ledger_credit', (select coalesce(sum(credit), 0) from public.ledger_entries where company_id = p_company_id),
    'journal_entries', (select count(*) from public.journal_entries where company_id = p_company_id),
    'journal_lines', (select count(*) from public.journal_lines where company_id = p_company_id),
    'journal_debit', (select coalesce(sum(debit), 0) from public.journal_lines where company_id = p_company_id),
    'journal_credit', (select coalesce(sum(credit), 0) from public.journal_lines where company_id = p_company_id),
    'team_members', (select count(*) from public.team_members where company_id = p_company_id),
    'generated_at', now()
  ) into result;
  return result;
end $$;

revoke all on function public.company_reconciliation(uuid) from public, anon, authenticated;
grant execute on function public.company_reconciliation(uuid) to service_role;
