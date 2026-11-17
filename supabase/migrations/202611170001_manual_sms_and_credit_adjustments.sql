-- Client credits are the platform's own allowance, independent of provider purchase costs.
alter table public.sms_credit_ledger drop constraint sms_credit_ledger_kind_check;
alter table public.sms_credit_ledger add constraint sms_credit_ledger_kind_check check(kind in ('topup','adjustment','reserve','accepted','refund','settings','resolution'));
alter table public.overdue_reminder_deliveries add column purpose text not null default 'overdue' check(purpose in ('overdue','manual'));

create or replace function public.manage_sms_credits(p_tenant_id uuid,p_actor text,p_request_id uuid,p_action text,p_credits bigint,p_paid numeric,p_note text,p_enabled boolean,p_rate integer)
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
  if p_action in ('topup','adjustment') then
    if p_credits is null or p_credits=0 or abs(p_credits)>10000000 or (p_action='topup' and p_credits<0) or p_paid::text in ('NaN','Infinity','-Infinity') or p_paid<0 or p_paid<>round(p_paid,2) then raise exception 'Invalid credit adjustment'; end if;
    if wallet.balance+p_credits<0 then raise exception 'Cannot remove more than the available credits; reserved and spent credits cannot be removed'; end if;
    update sms_credit_wallets set balance=balance+p_credits,credited=credited+p_credits,updated_at=now() where tenant_id=p_tenant_id returning * into wallet;
    insert into sms_credit_ledger(tenant_id,request_id,kind,available_delta,paid_amount,actor,note,request_payload) values(p_tenant_id,p_request_id,p_action,p_credits,p_paid,p_actor,p_note,payload);
  elsif p_action='settings' then
    if p_enabled and p_rate is null then raise exception 'Set client credits per segment before enabling SMS'; end if;
    update sms_credit_wallets set enabled=coalesce(p_enabled,false),credits_per_segment=p_rate,updated_at=now() where tenant_id=p_tenant_id returning * into wallet;
    insert into sms_credit_ledger(tenant_id,request_id,kind,actor,note,request_payload) values(p_tenant_id,p_request_id,'settings',p_actor,p_note||' enabled='||coalesce(p_enabled,false)::text||' client credits_per_segment='||coalesce(p_rate::text,'unset'),payload);
  else raise exception 'Invalid credit action'; end if;
  return to_jsonb(wallet);
end $$;

