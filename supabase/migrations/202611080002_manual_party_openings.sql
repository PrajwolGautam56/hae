-- Imported opening balances are explicit fiscal-year baselines, not sales/receipts.
alter table public.party_opening_balances
  add column if not exists balance_source text not null default 'legacy'
    check(balance_source in ('legacy','manual','carry_forward')),
  add column if not exists note text not null default '',
  add column if not exists revision integer not null default 1,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.team_members(id);

create table public.party_opening_balance_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  fiscal_year_id uuid not null references public.fiscal_years(id),
  party_id uuid not null references public.parties(id),
  actor_id uuid not null references public.team_members(id),
  before_data jsonb not null,
  after_data jsonb not null,
  changed_at timestamptz not null default now()
);
alter table public.party_opening_balance_audit enable row level security;
create index party_opening_balance_audit_party_idx on public.party_opening_balance_audit(company_id,party_id,changed_at desc);
revoke all on public.party_opening_balance_audit from public,anon,authenticated;
grant all on public.party_opening_balance_audit to service_role;

create or replace function public.get_party_opening_balance(
  p_company_id uuid,p_fiscal_year_id uuid,p_party_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare fy fiscal_years%rowtype; prior fiscal_years%rowtype;
  party parties%rowtype; op party_opening_balances%rowtype; automatic numeric;
begin
  select * into fy from fiscal_years where id=p_fiscal_year_id and company_id=p_company_id;
  if not found then raise exception 'Fiscal year does not belong to this company'; end if;
  select * into party from parties where id=p_party_id and company_id=p_company_id;
  if not found then raise exception 'Party does not belong to this company'; end if;
  select * into op from party_opening_balances where fiscal_year_id=fy.id and party_id=party.id;
  select * into prior from fiscal_years where company_id=p_company_id and end_ad<fy.start_ad order by end_ad desc limit 1;
  if prior.id is not null then
    select coalesce((select amount from party_opening_balances where fiscal_year_id=prior.id and party_id=party.id),party.opening_balance,0)
      +coalesce(sum(debit-credit),0) into automatic
      from ledger_entries where company_id=p_company_id and party_id=party.id and entry_date between prior.start_ad and prior.end_ad;
  else automatic:=coalesce(party.opening_balance,0); end if;
  return jsonb_build_object('amount',coalesce(op.amount,party.opening_balance,0),
    'source',coalesce(op.balance_source,'legacy'),'note',coalesce(op.note,''),
    'revision',coalesce(op.revision,0),'automaticAmount',automatic,
    'priorYear',prior.label_bs,'fiscalYearLabel',fy.label_bs,'startDate',fy.start_ad,
    'partyName',party.name,'updatedAt',op.updated_at);
end $$;

-- A manual baseline survives historical-entry recalculation. Other years follow closing balances.
create or replace function public.refresh_future_opening_balances(p_company_id uuid,p_from_fiscal_year_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare source_fy fiscal_years%rowtype; target_fy fiscal_years%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
  select * into source_fy from fiscal_years where id=p_from_fiscal_year_id and company_id=p_company_id;
  if source_fy.id is null then raise exception 'Source fiscal year not found'; end if;
  for target_fy in select * from fiscal_years where company_id=p_company_id and start_ad>source_fy.start_ad order by start_ad loop
    insert into party_opening_balances(fiscal_year_id,party_id,amount,balance_source,note)
    select target_fy.id,p.id,coalesce(ob.amount,p.opening_balance,0)+coalesce(sum(le.debit-le.credit),0),'carry_forward',''
    from parties p
    left join party_opening_balances ob on ob.party_id=p.id and ob.fiscal_year_id=source_fy.id
    left join ledger_entries le on le.company_id=p_company_id and le.party_id=p.id and le.entry_date between source_fy.start_ad and source_fy.end_ad
    where p.company_id=p_company_id group by p.id,ob.amount,p.opening_balance
    on conflict(fiscal_year_id,party_id) do update set amount=excluded.amount,balance_source='carry_forward',note='',
      updated_at=now(),updated_by=null,revision=party_opening_balances.revision+1
    where party_opening_balances.balance_source<>'manual'
      and (party_opening_balances.amount is distinct from excluded.amount or party_opening_balances.balance_source<>'carry_forward');
    source_fy:=target_fy;
  end loop;
end $$;

create or replace function public.set_party_opening_balance(
  p_company_id uuid,p_fiscal_year_id uuid,p_party_id uuid,p_member_id uuid,
  p_amount numeric,p_source text,p_note text,p_expected_revision integer
) returns jsonb language plpgsql security definer set search_path=public as $$
declare old_state jsonb; new_state jsonb; target numeric; kind text;
begin
  if not exists(select 1 from team_members where id=p_member_id and company_id=p_company_id and active and role in ('admin','manager','accountant')) then
    raise exception 'Only an administrator, manager or accountant can change opening balances';
  end if;
  if p_source is null or p_source not in ('manual','automatic') then raise exception 'Choose manual or automatic opening'; end if;
  if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or abs(p_amount)>=10000000000000000 or p_amount<>round(p_amount,2) then
    raise exception 'Enter a valid opening amount with at most two decimal places';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
  old_state:=get_party_opening_balance(p_company_id,p_fiscal_year_id,p_party_id);
  if p_expected_revision is null or p_expected_revision<>(old_state->>'revision')::integer then
    raise exception 'Another user changed this opening balance. Reopen the editor and review the latest value';
  end if;
  target:=case when p_source='manual' then p_amount else (old_state->>'automaticAmount')::numeric end;
  kind:=case when p_source='manual' then 'manual' when old_state->>'priorYear' is not null then 'carry_forward' else 'legacy' end;
  insert into party_opening_balances(fiscal_year_id,party_id,amount,balance_source,note,updated_by)
    values(p_fiscal_year_id,p_party_id,target,kind,case when p_source='manual' then coalesce(trim(p_note),'') else '' end,p_member_id)
    on conflict(fiscal_year_id,party_id) do update set amount=excluded.amount,balance_source=excluded.balance_source,
      note=excluded.note,updated_by=p_member_id,updated_at=now(),revision=party_opening_balances.revision+1;
  new_state:=get_party_opening_balance(p_company_id,p_fiscal_year_id,p_party_id);
  insert into party_opening_balance_audit(company_id,fiscal_year_id,party_id,actor_id,before_data,after_data)
    values(p_company_id,p_fiscal_year_id,p_party_id,p_member_id,old_state,new_state);
  perform refresh_future_opening_balances(p_company_id,p_fiscal_year_id);
  return new_state;
end $$;

create or replace function public.ensure_fiscal_year_for_date(p_company_id uuid,p_date date default current_date)
returns uuid language plpgsql security definer set search_path=public as $$
declare cal nepali_fiscal_calendar%rowtype; fy uuid; previous_fy uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
  select * into cal from nepali_fiscal_calendar where p_date between start_ad and end_ad;
  if cal.label_bs is null then raise exception 'Nepali fiscal calendar is not configured for %',p_date; end if;
  select id into fy from fiscal_years where company_id=p_company_id and label_bs=cal.label_bs;
  if fy is null then
    select id into previous_fy from fiscal_years where company_id=p_company_id and end_ad<cal.start_ad order by end_ad desc limit 1;
    insert into fiscal_years(company_id,label_bs,start_ad,end_ad,status)
      values(p_company_id,cal.label_bs,cal.start_ad,cal.end_ad,'open') returning id into fy;
    if previous_fy is not null then
      perform refresh_future_opening_balances(p_company_id,previous_fy);
    end if;
  end if;
  update fiscal_years set status=case when id=fy then 'open' else 'closed' end where company_id=p_company_id;
  return fy;
end $$;

revoke all on function public.get_party_opening_balance(uuid,uuid,uuid),public.set_party_opening_balance(uuid,uuid,uuid,uuid,numeric,text,text,integer) from public,anon,authenticated;
grant execute on function public.get_party_opening_balance(uuid,uuid,uuid),public.set_party_opening_balance(uuid,uuid,uuid,uuid,numeric,text,text,integer) to service_role;
revoke all on function public.refresh_future_opening_balances(uuid,uuid),public.ensure_fiscal_year_for_date(uuid,date) from public,anon,authenticated;
grant execute on function public.refresh_future_opening_balances(uuid,uuid),public.ensure_fiscal_year_for_date(uuid,date) to service_role;

-- Creating a party with an imported opening is also atomic; never overwrite an existing party's baseline by name.
create or replace function public.create_party_with_opening(
  p_company_id uuid,p_fiscal_year_id uuid,p_member_id uuid,p_name text,p_place text,
  p_phone text,p_tax_no text,p_party_type text,p_amount numeric
) returns uuid language plpgsql security definer set search_path=public as $$
declare party_id uuid;
begin
  if not exists(select 1 from team_members where id=p_member_id and company_id=p_company_id and active) then raise exception 'Active company member is required'; end if;
  if not exists(select 1 from fiscal_years where id=p_fiscal_year_id and company_id=p_company_id) then raise exception 'Fiscal year does not belong to this company'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'Party name is required'; end if;
  if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or abs(p_amount)>=10000000000000000 or p_amount<>round(p_amount,2) then raise exception 'Enter a valid opening balance'; end if;
  if p_amount<>0 and not exists(select 1 from team_members where id=p_member_id and role in ('admin','manager','accountant')) then raise exception 'Only an administrator, manager or accountant can enter an opening balance'; end if;
  insert into parties(company_id,name,place,phone,tax_no,party_type,opening_balance)
    values(p_company_id,trim(p_name),coalesce(p_place,''),coalesce(p_phone,''),nullif(p_tax_no,''),p_party_type,0) returning id into party_id;
  if p_amount<>0 then
    perform set_party_opening_balance(p_company_id,p_fiscal_year_id,party_id,p_member_id,p_amount,'manual','Opening entered when party was created',0);
  end if;
  return party_id;
end $$;
revoke all on function public.create_party_with_opening(uuid,uuid,uuid,text,text,text,text,text,numeric) from public,anon,authenticated;
grant execute on function public.create_party_with_opening(uuid,uuid,uuid,text,text,text,text,text,numeric) to service_role;
