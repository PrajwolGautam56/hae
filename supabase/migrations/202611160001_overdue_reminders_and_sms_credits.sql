-- SMS balances are service credits, NOT party or financial ledger balances.
-- Apply only to the unified business database after backup and approval.
alter table public.parties add column email text;
alter table public.parties add column auto_overdue_sms boolean not null default false;
alter table public.parties add column auto_overdue_email boolean not null default false;
alter table public.parties add column reminder_checked_at timestamptz;
alter table public.parties add column reminder_claim_until timestamptz;
create index party_reminder_scan_idx on public.parties(reminder_checked_at nulls first,id) where auto_overdue_sms or auto_overdue_email;

create table public.sms_credit_wallets (
  tenant_id uuid primary key references public.platform_tenants(id),
  balance bigint not null default 0 check(balance>=0),
  held bigint not null default 0 check(held>=0),
  spent bigint not null default 0 check(spent>=0),
  credited bigint not null default 0 check(credited>=0 and credited<=9007199254740991),
  enabled boolean not null default false,
  credits_per_segment integer check(credits_per_segment between 1 and 10000),
  updated_at timestamptz not null default now(),
  check(credited=balance+held+spent)
);
create table public.overdue_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.platform_tenants(id),
  company_id uuid not null references public.companies(id),
  party_id uuid not null,
  request_id uuid not null,
  channel text not null check(channel in ('sms','email')),
  automatic boolean not null,
  recipient text not null,
  message text not null,
  snapshot jsonb not null,
  segments integer not null check(segments between 0 and 20),
  credits bigint not null check(credits>=0),
  status text not null default 'reserved' check(status in ('reserved','accepted','failed','unknown')),
  provider_id text,
  detail text,
  requested_by uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(company_id,request_id),
  foreign key(company_id,party_id) references public.parties(company_id,id),
  foreign key(company_id,requested_by) references public.team_members(company_id,id)
);
create index overdue_reminder_party_idx on public.overdue_reminder_deliveries(company_id,party_id,channel,created_at desc);
create index overdue_reminder_tenant_idx on public.overdue_reminder_deliveries(tenant_id,created_at desc);
create table public.sms_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.platform_tenants(id),
  delivery_id uuid references public.overdue_reminder_deliveries(id),
  request_id uuid,
  kind text not null check(kind in ('topup','reserve','accepted','refund','settings','resolution')),
  available_delta bigint not null default 0,
  held_delta bigint not null default 0,
  spent_delta bigint not null default 0,
  paid_amount numeric(18,2),
  actor text not null,
  note text not null,
  request_payload jsonb,
  created_at timestamptz not null default now(),
  unique(tenant_id,request_id),
  unique(delivery_id,kind)
);
create index sms_credit_ledger_tenant_idx on public.sms_credit_ledger(tenant_id,created_at desc);
do $$ declare t text; begin
  foreach t in array array['sms_credit_wallets','overdue_reminder_deliveries','sms_credit_ledger'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;

-- Profile + notification preferences are one audited, optimistic-concurrency transaction.
create function public.update_party_details_with_reminders(
  p_company_id uuid,p_party_id uuid,p_member_id uuid,p_name text,p_address text,p_phone text,p_tax_no text,p_expected_revision integer,
  p_email text,p_auto_sms boolean,p_auto_email boolean
) returns jsonb language plpgsql security definer set search_path=public as $$
declare old_party parties%rowtype; edited parties%rowtype; result jsonb;
begin
  if not exists(select 1 from team_members where id=p_member_id and company_id=p_company_id and active and role in ('admin','manager','accountant')) then raise exception 'Company administrator, manager or accountant required'; end if;
  select * into old_party from parties where id=p_party_id and company_id=p_company_id for update;
  if not found then raise exception 'Party does not belong to this company'; end if;
  if p_email is not null and (length(p_email)>254 or p_email !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$') then raise exception 'Invalid email'; end if;
  if p_auto_email and nullif(p_email,'') is null then raise exception 'Email required for automatic reminders'; end if;
  if p_auto_sms and coalesce(regexp_replace(p_phone,'[[:space:]()+-]','','g'),'') !~ '^(977|00977)?9[678][0-9]{8}$' then raise exception 'Valid Nepal mobile number required'; end if;
  result:=update_party_details(p_company_id,p_party_id,p_member_id,p_name,p_address,p_phone,p_tax_no,p_expected_revision);
  update parties set email=nullif(lower(trim(p_email)),''),auto_overdue_sms=coalesce(p_auto_sms,false),auto_overdue_email=coalesce(p_auto_email,false),
    profile_revision=profile_revision+case when row(email,auto_overdue_sms,auto_overdue_email) is distinct from row(nullif(lower(trim(p_email)),''),coalesce(p_auto_sms,false),coalesce(p_auto_email,false)) then 1 else 0 end,
    reminder_checked_at=case when row(auto_overdue_sms,auto_overdue_email) is distinct from row(coalesce(p_auto_sms,false),coalesce(p_auto_email,false)) then null else reminder_checked_at end
    where id=p_party_id and company_id=p_company_id returning * into edited;
  if row(old_party.email,old_party.auto_overdue_sms,old_party.auto_overdue_email) is distinct from row(edited.email,edited.auto_overdue_sms,edited.auto_overdue_email) then
    insert into party_detail_audit(company_id,party_id,actor_id,before_data,after_data) values(p_company_id,p_party_id,p_member_id,
      jsonb_build_object('email',old_party.email,'auto_overdue_sms',old_party.auto_overdue_sms,'auto_overdue_email',old_party.auto_overdue_email),
      jsonb_build_object('email',edited.email,'auto_overdue_sms',edited.auto_overdue_sms,'auto_overdue_email',edited.auto_overdue_email));
  end if;
  return result || jsonb_build_object('email',edited.email,'auto_overdue_sms',edited.auto_overdue_sms,'auto_overdue_email',edited.auto_overdue_email,'profile_revision',edited.profile_revision);
end $$;

-- Only a verified platform-admin server may call this function; platform IDs belong to the separate control DB.
create function public.manage_sms_credits(p_tenant_id uuid,p_actor text,p_request_id uuid,p_action text,p_credits bigint,p_paid numeric,p_note text,p_enabled boolean,p_rate integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare wallet sms_credit_wallets%rowtype; prior sms_credit_ledger%rowtype; payload jsonb;
begin
  if nullif(trim(p_actor),'') is null or nullif(trim(p_note),'') is null then raise exception 'Actor and audit note required'; end if;
  if p_request_id is null then raise exception 'Request ID required'; end if;
  payload:=jsonb_build_object('action',p_action,'credits',p_credits,'paid',p_paid,'note',p_note,'enabled',p_enabled,'rate',p_rate,'actor',p_actor);
  insert into sms_credit_wallets(tenant_id) values(p_tenant_id) on conflict do nothing;
  select * into wallet from sms_credit_wallets where tenant_id=p_tenant_id for update;
  select * into prior from sms_credit_ledger where tenant_id=p_tenant_id and request_id=p_request_id;
  if found then
    if prior.request_payload is distinct from payload then raise exception 'This request was already used with different values. Review the original credit audit before creating another request'; end if;
    return to_jsonb(wallet);
  end if;
  if p_action='topup' then
    if p_credits is null or p_credits<1 or p_credits>10000000 or p_paid::text in ('NaN','Infinity','-Infinity') or p_paid<0 or p_paid<>round(p_paid,2) then raise exception 'Invalid top-up'; end if;
    update sms_credit_wallets set balance=balance+p_credits,credited=credited+p_credits,updated_at=now() where tenant_id=p_tenant_id returning * into wallet;
    insert into sms_credit_ledger(tenant_id,request_id,kind,available_delta,paid_amount,actor,note,request_payload) values(p_tenant_id,p_request_id,'topup',p_credits,p_paid,p_actor,p_note,payload);
  elsif p_action='settings' then
    if p_enabled and p_rate is null then raise exception 'Set confirmed credits per segment before enabling SMS'; end if;
    update sms_credit_wallets set enabled=coalesce(p_enabled,false),credits_per_segment=p_rate,updated_at=now() where tenant_id=p_tenant_id returning * into wallet;
    insert into sms_credit_ledger(tenant_id,request_id,kind,actor,note,request_payload) values(p_tenant_id,p_request_id,'settings',p_actor,p_note||' enabled='||coalesce(p_enabled,false)::text||' credits_per_segment='||coalesce(p_rate::text,'unset'),payload);
  else raise exception 'Invalid credit action'; end if;
  return to_jsonb(wallet);
end $$;

create function public.reserve_overdue_reminder(p_company_id uuid,p_party_id uuid,p_actor_id uuid,p_request_id uuid,p_channel text,p_automatic boolean,p_recipient text,p_message text,p_snapshot jsonb,p_segments integer,p_expected_credits bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare tenant uuid; party parties%rowtype; wallet sms_credit_wallets%rowtype; existing overdue_reminder_deliveries%rowtype; delivery overdue_reminder_deliveries%rowtype; cost bigint:=0; last_sent timestamptz;
begin
  select organization_id into tenant from companies where id=p_company_id and active;
  if tenant is null then raise exception 'Active company with organization required'; end if;
  if p_actor_id is not null and not exists(select 1 from team_members where id=p_actor_id and company_id=p_company_id and active and role in ('admin','manager','accountant')) then raise exception 'Company administrator, manager or accountant required'; end if;
  if not coalesce(p_automatic,false) and p_actor_id is null then raise exception 'Manual sender required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||p_party_id::text||p_channel,0));
  select * into party from parties where id=p_party_id and company_id=p_company_id;
  if not found then raise exception 'Party does not belong to company'; end if;
  select * into existing from overdue_reminder_deliveries where company_id=p_company_id and request_id=p_request_id;
  if found then
    if existing.party_id<>p_party_id or existing.channel<>p_channel then raise exception 'Request ID belongs to another reminder'; end if;
    return jsonb_build_object('created',false,'delivery',to_jsonb(existing));
  end if;
  if p_automatic and ((p_channel='sms' and not party.auto_overdue_sms) or (p_channel='email' and not party.auto_overdue_email)) then raise exception 'Automatic channel not enabled for this party'; end if;
  if p_channel not in ('sms','email') or p_request_id is null or nullif(trim(p_recipient),'') is null or nullif(trim(p_message),'') is null or length(p_message)>1500 or coalesce((p_snapshot->>'overdue')::numeric,0)<=0 then raise exception 'Invalid overdue reminder'; end if;
  if (p_channel='email' and p_recipient is distinct from party.email) or
     (p_channel='sms' and p_recipient is distinct from '+977'||regexp_replace(regexp_replace(coalesce(party.phone,''),'[[:space:]()+-]','','g'),'^(00977|977)','','')) then raise exception 'Party contact changed; refresh the reminder'; end if;
  if exists(select 1 from overdue_reminder_deliveries where company_id=p_company_id and party_id=p_party_id and channel=p_channel and status in ('reserved','unknown')) then raise exception 'Previous reminder is pending confirmation; review it before sending again'; end if;
  select max(completed_at) into last_sent from overdue_reminder_deliveries where company_id=p_company_id and party_id=p_party_id and channel=p_channel and status='accepted';
  if last_sent is not null and last_sent>now()-(case when p_automatic then interval '15 days' else interval '1 minute' end) then raise exception 'Reminder cooldown has not finished'; end if;
  if p_channel='sms' then
    select * into wallet from sms_credit_wallets where tenant_id=tenant for update;
    if not found or not wallet.enabled or wallet.credits_per_segment is null then raise exception 'SMS credits are not enabled for this client'; end if;
    if p_segments is null or p_segments<1 or p_segments>20 then raise exception 'Invalid SMS segment count'; end if;
    cost:=p_segments::bigint*wallet.credits_per_segment;
    if p_expected_credits is null or cost<>p_expected_credits then raise exception 'Credit rate changed; review the latest preview'; end if;
    if wallet.balance<cost then raise exception 'Insufficient SMS credits'; end if;
  end if;
  insert into overdue_reminder_deliveries(tenant_id,company_id,party_id,request_id,channel,automatic,recipient,message,snapshot,segments,credits,requested_by)
    values(tenant,p_company_id,p_party_id,p_request_id,p_channel,coalesce(p_automatic,false),p_recipient,p_message,p_snapshot,case when p_channel='sms' then p_segments else 0 end,cost,p_actor_id) returning * into delivery;
  if p_channel='sms' then
    update sms_credit_wallets set balance=balance-cost,held=held+cost,updated_at=now() where tenant_id=tenant;
    insert into sms_credit_ledger(tenant_id,delivery_id,kind,available_delta,held_delta,actor,note) values(tenant,delivery.id,'reserve',-cost,cost,coalesce(p_actor_id::text,'scheduler'),'Reserve SMS credits before provider request');
  end if;
  return jsonb_build_object('created',true,'delivery',to_jsonb(delivery));
end $$;

create function public.finish_overdue_reminder(p_id uuid,p_status text,p_provider_id text,p_detail text,p_resolution_actor text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare delivery overdue_reminder_deliveries%rowtype;
begin
  if p_status not in ('accepted','failed','unknown') then raise exception 'Invalid delivery outcome'; end if;
  select * into delivery from overdue_reminder_deliveries where id=p_id for update;
  if not found then raise exception 'Reminder not found'; end if;
  if delivery.status in ('accepted','failed') then return to_jsonb(delivery); end if;
  if p_resolution_actor is not null and delivery.status='reserved' and delivery.created_at>now()-interval '2 minutes' then raise exception 'Provider request may still be processing. Wait before reconciling'; end if;
  if delivery.status='unknown' and p_status<>'unknown' and nullif(trim(p_resolution_actor),'') is null then raise exception 'Platform review required for unknown provider outcome'; end if;
  if p_resolution_actor is not null and nullif(trim(p_detail),'') is null then raise exception 'Resolution note required'; end if;
  if delivery.channel='sms' and p_status in ('accepted','failed') then
    update sms_credit_wallets set held=held-delivery.credits,balance=balance+case when p_status='failed' then delivery.credits else 0 end,spent=spent+case when p_status='accepted' then delivery.credits else 0 end,updated_at=now() where tenant_id=delivery.tenant_id;
    insert into sms_credit_ledger(tenant_id,delivery_id,kind,available_delta,held_delta,spent_delta,actor,note) values(delivery.tenant_id,delivery.id,case when p_status='accepted' then 'accepted' else 'refund' end,
      case when p_status='failed' then delivery.credits else 0 end,-delivery.credits,case when p_status='accepted' then delivery.credits else 0 end,coalesce(p_resolution_actor,'provider'),coalesce(left(p_detail,1000),'Provider result'));
  end if;
  if p_resolution_actor is not null then
    insert into sms_credit_ledger(tenant_id,delivery_id,kind,actor,note) values(delivery.tenant_id,delivery.id,'resolution',p_resolution_actor,left(p_detail,1000)) on conflict(delivery_id,kind) do nothing;
  end if;
  update overdue_reminder_deliveries set status=p_status,provider_id=left(p_provider_id,250),detail=left(p_detail,1000),completed_at=case when p_status='unknown' then null else now() end where id=p_id returning * into delivery;
  return to_jsonb(delivery);
end $$;

-- Fair, bounded worker claims; crashed checks can be reclaimed after ten minutes.
create function public.claim_overdue_reminder_parties(p_limit integer default 20)
returns setof public.parties language plpgsql security definer set search_path=public as $$
begin
  return query with candidates as (
    select p.id from parties p join companies c on c.id=p.company_id and c.active
    where (p.auto_overdue_sms or p.auto_overdue_email) and (p.reminder_checked_at is null or p.reminder_checked_at<now()-interval '6 hours')
      and (p.reminder_claim_until is null or p.reminder_claim_until<now())
    order by p.reminder_checked_at nulls first,p.id for update of p skip locked limit greatest(1,least(coalesce(p_limit,20),50))
  ) update parties p set reminder_claim_until=now()+interval '10 minutes' from candidates where p.id=candidates.id returning p.*;
end $$;

revoke all on function public.update_party_details_with_reminders(uuid,uuid,uuid,text,text,text,text,integer,text,boolean,boolean),public.manage_sms_credits(uuid,text,uuid,text,bigint,numeric,text,boolean,integer),public.reserve_overdue_reminder(uuid,uuid,uuid,uuid,text,boolean,text,text,jsonb,integer,bigint),public.finish_overdue_reminder(uuid,text,text,text,text),public.claim_overdue_reminder_parties(integer) from public,anon,authenticated;
grant execute on function public.update_party_details_with_reminders(uuid,uuid,uuid,text,text,text,text,integer,text,boolean,boolean),public.manage_sms_credits(uuid,text,uuid,text,bigint,numeric,text,boolean,integer),public.reserve_overdue_reminder(uuid,uuid,uuid,uuid,text,boolean,text,text,jsonb,integer,bigint),public.finish_overdue_reminder(uuid,text,text,text,text),public.claim_overdue_reminder_parties(integer) to service_role;
