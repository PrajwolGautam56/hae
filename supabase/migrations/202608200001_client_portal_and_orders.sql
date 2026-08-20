-- Customer portal identities and auditable order workflow.
alter table public.parties add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
alter table public.parties add column if not exists portal_email text;
alter table public.parties add column if not exists portal_active boolean not null default false;
create unique index if not exists parties_auth_user_unique on public.parties(auth_user_id) where auth_user_id is not null;
create unique index if not exists parties_company_portal_email_unique on public.parties(company_id,lower(portal_email)) where portal_email is not null;

create table if not exists public.customer_order_sequences (
  company_id uuid primary key references public.companies(id) on delete cascade,
  last_number integer not null default 0
);

create table if not exists public.customer_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  party_id uuid not null references public.parties(id) on delete restrict,
  order_no integer not null,
  status text not null default 'pending' check(status in ('pending','accepted','preparing','packing','sent','delivered','out_of_stock','rejected','cancelled')),
  notes text,
  total numeric(18,2) not null default 0,
  placed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivered_at timestamptz,
  delivered_by text check(delivered_by in ('staff','customer')),
  unique(company_id,order_no)
);

create table if not exists public.customer_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.customer_orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  unit text not null,
  quantity numeric(18,3) not null check(quantity > 0),
  unit_price numeric(18,2) not null default 0,
  amount numeric(18,2) not null default 0
);

create table if not exists public.customer_order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.customer_orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by_type text not null check(changed_by_type in ('staff','customer','system')),
  changed_by uuid,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists customer_orders_company_status_idx on public.customer_orders(company_id,status,placed_at desc);
create index if not exists customer_orders_party_time_idx on public.customer_orders(party_id,placed_at desc);
create index if not exists customer_order_lines_order_idx on public.customer_order_lines(order_id);
create index if not exists customer_order_history_order_idx on public.customer_order_status_history(order_id,created_at);

alter table public.customer_order_sequences enable row level security;
alter table public.customer_orders enable row level security;
alter table public.customer_order_lines enable row level security;
alter table public.customer_order_status_history enable row level security;

create or replace function public.place_customer_order(p_party_id uuid,p_lines jsonb,p_notes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare p public.parties%rowtype; order_id uuid; next_no integer; line jsonb; product public.products%rowtype; qty numeric; order_total numeric:=0;
begin
  select * into p from public.parties where id=p_party_id and portal_active=true for share;
  if not found then raise exception 'Active customer portal account not found'; end if;
  if p_lines is null or jsonb_array_length(p_lines)=0 then raise exception 'Add at least one product'; end if;
  insert into public.customer_order_sequences(company_id,last_number) values(p.company_id,0) on conflict(company_id) do nothing;
  update public.customer_order_sequences set last_number=last_number+1 where company_id=p.company_id returning last_number into next_no;
  insert into public.customer_orders(company_id,party_id,order_no,notes) values(p.company_id,p.id,next_no,nullif(trim(p_notes),'')) returning id into order_id;
  for line in select * from jsonb_array_elements(p_lines) loop
    qty:=coalesce((line->>'quantity')::numeric,0);
    if qty<=0 then raise exception 'Every quantity must be greater than zero'; end if;
    select * into product from public.products where id=(line->>'product_id')::uuid and company_id=p.company_id and active=true;
    if not found or product.item_type not in ('finished_good','resale_good') then raise exception 'Invalid sellable product'; end if;
    insert into public.customer_order_lines(order_id,product_id,product_name,unit,quantity,unit_price,amount)
    values(order_id,product.id,product.name,product.unit,qty,product.sale_price,round(qty*product.sale_price,2));
    order_total:=order_total+round(qty*product.sale_price,2);
  end loop;
  update public.customer_orders set total=order_total where id=order_id;
  insert into public.customer_order_status_history(order_id,to_status,changed_by_type,note) values(order_id,'pending','customer','Order placed from customer portal');
  return order_id;
end $$;

-- These security-definer functions are called only by trusted server routes.
-- Never expose them directly through the browser Data API.
revoke all on function public.place_customer_order(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.place_customer_order(uuid,jsonb,text) to service_role;

create or replace function public.update_customer_order_status(
  p_order_id uuid,p_status text,p_changed_by_type text,p_changed_by uuid default null,p_note text default null
) returns void language plpgsql security definer set search_path=public as $$
declare old_status text;
begin
  if p_status not in ('pending','accepted','preparing','packing','sent','delivered','out_of_stock','rejected','cancelled') then raise exception 'Invalid order status'; end if;
  if p_changed_by_type not in ('staff','customer','system') then raise exception 'Invalid status actor'; end if;
  select status into old_status from public.customer_orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if p_changed_by_type='customer' and not(old_status='sent' and p_status='delivered') then raise exception 'Customer can only confirm delivery after dispatch'; end if;
  update public.customer_orders set status=p_status,updated_at=now(),
    delivered_at=case when p_status='delivered' then now() else delivered_at end,
    delivered_by=case when p_status='delivered' then p_changed_by_type else delivered_by end
  where id=p_order_id;
  if old_status is distinct from p_status then
    insert into public.customer_order_status_history(order_id,from_status,to_status,changed_by_type,changed_by,note)
    values(p_order_id,old_status,p_status,p_changed_by_type,p_changed_by,nullif(trim(p_note),''));
  end if;
end $$;

revoke all on function public.update_customer_order_status(uuid,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.update_customer_order_status(uuid,text,text,uuid,text) to service_role;
