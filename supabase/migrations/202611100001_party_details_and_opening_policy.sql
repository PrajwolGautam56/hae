-- Party contact corrections do not modify bills, ledger entries or opening balances.
alter table public.parties add column profile_revision integer not null default 1;
create table public.party_detail_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  party_id uuid not null references public.parties(id),
  actor_id uuid not null references public.team_members(id),
  before_data jsonb not null,after_data jsonb not null,
  changed_at timestamptz not null default now()
);
create index party_detail_audit_party_idx on public.party_detail_audit(company_id,party_id,changed_at desc);
alter table public.party_detail_audit enable row level security;
revoke all on public.party_detail_audit from public,anon,authenticated;
grant all on public.party_detail_audit to service_role;

create or replace function public.bump_party_profile_revision() returns trigger
language plpgsql set search_path=public as $$
begin
  if row(new.name,new.place,new.address,new.phone,new.tax_no) is distinct from row(old.name,old.place,old.address,old.phone,old.tax_no) then
    new.profile_revision:=old.profile_revision+1;
  end if;
  return new;
end $$;
create trigger party_profile_revision before update on public.parties for each row execute function public.bump_party_profile_revision();

create or replace function public.update_party_details(
  p_company_id uuid,p_party_id uuid,p_member_id uuid,p_name text,p_address text,p_phone text,p_tax_no text,p_expected_revision integer
) returns jsonb language plpgsql security definer set search_path=public as $$
declare old_party parties%rowtype; edited parties%rowtype; before_value jsonb; after_value jsonb;
begin
  if not exists(select 1 from team_members where id=p_member_id and company_id=p_company_id and active and role in ('admin','manager','accountant')) then raise exception 'Only an administrator, manager or accountant can edit party details'; end if;
  if nullif(trim(p_name),'') is null or length(p_name)>250 then raise exception 'Party name is required (up to 250 characters)'; end if;
  if length(coalesce(p_address,''))>1000 or length(coalesce(p_phone,''))>60 or length(coalesce(p_tax_no,''))>50 then raise exception 'Party contact details are too long'; end if;
  select * into old_party from parties where id=p_party_id and company_id=p_company_id for update;
  if not found then raise exception 'Party does not belong to this company'; end if;
  if p_expected_revision is null or p_expected_revision<>old_party.profile_revision then raise exception 'Another user changed this party. Reopen the editor and review the latest details'; end if;
  before_value:=jsonb_build_object('name',old_party.name,'address',old_party.address,'place',old_party.place,'phone',old_party.phone,'tax_no',old_party.tax_no,'profile_revision',old_party.profile_revision);
  update parties set name=trim(p_name),place=trim(coalesce(p_address,'')),address=trim(coalesce(p_address,'')),
    phone=trim(coalesce(p_phone,'')),tax_no=nullif(trim(coalesce(p_tax_no,'')),'')
    where id=p_party_id and company_id=p_company_id returning * into edited;
  after_value:=jsonb_build_object('id',edited.id,'name',edited.name,'address',edited.address,'place',edited.place,'phone',edited.phone,'tax_no',edited.tax_no,'profile_revision',edited.profile_revision);
  if edited.profile_revision<>old_party.profile_revision then
    insert into party_detail_audit(company_id,party_id,actor_id,before_data,after_data) values(p_company_id,p_party_id,p_member_id,before_value,after_value);
  end if;
  return after_value;
end $$;

-- Imported balances are only for a party with no earlier-year records in this software.
create or replace function public.party_has_prior_records(p_company_id uuid,p_fiscal_year_id uuid,p_party_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from fiscal_years fy where fy.id=p_fiscal_year_id and fy.company_id=p_company_id and (
    exists(select 1 from ledger_entries le where le.company_id=p_company_id and le.party_id=p_party_id and le.entry_date<fy.start_ad)
    or exists(select 1 from vouchers v where v.company_id=p_company_id and v.party_id=p_party_id and v.voucher_date<fy.start_ad and v.document_status='posted')
    or exists(select 1 from party_opening_balances ob join fiscal_years prior on prior.id=ob.fiscal_year_id
      where ob.party_id=p_party_id and prior.company_id=p_company_id and prior.start_ad<fy.start_ad and (ob.amount<>0 or ob.balance_source='manual'))
  ));
