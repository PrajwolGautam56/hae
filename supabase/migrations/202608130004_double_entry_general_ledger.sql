-- Double-entry accounting foundation. The existing ledger_entries table remains
-- the party sub-ledger; these tables are the balanced general ledger.
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  account_type text not null check (account_type in ('asset','liability','equity','income','expense')),
  normal_side text not null check (normal_side in ('debit','credit')),
  system_key text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(company_id,code), unique(company_id,system_key)
);

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  fiscal_year_id uuid not null references public.fiscal_years(id) on delete restrict,
  voucher_id uuid references public.vouchers(id) on delete cascade,
  entry_date date not null,
  reference text not null,
  description text,
  source_type text not null default 'voucher',
  created_at timestamptz not null default now(),
  unique(voucher_id)
);

create table if not exists public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  party_id uuid references public.parties(id) on delete restrict,
  description text,
  debit numeric(18,2) not null default 0,
  credit numeric(18,2) not null default 0,
  created_at timestamptz not null default now(),
  check (debit >= 0 and credit >= 0),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);

create index if not exists journal_entries_company_date_idx on public.journal_entries(company_id,entry_date);
create index if not exists journal_lines_account_idx on public.journal_lines(account_id);
create index if not exists journal_lines_party_idx on public.journal_lines(party_id);
alter table public.accounts enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;

insert into public.accounts(company_id,code,name,account_type,normal_side,system_key)
select c.id,x.code,x.name,x.account_type,x.normal_side,x.system_key
from public.companies c cross join (values
  ('1000','Cash and Bank','asset','debit','cash_bank'),
  ('1100','Accounts Receivable','asset','debit','accounts_receivable'),
  ('1200','Raw Material Inventory','asset','debit','raw_inventory'),
  ('1210','Finished Goods Inventory','asset','debit','finished_inventory'),
  ('2000','Accounts Payable','liability','credit','accounts_payable'),
  ('3000','Opening Balance Equity','equity','credit','opening_equity'),
  ('4000','Sales Revenue','income','credit','sales_revenue'),
  ('5000','Cost of Goods Sold','expense','debit','cost_of_goods'),
  ('6000','Office and Operating Expenses','expense','debit','office_expense')
) as x(code,name,account_type,normal_side,system_key)
on conflict(company_id,code) do update set name=excluded.name,account_type=excluded.account_type,
  normal_side=excluded.normal_side,system_key=excluded.system_key;

create or replace function public.rebuild_voucher_journal(p_voucher_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v public.vouchers%rowtype; j uuid; dr_account uuid; cr_account uuid;
begin
  select * into v from public.vouchers where id=p_voucher_id;
  if not found or v.fiscal_year_id is null or coalesce(v.total,0)<=0 then return; end if;

  delete from public.journal_entries where voucher_id=v.id;
  insert into public.journal_entries(company_id,fiscal_year_id,voucher_id,entry_date,reference,description)
  values(v.company_id,v.fiscal_year_id,v.id,v.voucher_date,v.voucher_no,v.narration) returning id into j;

  if v.voucher_type='sale' then
    select id into dr_account from public.accounts where company_id=v.company_id and system_key='accounts_receivable';
    select id into cr_account from public.accounts where company_id=v.company_id and system_key='sales_revenue';
  elsif v.voucher_type='receipt' then
    select id into dr_account from public.accounts where company_id=v.company_id and system_key='cash_bank';
    select id into cr_account from public.accounts where company_id=v.company_id and system_key='accounts_receivable';
  elsif v.voucher_type='purchase' then
    select id into dr_account from public.accounts where company_id=v.company_id and system_key='raw_inventory';
    select id into cr_account from public.accounts where company_id=v.company_id and system_key='accounts_payable';
  elsif v.voucher_type='expense' then
    select id into dr_account from public.accounts where company_id=v.company_id and system_key='office_expense';
    select id into cr_account from public.accounts where company_id=v.company_id and system_key='cash_bank';
  elsif v.voucher_type='payment' then
    select id into dr_account from public.accounts where company_id=v.company_id and system_key='accounts_payable';
    select id into cr_account from public.accounts where company_id=v.company_id and system_key='cash_bank';
  else
    delete from public.journal_entries where id=j;
    return;
  end if;

  insert into public.journal_lines(journal_entry_id,company_id,account_id,party_id,description,debit,credit)
  values
    (j,v.company_id,dr_account,v.party_id,v.narration,v.total,0),
    (j,v.company_id,cr_account,v.party_id,v.narration,0,v.total);
end $$;

create or replace function public.sync_voucher_journal()
returns trigger language plpgsql security definer set search_path=public as $$
begin perform public.rebuild_voucher_journal(new.id); return new; end $$;

drop trigger if exists sync_voucher_journal_trigger on public.vouchers;
create trigger sync_voucher_journal_trigger after insert or update of total,voucher_date,party_id,narration
on public.vouchers for each row execute function public.sync_voucher_journal();

-- Backfill every existing voucher so reports work immediately after migration.
do $$ declare r record; begin
  for r in select id from public.vouchers where fiscal_year_id is not null loop
    perform public.rebuild_voucher_journal(r.id);
  end loop;
end $$;
