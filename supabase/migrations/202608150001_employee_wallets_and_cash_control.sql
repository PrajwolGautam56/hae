-- Employee-attributed vouchers and auditable company cash control.
alter table public.vouchers add column if not exists generated_by uuid references public.team_members(id) on delete set null;
alter table public.vouchers add column if not exists handled_by uuid references public.team_members(id) on delete set null;

create table if not exists public.money_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  account_type text not null check (account_type in ('bank','office_cash','employee_wallet')),
  name text not null,
  bank_name text,
  account_number text,
  team_member_id uuid references public.team_members(id) on delete set null,
  opening_balance numeric(18,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(company_id,name)
);
create unique index if not exists money_accounts_member_wallet_idx
  on public.money_accounts(company_id,team_member_id) where account_type='employee_wallet';

alter table public.vouchers add column if not exists money_account_id uuid references public.money_accounts(id) on delete set null;

create table if not exists public.money_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  fiscal_year_id uuid not null references public.fiscal_years(id) on delete restrict,
  voucher_id uuid references public.vouchers(id) on delete cascade,
  movement_date date not null,
  movement_type text not null check (movement_type in ('customer_receipt','office_deposit','bank_deposit','internal_transfer','outgoing_payment','expense','opening_adjustment')),
  from_account_id uuid references public.money_accounts(id) on delete restrict,
  to_account_id uuid references public.money_accounts(id) on delete restrict,
  amount numeric(18,2) not null check(amount>0),
  payment_mode text,
  party_id uuid references public.parties(id) on delete set null,
  handled_by uuid references public.team_members(id) on delete set null,
  generated_by uuid references public.team_members(id) on delete set null,
  approved_by uuid references public.team_members(id) on delete set null,
  title text not null,
  reference text,
  notes text,
  status text not null default 'posted' check(status in ('pending','posted','cancelled')),
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  check (from_account_id is not null or to_account_id is not null),
  check (from_account_id is null or to_account_id is null or from_account_id<>to_account_id)
);

create index if not exists money_movements_company_date_idx on public.money_movements(company_id,movement_date desc);
create index if not exists money_movements_from_idx on public.money_movements(from_account_id,status);
create index if not exists money_movements_to_idx on public.money_movements(to_account_id,status);
create unique index if not exists money_movements_voucher_idx on public.money_movements(voucher_id) where voucher_id is not null;
alter table public.money_accounts enable row level security;
alter table public.money_movements enable row level security;

insert into public.money_accounts(company_id,account_type,name,opening_balance)
select id,'office_cash','Office Counter Cash',0 from public.companies
on conflict(company_id,name) do nothing;

insert into public.money_accounts(company_id,account_type,name,team_member_id,opening_balance)
select tm.company_id,'employee_wallet',tm.name||' · Wallet',tm.id,0
from public.team_members tm where tm.active=true
on conflict do nothing;

create or replace function public.ensure_team_wallet()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.active then
    update money_accounts set name=new.name||' · Wallet',active=true where company_id=new.company_id and team_member_id=new.id and account_type='employee_wallet';
    if not found then
      insert into money_accounts(company_id,account_type,name,team_member_id,opening_balance)
      values(new.company_id,'employee_wallet',new.name||' · Wallet',new.id,0)
      on conflict do nothing;
    end if;
  else
    update money_accounts set active=false where company_id=new.company_id and team_member_id=new.id and account_type='employee_wallet';
  end if;
  return new;
end $$;
drop trigger if exists team_member_wallet_trigger on public.team_members;
create trigger team_member_wallet_trigger after insert or update of name,active
on public.team_members for each row execute function public.ensure_team_wallet();

create or replace view public.money_account_balances as
select a.id,a.company_id,a.account_type,a.name,a.bank_name,a.account_number,a.team_member_id,
  a.opening_balance,
  a.opening_balance
    +coalesce(sum(case when m.status='posted' and m.to_account_id=a.id then m.amount else 0 end),0)
    -coalesce(sum(case when m.status='posted' and m.from_account_id=a.id then m.amount else 0 end),0) as balance,
  a.active,a.created_at
from public.money_accounts a
left join public.money_movements m on m.from_account_id=a.id or m.to_account_id=a.id
group by a.id;