$$;

create or replace function public.get_party_opening_balance(p_company_id uuid,p_fiscal_year_id uuid,p_party_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fy fiscal_years%rowtype; prior fiscal_years%rowtype; party parties%rowtype; op party_opening_balances%rowtype; automatic numeric; has_history boolean;
begin
  select * into fy from fiscal_years where id=p_fiscal_year_id and company_id=p_company_id;
  if not found then raise exception 'Fiscal year does not belong to this company'; end if;
  select * into party from parties where id=p_party_id and company_id=p_company_id;
  if not found then raise exception 'Party does not belong to this company'; end if;
  select * into op from party_opening_balances where fiscal_year_id=fy.id and party_id=party.id;
  select * into prior from fiscal_years where company_id=p_company_id and end_ad<fy.start_ad order by end_ad desc limit 1;
  if prior.id is not null then
    select coalesce((select amount from party_opening_balances where fiscal_year_id=prior.id and party_id=party.id),party.opening_balance,0)
      +coalesce(sum(debit-credit),0) into automatic from ledger_entries
      where company_id=p_company_id and party_id=party.id and entry_date between prior.start_ad and prior.end_ad;
  else automatic:=coalesce(party.opening_balance,0); end if;
  has_history:=party_has_prior_records(p_company_id,p_fiscal_year_id,p_party_id);
  return jsonb_build_object('amount',coalesce(op.amount,party.opening_balance,0),'source',coalesce(op.balance_source,'legacy'),
    'note',coalesce(op.note,''),'revision',coalesce(op.revision,0),'automaticAmount',automatic,'priorYear',prior.label_bs,
    'fiscalYearLabel',fy.label_bs,'startDate',fy.start_ad,'partyName',party.name,'updatedAt',op.updated_at,
    'hasPriorRecords',has_history,'canImportManual',not has_history);
end $$;

create or replace function public.set_party_opening_balance(
  p_company_id uuid,p_fiscal_year_id uuid,p_party_id uuid,p_member_id uuid,p_amount numeric,p_source text,p_note text,p_expected_revision integer
) returns jsonb language plpgsql security definer set search_path=public as $$
declare old_state jsonb; new_state jsonb; target numeric; kind text;
begin
  if not exists(select 1 from team_members where id=p_member_id and company_id=p_company_id and active and role in ('admin','manager','accountant')) then raise exception 'Only an administrator, manager or accountant can change opening balances'; end if;
  if p_source is null or p_source not in ('manual','automatic') then raise exception 'Choose manual or automatic opening'; end if;
  if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or abs(p_amount)>=10000000000000000 or p_amount<>round(p_amount,2) then raise exception 'Enter a valid opening amount with at most two decimal places'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
  old_state:=get_party_opening_balance(p_company_id,p_fiscal_year_id,p_party_id);
  if p_expected_revision is null or p_expected_revision<>(old_state->>'revision')::integer then raise exception 'Another user changed this opening balance. Reopen the editor and review the latest value'; end if;
  if p_source='manual' and (old_state->>'hasPriorRecords')::boolean then raise exception 'This party has earlier-year records in this software. Use the previous-year closing balance; an external opening cannot be added'; end if;
  target:=case when p_source='manual' then p_amount else (old_state->>'automaticAmount')::numeric end;
  kind:=case when p_source='manual' then 'manual' when old_state->>'priorYear' is not null then 'carry_forward' else 'legacy' end;
  insert into party_opening_balances(fiscal_year_id,party_id,amount,balance_source,note,updated_by)
    values(p_fiscal_year_id,p_party_id,target,kind,case when p_source='manual' then coalesce(trim(p_note),'') else '' end,p_member_id)
    on conflict(fiscal_year_id,party_id) do update set amount=excluded.amount,balance_source=excluded.balance_source,note=excluded.note,
      updated_by=p_member_id,updated_at=now(),revision=party_opening_balances.revision+1;
  new_state:=get_party_opening_balance(p_company_id,p_fiscal_year_id,p_party_id);
  insert into party_opening_balance_audit(company_id,fiscal_year_id,party_id,actor_id,before_data,after_data) values(p_company_id,p_fiscal_year_id,p_party_id,p_member_id,old_state,new_state);
  perform refresh_future_opening_balances(p_company_id,p_fiscal_year_id);
  return new_state;
end $$;

-- If earlier history is later entered, carry its closing forward; retain the replaced baseline in audit.
alter table public.party_opening_balance_audit alter column actor_id drop not null;
alter table public.party_opening_balance_audit add column change_type text not null default 'manual';
create or replace function public.refresh_future_opening_balances(p_company_id uuid,p_from_fiscal_year_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare source_fy fiscal_years%rowtype; target_fy fiscal_years%rowtype; replaced record; carried numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
  select * into source_fy from fiscal_years where id=p_from_fiscal_year_id and company_id=p_company_id;
  if source_fy.id is null then raise exception 'Source fiscal year not found'; end if;
  for target_fy in select * from fiscal_years where company_id=p_company_id and start_ad>source_fy.start_ad order by start_ad loop
    for replaced in select ob.* from party_opening_balances ob join parties p on p.id=ob.party_id
      where ob.fiscal_year_id=target_fy.id and p.company_id=p_company_id and ob.balance_source='manual'
        and party_has_prior_records(p_company_id,target_fy.id,p.id)
    loop
      select coalesce((select amount from party_opening_balances where fiscal_year_id=source_fy.id and party_id=replaced.party_id),p.opening_balance,0)
        +coalesce((select sum(debit-credit) from ledger_entries where company_id=p_company_id and party_id=p.id and entry_date between source_fy.start_ad and source_fy.end_ad),0)
        into carried from parties p where p.id=replaced.party_id;
      insert into party_opening_balance_audit(company_id,fiscal_year_id,party_id,actor_id,before_data,after_data,change_type)
        values(p_company_id,target_fy.id,replaced.party_id,null,to_jsonb(replaced),jsonb_build_object('amount',carried,'source','carry_forward','reason','Earlier-year records now exist in this software'),'automatic_carry_forward');
    end loop;
    insert into party_opening_balances(fiscal_year_id,party_id,amount,balance_source,note)
      select target_fy.id,p.id,coalesce(ob.amount,p.opening_balance,0)+coalesce(sum(le.debit-le.credit),0),'carry_forward',''
      from parties p left join party_opening_balances ob on ob.party_id=p.id and ob.fiscal_year_id=source_fy.id
      left join ledger_entries le on le.company_id=p_company_id and le.party_id=p.id and le.entry_date between source_fy.start_ad and source_fy.end_ad
      where p.company_id=p_company_id group by p.id,ob.amount,p.opening_balance
      on conflict(fiscal_year_id,party_id) do update set amount=excluded.amount,balance_source='carry_forward',
        note=case when party_opening_balances.balance_source='manual' then 'Opening now follows earlier-year records in this software; original imported amount retained in audit.' else party_opening_balances.note end,
        updated_at=now(),updated_by=null,revision=party_opening_balances.revision+1
      where (party_opening_balances.balance_source<>'manual' or party_has_prior_records(p_company_id,target_fy.id,party_opening_balances.party_id))
        and (party_opening_balances.amount is distinct from excluded.amount or party_opening_balances.balance_source<>'carry_forward');
    source_fy:=target_fy;
  end loop;
end $$;

revoke all on function public.update_party_details(uuid,uuid,uuid,text,text,text,text,integer),public.party_has_prior_records(uuid,uuid,uuid),public.bump_party_profile_revision() from public,anon,authenticated;
grant execute on function public.update_party_details(uuid,uuid,uuid,text,text,text,text,integer),public.party_has_prior_records(uuid,uuid,uuid),public.bump_party_profile_revision() to service_role;
