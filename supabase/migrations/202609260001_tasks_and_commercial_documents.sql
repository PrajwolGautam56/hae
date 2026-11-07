-- Non-posting commercial documents and audited task workflow. No existing ledger rows are changed.
begin;
alter table public.work_tasks add column if not exists updated_at timestamptz not null default now();
alter table public.work_tasks add column if not exists request_id uuid;
create unique index if not exists work_tasks_request_unique on public.work_tasks(company_id,request_id) where request_id is not null;
alter table public.crm_activities drop constraint if exists crm_activities_check;
alter table public.crm_activities add constraint crm_activities_target_check check(lead_id is not null or party_id is not null or task_id is not null);

create or replace function public.save_work_task(p_company_id uuid,p_actor_id uuid,p_task_id uuid,p_input jsonb,p_move_only boolean default false,p_expected_updated_at timestamptz default null,p_request_id uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare old_task work_tasks%rowtype; saved work_tasks%rowtype; target uuid; owner uuid; lead uuid; party uuid; new_status text; note text;
begin
  if not exists(select 1 from team_members where id=p_actor_id and company_id=p_company_id and active) then raise exception 'Active company member required'; end if;
  if p_request_id is not null and p_task_id is null then
    perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||p_request_id::text,0));
    select id into target from work_tasks where company_id=p_company_id and request_id=p_request_id;
    if target is not null then return target; end if;
  end if;
  if p_task_id is not null then
    select * into old_task from work_tasks where id=p_task_id and company_id=p_company_id for update;
    if not found then raise exception 'Task not found in this company'; end if;
    if p_expected_updated_at is not null and old_task.updated_at<>p_expected_updated_at then raise exception 'Another user changed this task. Refresh before editing again.'; end if;
  elsif p_move_only then raise exception 'Select a task'; end if;
  new_status:=coalesce(p_input->>'status','todo');
  if new_status not in ('todo','in_progress','done','cancelled') then raise exception 'Invalid task status'; end if;
  if p_move_only then
    if old_task.status=new_status then return old_task.id; end if;
    update work_tasks set status=new_status,completed_at=case when new_status='done' then now() else null end,updated_at=now() where id=p_task_id and company_id=p_company_id returning * into saved;
    note:=format('Status: %s → %s',old_task.status,new_status);
  else
    if length(trim(coalesce(p_input->>'title','')))=0 or length(p_input->>'title')>250 then raise exception 'Task title is required (maximum 250 characters)'; end if;
    owner:=nullif(p_input->>'assignedTo','')::uuid;lead:=nullif(p_input->>'leadId','')::uuid;party:=nullif(p_input->>'partyId','')::uuid;
    if lead is not null and party is not null then raise exception 'Choose either a lead or a party'; end if;
    if owner is not null and not exists(select 1 from team_members where id=owner and company_id=p_company_id and active) then raise exception 'Select an active assignee in this company'; end if;
    if lead is not null and not exists(select 1 from leads where id=lead and company_id=p_company_id) then raise exception 'Invalid lead'; end if;
    if party is not null and not exists(select 1 from parties where id=party and company_id=p_company_id) then raise exception 'Invalid party'; end if;
    if p_task_id is null then
      insert into work_tasks(company_id,title,description,task_type,status,priority,assigned_to,lead_id,party_id,due_at,completed_at,request_id)
      values(p_company_id,trim(p_input->>'title'),p_input->>'description',coalesce(p_input->>'taskType','general'),new_status,coalesce(p_input->>'priority','medium'),owner,lead,party,nullif(p_input->>'dueAt','')::timestamptz,case when new_status='done' then now() end,p_request_id) returning * into saved;
      note:='Task created';
    else
      update work_tasks set title=trim(p_input->>'title'),description=p_input->>'description',task_type=p_input->>'taskType',status=new_status,priority=p_input->>'priority',assigned_to=owner,lead_id=lead,party_id=party,due_at=nullif(p_input->>'dueAt','')::timestamptz,completed_at=case when new_status='done' then coalesce(old_task.completed_at,now()) else null end,updated_at=now()
      where id=p_task_id and company_id=p_company_id returning * into saved;
      note:=format('Task updated · status: %s → %s · assignee: %s → %s',old_task.status,new_status,coalesce((select name from team_members where id=old_task.assigned_to),'Unassigned'),coalesce((select name from team_members where id=owner),'Unassigned'));
    end if;
  end if;
  insert into crm_activities(company_id,activity_type,subject,remarks,member_id,lead_id,party_id,task_id)
  values(p_company_id,'status_change',saved.title,note,p_actor_id,saved.lead_id,saved.party_id,saved.id);
  return saved.id;
