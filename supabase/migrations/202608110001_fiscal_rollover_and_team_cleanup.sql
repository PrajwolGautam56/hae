create table if not exists public.nepali_fiscal_calendar (
  label_bs text primary key,
  start_ad date not null unique,
  end_ad date not null unique,
  check (start_ad <= end_ad)
);

insert into public.nepali_fiscal_calendar(label_bs,start_ad,end_ad) values
  ('2082/83','2025-07-17','2026-07-16'),
  ('2083/84','2026-07-17','2027-07-16'),
  ('2084/85','2027-07-17','2028-07-15'),
  ('2085/86','2028-07-16','2029-07-16'),
  ('2086/87','2029-07-17','2030-07-16'),
  ('2087/88','2030-07-17','2031-07-16'),
  ('2088/89','2031-07-17','2032-07-15'),
  ('2089/90','2032-07-16','2033-07-15')
on conflict(label_bs) do update set start_ad=excluded.start_ad,end_ad=excluded.end_ad;

alter table public.nepali_fiscal_calendar enable row level security;

create or replace function public.ensure_fiscal_year_for_date(p_company_id uuid,p_date date default current_date)
returns uuid language plpgsql security definer set search_path=public as $$
declare cal nepali_fiscal_calendar%rowtype; fy uuid; previous_fy uuid;
begin
  select * into cal from nepali_fiscal_calendar where p_date between start_ad and end_ad;
  if cal.label_bs is null then raise exception 'Nepali fiscal calendar is not configured for %',p_date; end if;

  select id into fy from fiscal_years where company_id=p_company_id and label_bs=cal.label_bs;
  if fy is null then
    select id into previous_fy from fiscal_years
      where company_id=p_company_id and end_ad<cal.start_ad order by end_ad desc limit 1;
    insert into fiscal_years(company_id,label_bs,start_ad,end_ad,status)
      values(p_company_id,cal.label_bs,cal.start_ad,cal.end_ad,'open') returning id into fy;
    if previous_fy is not null then
      insert into party_opening_balances(fiscal_year_id,party_id,amount)
      select fy,p.id,
        coalesce(ob.amount,p.opening_balance,0)+coalesce(sum(le.debit-le.credit),0)
      from parties p
      left join party_opening_balances ob on ob.party_id=p.id and ob.fiscal_year_id=previous_fy
      left join ledger_entries le on le.party_id=p.id and le.entry_date between
        (select start_ad from fiscal_years where id=previous_fy) and
        (select end_ad from fiscal_years where id=previous_fy)
      where p.company_id=p_company_id
      group by p.id,ob.amount,p.opening_balance
      on conflict(fiscal_year_id,party_id) do nothing;
    end if;
  end if;
  update fiscal_years set status=case when id=fy then 'open' else 'closed' end
    where company_id=p_company_id;
  return fy;
end $$;

create or replace function public.validate_voucher_fiscal_date()
returns trigger language plpgsql set search_path=public as $$
declare fy fiscal_years%rowtype;
begin
  select * into fy from fiscal_years where id=new.fiscal_year_id;
  if fy.id is null then raise exception 'Fiscal year is required'; end if;
  if new.company_id<>fy.company_id then raise exception 'Voucher company does not match fiscal year'; end if;
  if new.voucher_date not between fy.start_ad and fy.end_ad then
    raise exception 'Voucher date % is outside fiscal year % (% to %)',new.voucher_date,fy.label_bs,fy.start_ad,fy.end_ad;
  end if;
  if fy.status='closed' then raise exception 'Fiscal year % is closed',fy.label_bs; end if;
  return new;
end $$;

drop trigger if exists vouchers_validate_fiscal_date on public.vouchers;
create trigger vouchers_validate_fiscal_date before insert or update of fiscal_year_id,voucher_date
on public.vouchers for each row execute function public.validate_voucher_fiscal_date();

update public.team_members
set name='Prajwol Gautam',email='prajwolgautam56@gmail.com',role='admin',active=true
where email='prajwol@hamrokhata.local' or name='Prajwol Gautam';

delete from public.team_members
where email in ('manager@hamrokhata.local','accounts@hamrokhata.local','field@hamrokhata.local');