create or replace function public.record_money_transfer(
  p_company_id uuid,p_fiscal_year_id uuid,p_from_account_id uuid,p_to_account_id uuid,
  p_amount numeric,p_date date,p_title text,p_notes text default '',p_generated_by uuid default null,
  p_approved_by uuid default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare movement_id uuid;
begin
  if p_amount<=0 then raise exception 'Amount must be greater than zero'; end if;
  if p_from_account_id=p_to_account_id then raise exception 'Source and destination must be different'; end if;
  if not exists(select 1 from money_accounts where id=p_from_account_id and company_id=p_company_id and active) then raise exception 'Invalid source account'; end if;
  if not exists(select 1 from money_accounts where id=p_to_account_id and company_id=p_company_id and active) then raise exception 'Invalid destination account'; end if;
  insert into money_movements(company_id,fiscal_year_id,movement_date,movement_type,from_account_id,to_account_id,amount,payment_mode,generated_by,approved_by,title,notes,status,posted_at)
  values(p_company_id,p_fiscal_year_id,p_date,'internal_transfer',p_from_account_id,p_to_account_id,p_amount,'Internal transfer',p_generated_by,p_approved_by,p_title,p_notes,'posted',now())
  returning id into movement_id;
  return movement_id;
end $$;

drop function if exists public.record_accounting_voucher(uuid,uuid,uuid,text,numeric,date,text,text);
create or replace function public.record_accounting_voucher(
  p_company_id uuid,p_fiscal_year_id uuid,p_party_id uuid,p_type text,p_amount numeric,
  p_date date,p_narration text default '',p_payment_mode text default null,
  p_generated_by uuid default null,p_handled_by uuid default null,p_money_account_id uuid default null,
  p_movement_status text default 'posted'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer; ref text; v_id uuid; movement_kind text; source_id uuid; destination_id uuid;
begin
  if p_amount<=0 then raise exception 'Amount must be greater than zero'; end if;
  if p_type not in ('receipt','payment','expense','sale','purchase','journal') then raise exception 'Invalid voucher type'; end if;
  if (select status from fiscal_years where id=p_fiscal_year_id)='closed' then raise exception 'Fiscal year is closed'; end if;
  if p_money_account_id is not null and not exists(select 1 from money_accounts where id=p_money_account_id and company_id=p_company_id and active) then raise exception 'Invalid cash or bank account'; end if;
  insert into voucher_sequences(fiscal_year_id,voucher_type,last_number) values(p_fiscal_year_id,p_type,1)
    on conflict(fiscal_year_id,voucher_type) do update set last_number=voucher_sequences.last_number+1 returning last_number into n;
  ref:=n::text;
  insert into vouchers(company_id,party_id,voucher_type,voucher_no,voucher_date,payment_mode,narration,total,fiscal_year_id,sequence_no,generated_by,handled_by,money_account_id)
  values(p_company_id,p_party_id,p_type,ref,p_date,p_payment_mode,p_narration,p_amount,p_fiscal_year_id,n,p_generated_by,p_handled_by,p_money_account_id) returning id into v_id;
  if p_type='sale' then
    insert into ledger_entries(company_id,party_id,voucher_id,entry_date,account_name,debit,credit) values(p_company_id,p_party_id,v_id,p_date,'Party Account',p_amount,0);
  elsif p_type='receipt' then
    insert into ledger_entries(company_id,party_id,voucher_id,entry_date,account_name,debit,credit) values(p_company_id,p_party_id,v_id,p_date,'Party Account',0,p_amount);
  elsif p_type='purchase' then
    insert into ledger_entries(company_id,party_id,voucher_id,entry_date,account_name,debit,credit) values(p_company_id,p_party_id,v_id,p_date,'Purchase Account',0,p_amount);
  elsif p_type='payment' then
    insert into ledger_entries(company_id,party_id,voucher_id,entry_date,account_name,debit,credit) values(p_company_id,p_party_id,v_id,p_date,'Supplier Payment',p_amount,0);
  elsif p_type='expense' then
    insert into ledger_entries(company_id,party_id,voucher_id,entry_date,account_name,debit,credit) values(p_company_id,p_party_id,v_id,p_date,'Expense Account',p_amount,0);
  end if;
  if p_money_account_id is not null and p_type in ('receipt','payment','expense') then
    if p_type='receipt' then movement_kind:='customer_receipt';destination_id:=p_money_account_id;
    elsif p_type='payment' then movement_kind:='outgoing_payment';source_id:=p_money_account_id;
    else movement_kind:='expense';source_id:=p_money_account_id;end if;
    insert into money_movements(company_id,fiscal_year_id,voucher_id,movement_date,movement_type,from_account_id,to_account_id,amount,payment_mode,party_id,handled_by,generated_by,title,reference,notes,status,posted_at)
    values(p_company_id,p_fiscal_year_id,v_id,p_date,movement_kind,source_id,destination_id,p_amount,p_payment_mode,p_party_id,p_handled_by,p_generated_by,coalesce(nullif(p_narration,''),case when p_type='receipt' then 'Payment received' when p_type='payment' then 'Payment given' else 'Expense' end),ref,p_narration,p_movement_status,case when p_movement_status='posted' then now() else null end);
  end if;
  return jsonb_build_object('id',v_id,'voucher_no',ref,'sequence_no',n);
end $$;