create or replace function public.reserve_overdue_reminder(p_company_id uuid,p_party_id uuid,p_actor_id uuid,p_request_id uuid,p_channel text,p_automatic boolean,p_recipient text,p_message text,p_snapshot jsonb,p_segments integer,p_expected_credits bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare tenant uuid; party parties%rowtype; wallet sms_credit_wallets%rowtype; existing overdue_reminder_deliveries%rowtype; delivery overdue_reminder_deliveries%rowtype; cost bigint:=0; last_sent timestamptz; kind text:=coalesce(p_snapshot->>'purpose','overdue');
begin
  select organization_id into tenant from companies where id=p_company_id and active;
  if tenant is null then raise exception 'Active company with organization required'; end if;
  if p_actor_id is not null and not exists(select 1 from team_members where id=p_actor_id and company_id=p_company_id and active and role in ('admin','manager','accountant')) then raise exception 'Company administrator, manager or accountant required'; end if;
  if not coalesce(p_automatic,false) and p_actor_id is null then raise exception 'Manual sender required'; end if;
  if kind not in ('overdue','manual') or (kind='manual' and (coalesce(p_automatic,false) or p_actor_id is null or p_channel<>'sms')) then raise exception 'Invalid manual message'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||p_party_id::text||p_channel,0));
  select * into party from parties where id=p_party_id and company_id=p_company_id;
  if not found then raise exception 'Party does not belong to company'; end if;
  select * into existing from overdue_reminder_deliveries where company_id=p_company_id and request_id=p_request_id;
  if found then
    if existing.party_id<>p_party_id or existing.channel<>p_channel or existing.purpose<>kind then raise exception 'Request ID belongs to another message'; end if;
    return jsonb_build_object('created',false,'delivery',to_jsonb(existing));
  end if;
  if p_automatic and ((p_channel='sms' and not party.auto_overdue_sms) or (p_channel='email' and not party.auto_overdue_email)) then raise exception 'Automatic channel not enabled for this party'; end if;
  if p_channel not in ('sms','email') or p_request_id is null or nullif(trim(p_recipient),'') is null or nullif(trim(p_message),'') is null or length(p_message)>1500 or (kind='overdue' and coalesce((p_snapshot->>'overdue')::numeric,0)<=0) then raise exception 'Invalid message'; end if;
  if (p_channel='email' and p_recipient is distinct from party.email) or
     (p_channel='sms' and p_recipient is distinct from '+977'||regexp_replace(regexp_replace(coalesce(party.phone,''),'[[:space:]()+-]','','g'),'^(00977|977)','','')) then raise exception 'Party contact changed; refresh the message'; end if;
  if exists(select 1 from overdue_reminder_deliveries where company_id=p_company_id and party_id=p_party_id and channel=p_channel and status in ('reserved','unknown')) then raise exception 'Previous message is pending confirmation; review it before sending again'; end if;
  select max(completed_at) into last_sent from overdue_reminder_deliveries where company_id=p_company_id and party_id=p_party_id and channel=p_channel and status='accepted' and (not coalesce(p_automatic,false) or purpose='overdue');
  if last_sent is not null and last_sent>now()-(case when p_automatic then interval '15 days' else interval '1 minute' end) then raise exception 'Message cooldown has not finished'; end if;
  if p_channel='sms' then
    select * into wallet from sms_credit_wallets where tenant_id=tenant for update;
    if not found or not wallet.enabled or wallet.credits_per_segment is null then raise exception 'SMS credits are not enabled for this client'; end if;
    if p_segments is null or p_segments<1 or p_segments>20 then raise exception 'Invalid SMS segment count'; end if;
    cost:=p_segments::bigint*wallet.credits_per_segment;
    if p_expected_credits is null or cost<>p_expected_credits then raise exception 'Credit rate changed; review the latest preview'; end if;
    if wallet.balance<cost then raise exception 'Insufficient SMS credits'; end if;
  end if;
  insert into overdue_reminder_deliveries(tenant_id,company_id,party_id,request_id,channel,automatic,recipient,message,snapshot,segments,credits,requested_by,purpose)
    values(tenant,p_company_id,p_party_id,p_request_id,p_channel,coalesce(p_automatic,false),p_recipient,p_message,p_snapshot,case when p_channel='sms' then p_segments else 0 end,cost,p_actor_id,kind) returning * into delivery;
  if p_channel='sms' then
    update sms_credit_wallets set balance=balance-cost,held=held+cost,updated_at=now() where tenant_id=tenant;
    insert into sms_credit_ledger(tenant_id,delivery_id,kind,available_delta,held_delta,actor,note) values(tenant,delivery.id,'reserve',-cost,cost,coalesce(p_actor_id::text,'scheduler'),'Reserve client SMS credits before sending');
  end if;
  return jsonb_build_object('created',true,'delivery',to_jsonb(delivery));
end $$;
revoke all on function public.manage_sms_credits(uuid,text,uuid,text,bigint,numeric,text,boolean,integer),public.reserve_overdue_reminder(uuid,uuid,uuid,uuid,text,boolean,text,text,jsonb,integer,bigint) from public,anon,authenticated;
grant execute on function public.manage_sms_credits(uuid,text,uuid,text,bigint,numeric,text,boolean,integer),public.reserve_overdue_reminder(uuid,uuid,uuid,uuid,text,boolean,text,text,jsonb,integer,bigint) to service_role;
