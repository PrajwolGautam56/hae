-- Defense-in-depth for a hostile tenant/user model.
-- Normal users authenticate through the application server. The browser Data
-- API has no business-table privileges; RLS and relational constraints remain
-- a second and third isolation boundary.

revoke create on schema public from public, anon, authenticated;
revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
revoke all privileges on all functions in schema public from public, anon, authenticated;

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

-- The only directly authenticated table remains the user's own profile.
grant select on public.user_profiles to authenticated;
grant update(name,phone,updated_at) on public.user_profiles to authenticated;
grant usage on schema private to authenticated;
revoke all on function private.user_can_access_company(uuid) from public, anon;
grant execute on function private.user_can_access_company(uuid) to authenticated, service_role;

-- Compound keys let Postgres reject references that point at a row belonging
-- to another company, even when a privileged server/RPC has a programming bug.
create unique index if not exists parties_company_id_id_unique on public.parties(company_id,id);
create unique index if not exists products_company_id_id_unique on public.products(company_id,id);
create unique index if not exists fiscal_years_company_id_id_unique on public.fiscal_years(company_id,id);
create unique index if not exists team_members_company_id_id_unique on public.team_members(company_id,id);
create unique index if not exists money_accounts_company_id_id_unique on public.money_accounts(company_id,id);
create unique index if not exists vouchers_company_id_id_unique on public.vouchers(company_id,id);
create unique index if not exists leads_company_id_id_unique on public.leads(company_id,id);
create unique index if not exists accounts_company_id_id_unique on public.accounts(company_id,id);
create unique index if not exists journal_entries_company_id_id_unique on public.journal_entries(company_id,id);
create unique index if not exists customer_orders_company_id_id_unique on public.customer_orders(company_id,id);
create unique index if not exists production_batches_company_id_id_unique on public.production_batches(company_id,id);
create unique index if not exists work_tasks_company_id_id_unique on public.work_tasks(company_id,id);
create unique index if not exists platform_companies_tenant_id_id_unique on public.platform_companies(tenant_id,id);
create unique index if not exists companies_organization_id_id_unique on public.companies(organization_id,id);

