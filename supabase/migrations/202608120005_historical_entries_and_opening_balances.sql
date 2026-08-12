-- Allow authorised backdated entry inside the selected Nepali fiscal year.
-- The API uses the service role; UI labels older years as Historical.
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
  return new;
end $$;

-- Recalculate each later year's opening from the preceding year's closing.
create or replace function public.refresh_future_opening_balances(
  p_company_id uuid,p_from_fiscal_year_id uuid
) returns void language plpgsql security definer set search_path=public as $$
declare source_fy fiscal_years%rowtype; target_fy fiscal_years%rowtype;
begin
  select * into source_fy from fiscal_years where id=p_from_fiscal_year_id and company_id=p_company_id;
  if source_fy.id is null then raise exception 'Source fiscal year not found'; end if;
  for target_fy in
    select * from fiscal_years where company_id=p_company_id and start_ad>source_fy.start_ad order by start_ad
  loop
    insert into party_opening_balances(fiscal_year_id,party_id,amount)
    select target_fy.id,p.id,
      coalesce(ob.amount,p.opening_balance,0)+coalesce(sum(le.debit-le.credit),0)
    from parties p
    left join party_opening_balances ob on ob.party_id=p.id and ob.fiscal_year_id=source_fy.id
    left join ledger_entries le on le.party_id=p.id and le.entry_date between source_fy.start_ad and source_fy.end_ad
    where p.company_id=p_company_id
    group by p.id,ob.amount,p.opening_balance
    on conflict(fiscal_year_id,party_id) do update set amount=excluded.amount;
    source_fy:=target_fy;
  end loop;
end $$;

-- Existing voucher functions check status. Historical entry is an explicit supported workflow,
-- so status is temporarily opened transactionally by this wrapper and restored afterward.
create or replace function public.set_fiscal_year_entry_mode(p_fiscal_year_id uuid,p_open boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  update fiscal_years set status=case when p_open then 'open' else 'closed' end where id=p_fiscal_year_id;
end $$;
