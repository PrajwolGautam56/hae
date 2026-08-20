-- Optional structured Nepal locations for leads and converted parties.
alter table public.leads add column if not exists province text;
alter table public.leads add column if not exists district text;
alter table public.leads add column if not exists city text;
alter table public.leads add column if not exists address text;

alter table public.parties add column if not exists province text;
alter table public.parties add column if not exists district text;
alter table public.parties add column if not exists city text;
alter table public.parties add column if not exists address text;

create index if not exists leads_company_province_district_idx on public.leads(company_id,province,district);
create index if not exists leads_company_city_idx on public.leads(company_id,city);

create or replace function public.convert_lead_to_party(p_lead_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare l leads%rowtype; party uuid;
begin
  select * into l from leads where id=p_lead_id for update;
  if l.id is null then raise exception 'Lead not found'; end if;
  if l.converted_party_id is not null then return l.converted_party_id; end if;
  insert into parties(company_id,name,phone,party_type,place,province,district,city,address)
  values(l.company_id,l.name,l.phone,'customer',coalesce(nullif(l.city,''),nullif(l.district,''),nullif(l.province,'')),l.province,l.district,l.city,l.address)
  on conflict(company_id,name) do update set
    phone=excluded.phone,
    place=coalesce(excluded.place,parties.place),
    province=coalesce(excluded.province,parties.province),
    district=coalesce(excluded.district,parties.district),
    city=coalesce(excluded.city,parties.city),
    address=coalesce(excluded.address,parties.address)
  returning id into party;
  update leads set status='won',converted_party_id=party,updated_at=now() where id=p_lead_id;
  insert into crm_activities(company_id,activity_type,subject,remarks,lead_id,party_id,happened_at)
  values(l.company_id,'status_change','Lead converted','Lead converted to customer/party',p_lead_id,party,now());
  return party;
end $$;

revoke all on function public.convert_lead_to_party(uuid) from public,anon,authenticated;
grant execute on function public.convert_lead_to_party(uuid) to service_role;