do $$ begin alter table public.platform_companies add constraint platform_company_tenant_app_company_fkey foreign key(tenant_id,app_company_id) references public.companies(organization_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.companies add constraint company_organization_platform_company_fkey foreign key(organization_id,platform_company_id) references public.platform_companies(tenant_id,id) not valid; exception when duplicate_object then null; end $$;

do $$ begin alter table public.vouchers add constraint vouchers_company_party_fkey foreign key(company_id,party_id) references public.parties(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.vouchers add constraint vouchers_company_fiscal_year_fkey foreign key(company_id,fiscal_year_id) references public.fiscal_years(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.vouchers add constraint vouchers_company_generator_fkey foreign key(company_id,generated_by) references public.team_members(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.vouchers add constraint vouchers_company_handler_fkey foreign key(company_id,handled_by) references public.team_members(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.vouchers add constraint vouchers_company_money_account_fkey foreign key(company_id,money_account_id) references public.money_accounts(company_id,id) not valid; exception when duplicate_object then null; end $$;

do $$ begin alter table public.ledger_entries add constraint ledger_company_party_fkey foreign key(company_id,party_id) references public.parties(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.ledger_entries add constraint ledger_company_voucher_fkey foreign key(company_id,voucher_id) references public.vouchers(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.stock_movements add constraint stock_company_product_fkey foreign key(company_id,product_id) references public.products(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.stock_movements add constraint stock_company_voucher_fkey foreign key(company_id,voucher_id) references public.vouchers(company_id,id) not valid; exception when duplicate_object then null; end $$;

do $$ begin alter table public.journal_entries add constraint journal_entry_company_fy_fkey foreign key(company_id,fiscal_year_id) references public.fiscal_years(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.journal_entries add constraint journal_entry_company_voucher_fkey foreign key(company_id,voucher_id) references public.vouchers(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.journal_lines add constraint journal_line_company_entry_fkey foreign key(company_id,journal_entry_id) references public.journal_entries(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.journal_lines add constraint journal_line_company_account_fkey foreign key(company_id,account_id) references public.accounts(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.journal_lines add constraint journal_line_company_party_fkey foreign key(company_id,party_id) references public.parties(company_id,id) not valid; exception when duplicate_object then null; end $$;

do $$ begin alter table public.production_batches add constraint production_company_fy_fkey foreign key(company_id,fiscal_year_id) references public.fiscal_years(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.production_batches add constraint production_company_output_fkey foreign key(company_id,output_product_id) references public.products(company_id,id) not valid; exception when duplicate_object then null; end $$;

do $$ begin alter table public.money_movements add constraint movement_company_from_fkey foreign key(company_id,from_account_id) references public.money_accounts(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.money_movements add constraint movement_company_to_fkey foreign key(company_id,to_account_id) references public.money_accounts(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.money_movements add constraint movement_company_party_fkey foreign key(company_id,party_id) references public.parties(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.money_movements add constraint movement_company_handler_fkey foreign key(company_id,handled_by) references public.team_members(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.money_movements add constraint movement_company_generator_fkey foreign key(company_id,generated_by) references public.team_members(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.money_movements add constraint movement_company_approver_fkey foreign key(company_id,approved_by) references public.team_members(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.money_movements add constraint movement_company_voucher_fkey foreign key(company_id,voucher_id) references public.vouchers(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.money_movements add constraint movement_company_fy_fkey foreign key(company_id,fiscal_year_id) references public.fiscal_years(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.money_accounts add constraint money_account_company_member_fkey foreign key(company_id,team_member_id) references public.team_members(company_id,id) not valid; exception when duplicate_object then null; end $$;

do $$ begin alter table public.leads add constraint leads_company_assignee_fkey foreign key(company_id,assigned_to) references public.team_members(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.leads add constraint leads_company_converted_party_fkey foreign key(company_id,converted_party_id) references public.parties(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.work_tasks add constraint tasks_company_assignee_fkey foreign key(company_id,assigned_to) references public.team_members(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.work_tasks add constraint tasks_company_lead_fkey foreign key(company_id,lead_id) references public.leads(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.work_tasks add constraint tasks_company_party_fkey foreign key(company_id,party_id) references public.parties(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.crm_activities add constraint activity_company_member_fkey foreign key(company_id,member_id) references public.team_members(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.crm_activities add constraint activity_company_lead_fkey foreign key(company_id,lead_id) references public.leads(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.crm_activities add constraint activity_company_party_fkey foreign key(company_id,party_id) references public.parties(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.crm_activities add constraint activity_company_task_fkey foreign key(company_id,task_id) references public.work_tasks(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.customer_orders add constraint orders_company_party_fkey foreign key(company_id,party_id) references public.parties(company_id,id) not valid; exception when duplicate_object then null; end $$;

-- Child tables without company_id derive their tenant from their parent. These
-- triggers stop cross-company IDs before any stock/accounting side effect can
-- commit; a raised error rolls back the complete RPC transaction.
create or replace function private.enforce_voucher_line_company()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.product_id is not null and not exists(
    select 1 from public.vouchers v join public.products p on p.company_id=v.company_id
    where v.id=new.voucher_id and p.id=new.product_id
  ) then raise exception 'Voucher product belongs to another company'; end if;
  return new;
end $$;

create or replace function private.enforce_opening_balance_company()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists(
    select 1 from public.fiscal_years fy join public.parties p on p.company_id=fy.company_id
    where fy.id=new.fiscal_year_id and p.id=new.party_id
  ) then raise exception 'Opening balance party belongs to another company'; end if;
  return new;
end $$;

create or replace function private.enforce_production_consumption_company()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists(
    select 1 from public.production_batches b join public.products p on p.company_id=b.company_id
    where b.id=new.batch_id and p.id=new.product_id
  ) then raise exception 'Consumed product belongs to another company'; end if;
  return new;
end $$;

create or replace function private.enforce_customer_order_line_company()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists(
    select 1 from public.customer_orders o join public.products p on p.company_id=o.company_id
    where o.id=new.order_id and p.id=new.product_id
  ) then raise exception 'Ordered product belongs to another company'; end if;
  return new;
end $$;

create or replace function private.enforce_customer_order_history_actor()
returns trigger language plpgsql set search_path = '' as $$
declare order_company uuid;
begin
  select company_id into order_company from public.customer_orders where id=new.order_id;
  if order_company is null then return new; end if;
  if new.changed_by is not null and new.changed_by_type='staff' and not exists(
    select 1 from public.team_members where id=new.changed_by and company_id=order_company
  ) then raise exception 'Order status staff actor belongs to another company'; end if;
  if new.changed_by is not null and new.changed_by_type='customer' and not exists(
    select 1 from public.parties where id=new.changed_by and company_id=order_company
  ) then raise exception 'Order status customer actor belongs to another company'; end if;
  return new;
end $$;

drop trigger if exists voucher_line_company_guard on public.voucher_lines;
create trigger voucher_line_company_guard before insert or update on public.voucher_lines for each row execute function private.enforce_voucher_line_company();
drop trigger if exists opening_balance_company_guard on public.party_opening_balances;
create trigger opening_balance_company_guard before insert or update on public.party_opening_balances for each row execute function private.enforce_opening_balance_company();
drop trigger if exists production_consumption_company_guard on public.production_consumptions;
create trigger production_consumption_company_guard before insert or update on public.production_consumptions for each row execute function private.enforce_production_consumption_company();
drop trigger if exists customer_order_line_company_guard on public.customer_order_lines;
create trigger customer_order_line_company_guard before insert or update on public.customer_order_lines for each row execute function private.enforce_customer_order_line_company();
drop trigger if exists customer_order_history_actor_guard on public.customer_order_status_history;
create trigger customer_order_history_actor_guard before insert or update on public.customer_order_status_history for each row execute function private.enforce_customer_order_history_actor();

revoke all on function private.enforce_voucher_line_company() from public, anon, authenticated;
revoke all on function private.enforce_opening_balance_company() from public, anon, authenticated;
revoke all on function private.enforce_production_consumption_company() from public, anon, authenticated;
revoke all on function private.enforce_customer_order_line_company() from public, anon, authenticated;
revoke all on function private.enforce_customer_order_history_actor() from public, anon, authenticated;
