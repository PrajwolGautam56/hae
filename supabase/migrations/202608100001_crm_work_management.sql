create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  role text not null default 'staff' check (role in ('admin','manager','accountant','staff')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(company_id, email)
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  phone text not null,
  source text not null default 'social_media',
  interest text,
  status text not null default 'new' check(status in ('new','contacted','qualified','meeting','proposal','won','lost')),
  assigned_to uuid references public.team_members(id),
  next_follow_up_at timestamptz,
  last_contact_at timestamptz,
  converted_party_id uuid references public.parties(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, phone)
);

create table if not exists public.work_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null,
  description text,
  task_type text not null default 'general' check(task_type in ('general','lead_follow_up','call','meeting','payment_collection')),
  status text not null default 'todo' check(status in ('todo','in_progress','done','cancelled')),
  priority text not null default 'medium' check(priority in ('low','medium','high','urgent')),
  assigned_to uuid references public.team_members(id),
  lead_id uuid references public.leads(id) on delete cascade,
  party_id uuid references public.parties(id) on delete cascade,
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  activity_type text not null check(activity_type in ('call','meeting','note','follow_up','payment_collection','status_change')),
  subject text,
  remarks text not null,
  outcome text,
  member_id uuid references public.team_members(id),
  lead_id uuid references public.leads(id) on delete cascade,
  party_id uuid references public.parties(id) on delete cascade,
  task_id uuid references public.work_tasks(id) on delete set null,
  happened_at timestamptz not null default now(),
  next_action_at timestamptz,
  created_at timestamptz not null default now(),
  check (lead_id is not null or party_id is not null)
);

create index if not exists leads_company_status_idx on public.leads(company_id,status);
create index if not exists leads_assignee_followup_idx on public.leads(assigned_to,next_follow_up_at);
create index if not exists tasks_assignee_due_idx on public.work_tasks(assigned_to,due_at,status);
create index if not exists activities_lead_time_idx on public.crm_activities(lead_id,happened_at desc);
create index if not exists activities_party_time_idx on public.crm_activities(party_id,happened_at desc);

alter table public.team_members enable row level security;
alter table public.leads enable row level security;
alter table public.work_tasks enable row level security;
alter table public.crm_activities enable row level security;

do $$ declare c uuid; begin
  select id into c from public.companies order by created_at limit 1;
  insert into public.team_members(company_id,name,email,role) values
    (c,'Prajwol Gautam','prajwol@hamrokhata.local','admin'),
    (c,'Sales Manager','manager@hamrokhata.local','manager'),
    (c,'Accounts Staff','accounts@hamrokhata.local','accountant'),
    (c,'Field Staff','field@hamrokhata.local','staff')
  on conflict(company_id,email) do nothing;
end $$;

create or replace function public.convert_lead_to_party(p_lead_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare l leads%rowtype; party uuid;
begin
  select * into l from leads where id=p_lead_id for update;
  if l.id is null then raise exception 'Lead not found'; end if;
  if l.converted_party_id is not null then return l.converted_party_id; end if;
  insert into parties(company_id,name,phone,party_type)
  values(l.company_id,l.name,l.phone,'customer')
  on conflict(company_id,name) do update set phone=excluded.phone
  returning id into party;
  update leads set status='won',converted_party_id=party,updated_at=now() where id=p_lead_id;
  insert into crm_activities(company_id,activity_type,subject,remarks,lead_id,party_id,happened_at)
  values(l.company_id,'status_change','Lead converted','Lead converted to customer/party',p_lead_id,party,now());
  return party;
end $$;