end $$;
revoke all on function public.save_work_task(uuid,uuid,uuid,jsonb,boolean,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.save_work_task(uuid,uuid,uuid,jsonb,boolean,timestamptz,uuid) to service_role;

create table public.commercial_document_sequences (
  company_id uuid not null references public.companies(id),
  fiscal_year_id uuid not null,
  document_type text not null check(document_type in ('quotation','proforma')),
  last_number integer not null check(last_number>0),
  primary key(company_id,fiscal_year_id,document_type),
  foreign key(company_id,fiscal_year_id) references public.fiscal_years(company_id,id)
);
create table public.commercial_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  fiscal_year_id uuid not null,
  document_type text not null check(document_type in ('quotation','proforma')),
  sequence_no integer not null,
  document_date date not null,
  status text not null default 'issued' check(status in ('issued','cancelled')),
  request_id uuid not null,
  recipient_name text not null,
  payload jsonb not null,
  total numeric(18,2) not null check(total>=0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique(company_id,request_id),
  unique(company_id,fiscal_year_id,document_type,sequence_no),
  foreign key(company_id,fiscal_year_id) references public.fiscal_years(company_id,id),
  foreign key(company_id,created_by) references public.team_members(company_id,id)
);
create index commercial_documents_register on public.commercial_documents(company_id,fiscal_year_id,document_type,sequence_no desc);
alter table public.commercial_documents enable row level security;
alter table public.commercial_document_sequences enable row level security;
revoke all on public.commercial_documents,public.commercial_document_sequences from public,anon,authenticated;
grant all on public.commercial_documents,public.commercial_document_sequences to service_role;

create or replace function public.issue_commercial_document(p_company_id uuid,p_fiscal_year_id uuid,p_actor_id uuid,p_request_id uuid,p_input jsonb)
returns public.commercial_documents language plpgsql security definer set search_path=public as $$
declare result commercial_documents%rowtype; c companies%rowtype; fy fiscal_years%rowtype; n integer; kind text; d date; line jsonb; normalized_lines jsonb:='[]'; qty numeric; rate numeric; amount numeric; subtotal numeric:=0; discount numeric; net numeric; taxable numeric; tax numeric; grand numeric; percent numeric; tax_percent numeric; mode text; payload jsonb;
begin
  if p_request_id is null then raise exception 'Request ID required'; end if;
  if not exists(select 1 from team_members where id=p_actor_id and company_id=p_company_id and active) then raise exception 'Active company member required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||p_request_id::text,0));
  select * into result from commercial_documents where company_id=p_company_id and request_id=p_request_id;
  if found then return result; end if;
  select * into c from companies where id=p_company_id;
  select * into fy from fiscal_years where id=p_fiscal_year_id and company_id=p_company_id;
  if not found then raise exception 'Fiscal year does not belong to company'; end if;
  kind:=p_input->>'documentType';d:=(p_input->>'date')::date;
  if kind not in ('quotation','proforma') or kind is null then raise exception 'Invalid document type'; end if;
  if d is null or d<fy.start_ad or d>fy.end_ad then raise exception 'Document date is outside selected fiscal year'; end if;
  if length(trim(coalesce(p_input->>'recipientName','')))=0 then raise exception 'Recipient name is required'; end if;
  if jsonb_typeof(p_input->'lines') is distinct from 'array' then raise exception 'Add item lines'; end if;
  if jsonb_array_length(p_input->'lines') not between 1 and 100 then raise exception 'Add 1 to 100 items'; end if;
  for line in select * from jsonb_array_elements(p_input->'lines') loop
    qty:=(line->>'quantity')::numeric;rate:=(line->>'rate')::numeric;
    if qty is null or rate is null or qty<=0 or qty>100000000 or rate<0 or rate>100000000 or length(trim(coalesce(line->>'description','')))=0 then raise exception 'Invalid item quantity, rate or description'; end if;
    qty:=round(qty,3);rate:=round(rate,2);amount:=round(qty*rate,2);
    if qty<=0 then raise exception 'Quantity must be at least 0.001'; end if;
    subtotal:=subtotal+amount;
    normalized_lines:=normalized_lines||jsonb_build_array(jsonb_build_object('description',line->>'description','quantity',qty,'rate',rate,'amount',amount,'unit',line->>'unit'));
  end loop;
  percent:=coalesce((p_input->>'discountPercent')::numeric,0);tax_percent:=coalesce((p_input->>'taxPercent')::numeric,0);mode:=p_input->>'taxMode';
  if percent<0 or percent>100 or tax_percent<0 or tax_percent>100 or mode is null or mode not in ('exclusive','inclusive','none') then raise exception 'Invalid VAT or discount setting'; end if;
  discount:=round(subtotal*percent/100,2);net:=subtotal-discount;
  if mode='inclusive' then taxable:=round(net/(1+tax_percent/100),2);tax:=net-taxable;grand:=net;
  elsif mode='exclusive' then taxable:=net;tax:=round(net*tax_percent/100,2);grand:=net+tax;
  else taxable:=net;tax:=0;grand:=net;tax_percent:=0;end if;
  payload:=p_input||jsonb_build_object('issuer',jsonb_build_object('name',c.name,'logo_url',c.logo_url,'address',c.address,'phone',c.phone,'pan',coalesce(nullif(c.settings->>'pan',''),nullif(p_input->>'issuerPan',''))),'fiscalYear',fy.label_bs,'generatedBy',(select name from team_members where id=p_actor_id),'lines',normalized_lines,'subtotal',subtotal,'discount',discount,'taxable',taxable,'tax',tax,'total',grand,'taxPercent',tax_percent);
  insert into commercial_document_sequences(company_id,fiscal_year_id,document_type,last_number) values(p_company_id,p_fiscal_year_id,kind,1)
  on conflict(company_id,fiscal_year_id,document_type) do update set last_number=commercial_document_sequences.last_number+1 returning last_number into n;
  insert into commercial_documents(company_id,fiscal_year_id,document_type,sequence_no,document_date,request_id,recipient_name,payload,total,created_by)
  values(p_company_id,p_fiscal_year_id,kind,n,d,p_request_id,trim(p_input->>'recipientName'),payload,grand,p_actor_id) returning * into result;
  return result;
end $$;
revoke all on function public.issue_commercial_document(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.issue_commercial_document(uuid,uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
