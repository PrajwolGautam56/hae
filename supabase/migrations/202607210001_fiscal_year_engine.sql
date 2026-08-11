create table if not exists public.fiscal_years (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  label_bs text not null, start_ad date not null, end_ad date not null,
  status text not null default 'open' check(status in ('open','closed')), unique(company_id,label_bs)
);
create table if not exists public.party_opening_balances (
  fiscal_year_id uuid not null references public.fiscal_years(id) on delete cascade,
  party_id uuid not null references public.parties(id) on delete cascade,
  amount numeric(18,2) not null default 0, primary key(fiscal_year_id,party_id)
);
create table if not exists public.voucher_sequences (
  fiscal_year_id uuid not null references public.fiscal_years(id) on delete cascade,
  voucher_type text not null, last_number integer not null default 0,
  primary key(fiscal_year_id,voucher_type)
);
alter table public.vouchers add column if not exists fiscal_year_id uuid references public.fiscal_years(id);
alter table public.vouchers add column if not exists sequence_no integer;
alter table public.fiscal_years enable row level security;
alter table public.party_opening_balances enable row level security;
alter table public.voucher_sequences enable row level security;

do $$
declare c uuid; fy_old uuid; fy_current uuid;
begin
  select id into c from public.companies order by created_at limit 1;
  insert into public.fiscal_years(company_id,label_bs,start_ad,end_ad,status) values
    (c,'2082/83','2025-07-17','2026-07-16','closed'),(c,'2083/84','2026-07-17','2027-07-16','open')
    on conflict(company_id,label_bs) do nothing;
  select id into fy_current from public.fiscal_years where company_id=c and label_bs='2083/84';
  insert into public.parties(company_id,name,place,opening_balance) values
    (c,'Tashi Delek Traders','Phuentsholing',1842500),(c,'Druk Hardware House','Thimphu',785400),
    (c,'Karma General Store','Gelephu',346800),(c,'Norbu Enterprise','Paro',-124000)
    on conflict(company_id,name) do nothing;
  insert into public.party_opening_balances(fiscal_year_id,party_id,amount)
    select fy_current,id,opening_balance from public.parties where company_id=c
    on conflict(fiscal_year_id,party_id) do nothing;
end $$;

create or replace function public.record_accounting_voucher(
  p_company_id uuid,p_fiscal_year_id uuid,p_party_id uuid,p_type text,p_amount numeric,
  p_date date,p_narration text default '',p_payment_mode text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer; prefix text; ref text; v_id uuid; fy_label text;
begin
  if p_amount<=0 then raise exception 'Amount must be greater than zero'; end if;
  if (select status from fiscal_years where id=p_fiscal_year_id)='closed' then raise exception 'Fiscal year is closed'; end if;
  insert into voucher_sequences(fiscal_year_id,voucher_type,last_number) values(p_fiscal_year_id,p_type,1)
    on conflict(fiscal_year_id,voucher_type) do update set last_number=voucher_sequences.last_number+1
    returning last_number into n;
  select label_bs into fy_label from fiscal_years where id=p_fiscal_year_id;
  prefix:=case p_type when 'sale' then 'INV' when 'receipt' then 'REC' when 'purchase' then 'PUR' when 'expense' then 'EXP' else 'JRN' end;
  ref:=prefix||'-'||fy_label||'-'||lpad(n::text,4,'0');
  insert into vouchers(company_id,party_id,voucher_type,voucher_no,voucher_date,payment_mode,narration,total,fiscal_year_id,sequence_no)
    values(p_company_id,p_party_id,p_type,ref,p_date,p_payment_mode,p_narration,p_amount,p_fiscal_year_id,n) returning id into v_id;
  if p_type='sale' then
    insert into ledger_entries(company_id,party_id,voucher_id,entry_date,account_name,debit,credit) values(p_company_id,p_party_id,v_id,p_date,'Party Account',p_amount,0);
  elsif p_type='receipt' then
    insert into ledger_entries(company_id,party_id,voucher_id,entry_date,account_name,debit,credit) values(p_company_id,p_party_id,v_id,p_date,'Party Account',0,p_amount);
  elsif p_type in ('purchase','expense') then
    insert into ledger_entries(company_id,party_id,voucher_id,entry_date,account_name,debit,credit) values(p_company_id,p_party_id,v_id,p_date,case when p_type='expense' then 'Expense Account' else 'Purchase Account' end,p_amount,0);
  end if;
  return jsonb_build_object('id',v_id,'voucher_no',ref,'sequence_no',n);
end $$;
