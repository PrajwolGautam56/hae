-- Complete accounting operations foundation: orders, returns, manual journals,
-- contra, stock adjustments and reusable bills of materials.

alter table public.vouchers drop constraint if exists vouchers_voucher_type_check;
alter table public.vouchers add constraint vouchers_voucher_type_check check (
  voucher_type in (
    'sale','purchase','receipt','payment','expense','journal','contra',
    'sale_return','purchase_return','stock_adjustment','payroll'
  )
);
alter table public.vouchers add column if not exists source_voucher_id uuid references public.vouchers(id) on delete restrict;
alter table public.vouchers add column if not exists source_order_id uuid;
alter table public.vouchers add column if not exists due_date date;
alter table public.vouchers add column if not exists external_reference text;
alter table public.vouchers add column if not exists document_status text not null default 'posted'
  check (document_status in ('draft','posted','cancelled'));
create index if not exists vouchers_source_voucher_idx on public.vouchers(source_voucher_id);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  fiscal_year_id uuid not null references public.fiscal_years(id) on delete restrict,
  supplier_id uuid not null references public.parties(id) on delete restrict,
  order_no text not null,
  sequence_no integer not null,
  order_date date not null,
  expected_date date,
  supplier_reference text,
  narration text,
  subtotal numeric(18,2) not null default 0,
  discount_percent numeric(8,4) not null default 0,
  discount_amount numeric(18,2) not null default 0,
  tax_percent numeric(8,4) not null default 0,
  tax_amount numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  status text not null default 'draft' check(status in ('draft','sent','part_received','received','billed','cancelled')),
  created_by uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(fiscal_year_id,sequence_no),
  unique(company_id,fiscal_year_id,order_no)
);

create table if not exists public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete restrict,
  description text not null,
  quantity numeric(18,3) not null check(quantity>0),
  received_quantity numeric(18,3) not null default 0 check(received_quantity>=0),
  billed_quantity numeric(18,3) not null default 0 check(billed_quantity>=0),
  rate numeric(18,2) not null default 0 check(rate>=0),
  amount numeric(18,2) not null default 0,
  unit text not null default 'pcs',
  item_type text not null default 'finished_good'
    check(item_type in ('raw_material','packaging','finished_good','resale_good'))
);

alter table public.vouchers
  add constraint vouchers_source_order_fkey foreign key(source_order_id) references public.purchase_orders(id) on delete restrict;
create index if not exists purchase_orders_company_date_idx on public.purchase_orders(company_id,order_date desc);
create index if not exists purchase_order_lines_order_idx on public.purchase_order_lines(purchase_order_id);

alter table public.products add column if not exists mrp numeric(18,2) not null default 0;

create table if not exists public.bills_of_materials (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  output_product_id uuid not null references public.products(id) on delete restrict,
  name text not null,
  version text not null default '1',
  output_quantity numeric(18,3) not null default 1 check(output_quantity>0),
  notes text,
  active boolean not null default true,
  created_by uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,output_product_id,name,version)
);

create table if not exists public.bom_components (
  id uuid primary key default gen_random_uuid(),
  bom_id uuid not null references public.bills_of_materials(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity numeric(18,3) not null check(quantity>0),
  wastage_percent numeric(8,4) not null default 0 check(wastage_percent>=0),
  notes text,
  unique(bom_id,product_id)
);

alter table public.production_batches add column if not exists bom_id uuid references public.bills_of_materials(id) on delete restrict;
alter table public.production_batches add column if not exists production_status text not null default 'completed'
  check(production_status in ('draft','in_progress','completed','cancelled'));

alter table public.stock_movements add column if not exists unit_cost numeric(18,4);
alter table public.stock_movements add column if not exists notes text;
alter table public.stock_movements alter column voucher_id drop not null;
alter table public.stock_movements add column if not exists production_batch_id uuid references public.production_batches(id) on delete cascade;
create index if not exists stock_movements_production_batch_idx on public.stock_movements(production_batch_id);

create table if not exists public.stock_adjustment_details (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references public.vouchers(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity_delta numeric(18,3) not null check(quantity_delta<>0),
  unit_cost numeric(18,4) not null default 0 check(unit_cost>=0),
  reason text,
  unique(voucher_id,product_id)
);

create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  fiscal_year_id uuid not null references public.fiscal_years(id) on delete restrict,
  voucher_id uuid not null references public.vouchers(id) on delete restrict,
  run_no text not null,
  sequence_no integer not null,
  period_label text not null,
  pay_date date not null,
  gross_amount numeric(18,2) not null,
  deduction_amount numeric(18,2) not null default 0,
  net_amount numeric(18,2) not null,
  status text not null default 'posted' check(status in ('draft','posted','paid','cancelled')),
  notes text,
  created_by uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(fiscal_year_id,sequence_no)
);

create table if not exists public.payroll_lines (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  team_member_id uuid not null references public.team_members(id) on delete restrict,
  basic_salary numeric(18,2) not null default 0,
  allowances numeric(18,2) not null default 0,
  deductions numeric(18,2) not null default 0,
  net_amount numeric(18,2) not null,
  notes text,
  unique(payroll_run_id,team_member_id)
);

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.bills_of_materials enable row level security;
alter table public.bom_components enable row level security;
alter table public.stock_adjustment_details enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_lines enable row level security;

create unique index if not exists purchase_orders_company_id_id_unique on public.purchase_orders(company_id,id);
create unique index if not exists boms_company_id_id_unique on public.bills_of_materials(company_id,id);
create unique index if not exists payroll_runs_company_id_id_unique on public.payroll_runs(company_id,id);

do $$ begin alter table public.purchase_orders add constraint po_company_fy_fkey foreign key(company_id,fiscal_year_id) references public.fiscal_years(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.purchase_orders add constraint po_company_supplier_fkey foreign key(company_id,supplier_id) references public.parties(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.purchase_orders add constraint po_company_creator_fkey foreign key(company_id,created_by) references public.team_members(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.bills_of_materials add constraint bom_company_output_fkey foreign key(company_id,output_product_id) references public.products(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.bills_of_materials add constraint bom_company_creator_fkey foreign key(company_id,created_by) references public.team_members(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.vouchers add constraint vouchers_company_source_voucher_fkey foreign key(company_id,source_voucher_id) references public.vouchers(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.vouchers add constraint vouchers_company_source_order_fkey foreign key(company_id,source_order_id) references public.purchase_orders(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.payroll_runs add constraint payroll_company_fy_fkey foreign key(company_id,fiscal_year_id) references public.fiscal_years(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.payroll_runs add constraint payroll_company_voucher_fkey foreign key(company_id,voucher_id) references public.vouchers(company_id,id) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.payroll_runs add constraint payroll_company_creator_fkey foreign key(company_id,created_by) references public.team_members(company_id,id) not valid; exception when duplicate_object then null; end $$;

create or replace function private.enforce_purchase_order_line_company()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.product_id is not null and not exists(
    select 1 from public.purchase_orders po join public.products p on p.company_id=po.company_id
    where po.id=new.purchase_order_id and p.id=new.product_id
  ) then raise exception 'Purchase order product belongs to another company'; end if;
  return new;
end $$;

create or replace function private.enforce_bom_component_company()
returns trigger language plpgsql set search_path='' as $$
begin
  if not exists(
    select 1 from public.bills_of_materials b join public.products p on p.company_id=b.company_id
    where b.id=new.bom_id and p.id=new.product_id
  ) then raise exception 'BOM component belongs to another company'; end if;
  return new;
end $$;

create or replace function private.enforce_stock_adjustment_company()
returns trigger language plpgsql set search_path='' as $$
begin
  if not exists(
    select 1 from public.vouchers v join public.products p on p.company_id=v.company_id
    where v.id=new.voucher_id and p.id=new.product_id
  ) then raise exception 'Stock adjustment product belongs to another company'; end if;
  return new;
end $$;

create or replace function private.enforce_payroll_line_company()
returns trigger language plpgsql set search_path='' as $$
begin
  if not exists(
    select 1 from public.payroll_runs r join public.team_members m on m.company_id=r.company_id
    where r.id=new.payroll_run_id and m.id=new.team_member_id
  ) then raise exception 'Payroll employee belongs to another company'; end if;
  return new;
end $$;

drop trigger if exists purchase_order_line_company_guard on public.purchase_order_lines;
create trigger purchase_order_line_company_guard before insert or update on public.purchase_order_lines
for each row execute function private.enforce_purchase_order_line_company();
drop trigger if exists bom_component_company_guard on public.bom_components;
create trigger bom_component_company_guard before insert or update on public.bom_components
for each row execute function private.enforce_bom_component_company();
drop trigger if exists stock_adjustment_company_guard on public.stock_adjustment_details;
create trigger stock_adjustment_company_guard before insert or update on public.stock_adjustment_details
for each row execute function private.enforce_stock_adjustment_company();
drop trigger if exists payroll_line_company_guard on public.payroll_lines;
create trigger payroll_line_company_guard before insert or update on public.payroll_lines
for each row execute function private.enforce_payroll_line_company();

revoke all on function private.enforce_purchase_order_line_company() from public,anon,authenticated;
revoke all on function private.enforce_bom_component_company() from public,anon,authenticated;
revoke all on function private.enforce_stock_adjustment_company() from public,anon,authenticated;
revoke all on function private.enforce_payroll_line_company() from public,anon,authenticated;

insert into public.accounts(company_id,code,name,account_type,normal_side,system_key)
select c.id,x.code,x.name,x.account_type,x.normal_side,x.system_key
from public.companies c cross join (values
  ('4010','Sales Returns','income','credit','sales_returns'),
  ('1250','VAT / Tax Input','asset','debit','tax_input'),
  ('2050','VAT / Tax Output Payable','liability','credit','tax_output'),
  ('6090','Inventory Adjustment','expense','debit','inventory_adjustment'),
  ('6100','Payroll Expense','expense','debit','payroll_expense'),
  ('2100','Payroll Payable','liability','credit','payroll_payable'),
  ('2110','Payroll Deductions Payable','liability','credit','payroll_deductions_payable')
) as x(code,name,account_type,normal_side,system_key)
on conflict(company_id,code) do update set name=excluded.name,account_type=excluded.account_type,
  normal_side=excluded.normal_side,system_key=excluded.system_key,active=true;

create or replace function public.record_purchase_order(
  p_company_id uuid,p_fiscal_year_id uuid,p_supplier_id uuid,p_order_date date,
  p_expected_date date,p_lines jsonb,p_discount_percent numeric default 0,
  p_tax_percent numeric default 0,p_narration text default '',p_supplier_reference text default '',
  p_created_by uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer; ref text; po_id uuid; line jsonb; qty numeric; rate numeric;
  subtotal_value numeric:=0; discount_value numeric; tax_value numeric; total_value numeric; product uuid;
begin
  if not exists(select 1 from fiscal_years where id=p_fiscal_year_id and company_id=p_company_id and p_order_date between start_ad and end_ad) then raise exception 'Purchase order date is outside selected fiscal year'; end if;
  if not exists(select 1 from parties where id=p_supplier_id and company_id=p_company_id) then raise exception 'Supplier is invalid'; end if;
  if p_lines is null or jsonb_array_length(p_lines)=0 then raise exception 'Add at least one item'; end if;
  if p_discount_percent<0 or p_discount_percent>100 or p_tax_percent<0 then raise exception 'Invalid discount or tax percentage'; end if;
  for line in select * from jsonb_array_elements(p_lines) loop
    qty:=(line->>'quantity')::numeric;rate:=(line->>'rate')::numeric;
    if qty<=0 or rate<0 or coalesce(line->>'name','')='' then raise exception 'Invalid purchase order line'; end if;
    subtotal_value:=subtotal_value+round(qty*rate,2);
  end loop;
  discount_value:=round(subtotal_value*p_discount_percent/100,2);
  tax_value:=round((subtotal_value-discount_value)*p_tax_percent/100,2);
  total_value:=subtotal_value-discount_value+tax_value;
  insert into voucher_sequences(fiscal_year_id,voucher_type,last_number) values(p_fiscal_year_id,'purchase_order',1)
    on conflict(fiscal_year_id,voucher_type) do update set last_number=voucher_sequences.last_number+1 returning last_number into n;
  ref:=n::text;
  insert into purchase_orders(company_id,fiscal_year_id,supplier_id,order_no,sequence_no,order_date,expected_date,
    supplier_reference,narration,subtotal,discount_percent,discount_amount,tax_percent,tax_amount,total,created_by)
  values(p_company_id,p_fiscal_year_id,p_supplier_id,ref,n,p_order_date,p_expected_date,nullif(p_supplier_reference,''),
    p_narration,subtotal_value,p_discount_percent,discount_value,p_tax_percent,tax_value,total_value,p_created_by)
  returning id into po_id;
  for line in select * from jsonb_array_elements(p_lines) loop
    product:=nullif(line->>'product_id','')::uuid;qty:=(line->>'quantity')::numeric;rate:=(line->>'rate')::numeric;
    if product is not null and not exists(select 1 from products where id=product and company_id=p_company_id) then raise exception 'Purchase order product is invalid'; end if;
    insert into purchase_order_lines(purchase_order_id,product_id,description,quantity,rate,amount,unit,item_type)
    values(po_id,product,line->>'name',qty,rate,round(qty*rate,2),coalesce(nullif(line->>'unit',''),'pcs'),coalesce(nullif(line->>'item_type',''),'finished_good'));
  end loop;
  return jsonb_build_object('id',po_id,'order_no',ref,'sequence_no',n,'total',total_value);
end $$;

create or replace function public.convert_purchase_order_to_bill(
  p_purchase_order_id uuid,p_bill_date date,p_generated_by uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare po purchase_orders%rowtype; payload jsonb; result jsonb; voucher_id uuid;
begin
  select * into po from purchase_orders where id=p_purchase_order_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if po.status in ('billed','cancelled') then raise exception 'Purchase order cannot be billed in its current status'; end if;
  select jsonb_agg(jsonb_build_object('product_id',l.product_id,'name',l.description,'quantity',l.quantity,
    'rate',l.rate,'unit',l.unit,'item_type',l.item_type) order by l.id) into payload
  from purchase_order_lines l where l.purchase_order_id=po.id;
  select record_purchase_invoice(po.company_id,po.fiscal_year_id,po.supplier_id,p_bill_date,payload,
    po.discount_percent,po.tax_percent,concat('PO ',po.order_no,case when coalesce(po.narration,'')='' then '' else ' · '||po.narration end)) into result;
  voucher_id:=(result->>'id')::uuid;
  update vouchers set source_order_id=po.id,generated_by=p_generated_by,handled_by=p_generated_by,
    external_reference=po.supplier_reference,subtotal=po.subtotal,discount_percent=po.discount_percent,
    discount_amount=po.discount_amount,tax_percent=po.tax_percent,tax_amount=po.tax_amount,total=po.total where id=voucher_id;
  update ledger_entries set credit=po.total where voucher_id=voucher_id and account_name='Supplier Account';
  update purchase_order_lines set received_quantity=quantity,billed_quantity=quantity where purchase_order_id=po.id;
  update purchase_orders set status='billed',updated_at=now() where id=po.id;
  return result||jsonb_build_object('purchase_order_id',po.id);
end $$;

create or replace function public.record_goods_return(
  p_company_id uuid,p_fiscal_year_id uuid,p_source_voucher_id uuid,p_return_type text,
  p_date date,p_lines jsonb,p_narration text default '',p_generated_by uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare source vouchers%rowtype; n integer; ref text; v_id uuid; line jsonb; product uuid;
  qty numeric; rate numeric; amount_value numeric; subtotal_value numeric:=0; discount_value numeric;
  tax_value numeric; total_value numeric; already_returned numeric; original_qty numeric;
begin
  if p_return_type not in ('sale_return','purchase_return') then raise exception 'Invalid return type'; end if;
  select * into source from vouchers where id=p_source_voucher_id and company_id=p_company_id for update;
  if not found or source.voucher_type<>(case when p_return_type='sale_return' then 'sale' else 'purchase' end) then raise exception 'Original invoice does not match this return'; end if;
  if source.fiscal_year_id<>p_fiscal_year_id then raise exception 'Return must use the original invoice fiscal year'; end if;
  if p_lines is null or jsonb_array_length(p_lines)=0 then raise exception 'Add at least one returned item'; end if;
  for line in select * from jsonb_array_elements(p_lines) loop
    product:=(line->>'product_id')::uuid;qty:=(line->>'quantity')::numeric;rate:=(line->>'rate')::numeric;
    select coalesce(sum(quantity),0) into original_qty from voucher_lines where voucher_id=source.id and product_id=product;
    select coalesce(sum(vl.quantity),0) into already_returned from vouchers rv join voucher_lines vl on vl.voucher_id=rv.id
      where rv.source_voucher_id=source.id and rv.voucher_type=p_return_type and rv.document_status='posted' and vl.product_id=product;
    if qty<=0 or rate<0 or original_qty-already_returned<qty then raise exception 'Return quantity exceeds available invoice quantity'; end if;
    if p_return_type='purchase_return' and (select stock_qty from products where id=product and company_id=p_company_id)<qty then raise exception 'Insufficient stock for purchase return'; end if;
    subtotal_value:=subtotal_value+round(qty*rate,2);
  end loop;
  discount_value:=round(subtotal_value*coalesce(source.discount_percent,0)/100,2);
  tax_value:=round((subtotal_value-discount_value)*coalesce(source.tax_percent,0)/100,2);
  total_value:=subtotal_value-discount_value+tax_value;
  insert into voucher_sequences(fiscal_year_id,voucher_type,last_number) values(p_fiscal_year_id,p_return_type,1)
    on conflict(fiscal_year_id,voucher_type) do update set last_number=voucher_sequences.last_number+1 returning last_number into n;
  ref:=n::text;
  insert into vouchers(company_id,party_id,fiscal_year_id,voucher_type,voucher_no,sequence_no,voucher_date,narration,
    subtotal,discount_percent,discount_amount,tax_percent,tax_amount,total,source_voucher_id,generated_by,handled_by)
  values(p_company_id,source.party_id,p_fiscal_year_id,p_return_type,ref,n,p_date,p_narration,subtotal_value,
    source.discount_percent,discount_value,source.tax_percent,tax_value,total_value,source.id,p_generated_by,p_generated_by)
  returning id into v_id;
  for line in select * from jsonb_array_elements(p_lines) loop
    product:=(line->>'product_id')::uuid;qty:=(line->>'quantity')::numeric;rate:=(line->>'rate')::numeric;amount_value:=round(qty*rate,2);
    insert into voucher_lines(voucher_id,product_id,description,quantity,rate,amount,inventory_item)
    values(v_id,product,line->>'name',qty,rate,amount_value,true);
    update products set stock_qty=stock_qty+case when p_return_type='sale_return' then qty else -qty end where id=product and company_id=p_company_id;
    insert into stock_movements(company_id,product_id,voucher_id,movement_date,quantity,movement_type,unit_cost,notes)
    values(p_company_id,product,v_id,p_date,case when p_return_type='sale_return' then qty else -qty end,
      case when p_return_type='sale_return' then 'in' else 'out' end,
      case when p_return_type='sale_return' then (select purchase_price from products where id=product and company_id=p_company_id) else rate end,
      p_narration);
  end loop;
  insert into ledger_entries(company_id,party_id,voucher_id,entry_date,account_name,debit,credit)
  values(p_company_id,source.party_id,v_id,p_date,case when p_return_type='sale_return' then 'Sales Return' else 'Purchase Return' end,
    case when p_return_type='purchase_return' then total_value else 0 end,
    case when p_return_type='sale_return' then total_value else 0 end);
  perform rebuild_voucher_journal(v_id);
  return jsonb_build_object('id',v_id,'voucher_no',ref,'sequence_no',n,'total',total_value);
end $$;

create or replace function public.record_manual_journal(
  p_company_id uuid,p_fiscal_year_id uuid,p_date date,p_lines jsonb,p_narration text,
  p_generated_by uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer; ref text; v_id uuid; j_id uuid; line jsonb; dr numeric:=0; cr numeric:=0;
  account uuid; party uuid; value_dr numeric; value_cr numeric;
begin
  if p_lines is null or jsonb_array_length(p_lines)<2 then raise exception 'Journal requires at least two lines'; end if;
  for line in select * from jsonb_array_elements(p_lines) loop
    account:=(line->>'account_id')::uuid;party:=nullif(line->>'party_id','')::uuid;
    value_dr:=coalesce((line->>'debit')::numeric,0);value_cr:=coalesce((line->>'credit')::numeric,0);
    if not exists(select 1 from accounts where id=account and company_id=p_company_id and active) then raise exception 'Invalid journal account'; end if;
    if party is not null and not exists(select 1 from parties where id=party and company_id=p_company_id) then raise exception 'Invalid journal party'; end if;
    if value_dr<0 or value_cr<0 or (value_dr>0 and value_cr>0) or (value_dr=0 and value_cr=0) then raise exception 'Each journal line needs either a debit or a credit'; end if;
    dr:=dr+value_dr;cr:=cr+value_cr;
  end loop;
  if abs(dr-cr)>0.009 or dr<=0 then raise exception 'Journal debit and credit must be equal'; end if;
  insert into voucher_sequences(fiscal_year_id,voucher_type,last_number) values(p_fiscal_year_id,'journal',1)
    on conflict(fiscal_year_id,voucher_type) do update set last_number=voucher_sequences.last_number+1 returning last_number into n;
  ref:=n::text;
  insert into vouchers(company_id,fiscal_year_id,voucher_type,voucher_no,sequence_no,voucher_date,narration,total,generated_by,handled_by)
  values(p_company_id,p_fiscal_year_id,'journal',ref,n,p_date,p_narration,dr,p_generated_by,p_generated_by) returning id into v_id;
  insert into journal_entries(company_id,fiscal_year_id,voucher_id,entry_date,reference,description,source_type)
  values(p_company_id,p_fiscal_year_id,v_id,p_date,ref,p_narration,'manual_journal') returning id into j_id;
  for line in select * from jsonb_array_elements(p_lines) loop
    insert into journal_lines(journal_entry_id,company_id,account_id,party_id,description,debit,credit)
    values(j_id,p_company_id,(line->>'account_id')::uuid,nullif(line->>'party_id','')::uuid,
      coalesce(nullif(line->>'description',''),p_narration),coalesce((line->>'debit')::numeric,0),coalesce((line->>'credit')::numeric,0));
  end loop;
  return jsonb_build_object('id',v_id,'voucher_no',ref,'sequence_no',n,'total',dr);
end $$;

create or replace function public.record_contra_voucher(
  p_company_id uuid,p_fiscal_year_id uuid,p_date date,p_from_account_id uuid,p_to_account_id uuid,
  p_amount numeric,p_narration text,p_generated_by uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer; ref text; v_id uuid; j_id uuid; cash_gl uuid; movement_id uuid;
begin
  if p_amount<=0 then raise exception 'Amount must be greater than zero'; end if;
  if p_from_account_id=p_to_account_id then raise exception 'Source and destination must be different'; end if;
  if not exists(select 1 from money_accounts where id=p_from_account_id and company_id=p_company_id and active) or
     not exists(select 1 from money_accounts where id=p_to_account_id and company_id=p_company_id and active) then raise exception 'Invalid cash or bank account'; end if;
  insert into voucher_sequences(fiscal_year_id,voucher_type,last_number) values(p_fiscal_year_id,'contra',1)
    on conflict(fiscal_year_id,voucher_type) do update set last_number=voucher_sequences.last_number+1 returning last_number into n;
  ref:=n::text;
  insert into vouchers(company_id,fiscal_year_id,voucher_type,voucher_no,sequence_no,voucher_date,narration,total,generated_by,handled_by)
  values(p_company_id,p_fiscal_year_id,'contra',ref,n,p_date,p_narration,p_amount,p_generated_by,p_generated_by) returning id into v_id;
  select record_money_transfer(p_company_id,p_fiscal_year_id,p_from_account_id,p_to_account_id,p_amount,p_date,
    coalesce(nullif(p_narration,''),'Contra transfer'),'',p_generated_by,p_generated_by) into movement_id;
  update money_movements set voucher_id=v_id,reference=ref where id=movement_id;
  select id into cash_gl from accounts where company_id=p_company_id and system_key='cash_bank';
  insert into journal_entries(company_id,fiscal_year_id,voucher_id,entry_date,reference,description,source_type)
  values(p_company_id,p_fiscal_year_id,v_id,p_date,ref,p_narration,'contra') returning id into j_id;
  insert into journal_lines(journal_entry_id,company_id,account_id,description,debit,credit) values
    (j_id,p_company_id,cash_gl,'Received into '||(select name from money_accounts where id=p_to_account_id),p_amount,0),
    (j_id,p_company_id,cash_gl,'Transferred from '||(select name from money_accounts where id=p_from_account_id),0,p_amount);
  return jsonb_build_object('id',v_id,'voucher_no',ref,'sequence_no',n,'movement_id',movement_id);
end $$;

create or replace function public.record_stock_adjustment(
  p_company_id uuid,p_fiscal_year_id uuid,p_date date,p_lines jsonb,p_narration text,
  p_generated_by uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer; ref text; v_id uuid; j_id uuid; line jsonb; product products%rowtype;
  delta numeric; cost numeric; line_value numeric; total_value numeric:=0; inv_account uuid; adjustment_account uuid;
begin
  if p_lines is null or jsonb_array_length(p_lines)=0 then raise exception 'Add at least one stock adjustment line'; end if;
  insert into voucher_sequences(fiscal_year_id,voucher_type,last_number) values(p_fiscal_year_id,'stock_adjustment',1)
    on conflict(fiscal_year_id,voucher_type) do update set last_number=voucher_sequences.last_number+1 returning last_number into n;
  ref:=n::text;
  for line in select * from jsonb_array_elements(p_lines) loop
    select * into product from products where id=(line->>'product_id')::uuid and company_id=p_company_id for update;
    if not found then raise exception 'Invalid stock item'; end if;
    delta:=(line->>'quantity_delta')::numeric;cost:=coalesce(nullif(line->>'unit_cost','')::numeric,product.purchase_price,0);
    if delta=0 or product.stock_qty+delta<0 then raise exception 'Adjustment would make stock negative for %',product.name; end if;
    total_value:=total_value+abs(round(delta*cost,2));
  end loop;
  insert into vouchers(company_id,fiscal_year_id,voucher_type,voucher_no,sequence_no,voucher_date,narration,total,generated_by,handled_by)
  values(p_company_id,p_fiscal_year_id,'stock_adjustment',ref,n,p_date,p_narration,total_value,p_generated_by,p_generated_by) returning id into v_id;
  insert into journal_entries(company_id,fiscal_year_id,voucher_id,entry_date,reference,description,source_type)
  values(p_company_id,p_fiscal_year_id,v_id,p_date,ref,p_narration,'stock_adjustment') returning id into j_id;
  select id into adjustment_account from accounts where company_id=p_company_id and system_key='inventory_adjustment';
  for line in select * from jsonb_array_elements(p_lines) loop
    select * into product from products where id=(line->>'product_id')::uuid and company_id=p_company_id for update;
    delta:=(line->>'quantity_delta')::numeric;cost:=coalesce(nullif(line->>'unit_cost','')::numeric,product.purchase_price,0);line_value:=abs(round(delta*cost,2));
    update products set stock_qty=stock_qty+delta where id=product.id;
    insert into voucher_lines(voucher_id,product_id,description,quantity,rate,amount,inventory_item)
    values(v_id,product.id,product.name,abs(delta),cost,line_value,true);
    insert into stock_adjustment_details(voucher_id,product_id,quantity_delta,unit_cost,reason)
    values(v_id,product.id,delta,cost,coalesce(nullif(line->>'reason',''),p_narration));
    insert into stock_movements(company_id,product_id,voucher_id,movement_date,quantity,movement_type,unit_cost,notes)
    values(p_company_id,product.id,v_id,p_date,delta,'adjustment',cost,coalesce(nullif(line->>'reason',''),p_narration));
    select id into inv_account from accounts where company_id=p_company_id and system_key=case when product.item_type in ('raw_material','packaging') then 'raw_inventory' else 'finished_inventory' end;
    if line_value>0 then
      insert into journal_lines(journal_entry_id,company_id,account_id,description,debit,credit) values
        (j_id,p_company_id,case when delta>0 then inv_account else adjustment_account end,product.name,line_value,0),
        (j_id,p_company_id,case when delta>0 then adjustment_account else inv_account end,product.name,0,line_value);
    end if;
  end loop;
  return jsonb_build_object('id',v_id,'voucher_no',ref,'sequence_no',n,'total',total_value);
end $$;

create or replace function public.record_payroll_run(
  p_company_id uuid,p_fiscal_year_id uuid,p_date date,p_period_label text,p_lines jsonb,
  p_notes text default '',p_created_by uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer; ref text; voucher_id uuid; run_id uuid; journal_id uuid; line jsonb; member_id uuid;
  basic numeric; allowances numeric; deductions numeric; net numeric; gross_total numeric:=0;
  deduction_total numeric:=0; net_total numeric:=0; expense_account uuid; payable_account uuid; deduction_account uuid;
begin
  if coalesce(trim(p_period_label),'')='' then raise exception 'Payroll period is required'; end if;
  if p_lines is null or jsonb_array_length(p_lines)=0 then raise exception 'Add at least one employee'; end if;
  for line in select * from jsonb_array_elements(p_lines) loop
    member_id:=(line->>'team_member_id')::uuid;basic:=coalesce((line->>'basic_salary')::numeric,0);
    allowances:=coalesce((line->>'allowances')::numeric,0);deductions:=coalesce((line->>'deductions')::numeric,0);
    if not exists(select 1 from team_members where id=member_id and company_id=p_company_id and active) then raise exception 'Invalid payroll employee'; end if;
    if basic<0 or allowances<0 or deductions<0 or deductions>basic+allowances then raise exception 'Invalid payroll amount'; end if;
    gross_total:=gross_total+basic+allowances;deduction_total:=deduction_total+deductions;net_total:=net_total+basic+allowances-deductions;
  end loop;
  if gross_total<=0 then raise exception 'Gross payroll must be greater than zero'; end if;
  insert into voucher_sequences(fiscal_year_id,voucher_type,last_number) values(p_fiscal_year_id,'payroll',1)
    on conflict(fiscal_year_id,voucher_type) do update set last_number=voucher_sequences.last_number+1 returning last_number into n;
  ref:=n::text;
  insert into vouchers(company_id,fiscal_year_id,voucher_type,voucher_no,sequence_no,voucher_date,narration,total,generated_by,handled_by)
  values(p_company_id,p_fiscal_year_id,'payroll',ref,n,p_date,p_notes,gross_total,p_created_by,p_created_by) returning id into voucher_id;
  insert into payroll_runs(company_id,fiscal_year_id,voucher_id,run_no,sequence_no,period_label,pay_date,gross_amount,deduction_amount,net_amount,notes,created_by)
  values(p_company_id,p_fiscal_year_id,voucher_id,ref,n,p_period_label,p_date,gross_total,deduction_total,net_total,p_notes,p_created_by) returning id into run_id;
  for line in select * from jsonb_array_elements(p_lines) loop
    member_id:=(line->>'team_member_id')::uuid;basic:=coalesce((line->>'basic_salary')::numeric,0);
    allowances:=coalesce((line->>'allowances')::numeric,0);deductions:=coalesce((line->>'deductions')::numeric,0);net:=basic+allowances-deductions;
    insert into payroll_lines(payroll_run_id,team_member_id,basic_salary,allowances,deductions,net_amount,notes)
    values(run_id,member_id,basic,allowances,deductions,net,line->>'notes');
  end loop;
  select id into expense_account from accounts where company_id=p_company_id and system_key='payroll_expense';
  select id into payable_account from accounts where company_id=p_company_id and system_key='payroll_payable';
  select id into deduction_account from accounts where company_id=p_company_id and system_key='payroll_deductions_payable';
  insert into journal_entries(company_id,fiscal_year_id,voucher_id,entry_date,reference,description,source_type)
  values(p_company_id,p_fiscal_year_id,voucher_id,p_date,ref,coalesce(nullif(p_notes,''),'Payroll '||p_period_label),'payroll') returning id into journal_id;
  insert into journal_lines(journal_entry_id,company_id,account_id,description,debit,credit) values
    (journal_id,p_company_id,expense_account,'Gross payroll · '||p_period_label,gross_total,0),
    (journal_id,p_company_id,payable_account,'Net salary payable · '||p_period_label,0,net_total);
  if deduction_total>0 then insert into journal_lines(journal_entry_id,company_id,account_id,description,debit,credit)
    values(journal_id,p_company_id,deduction_account,'Payroll deductions · '||p_period_label,0,deduction_total); end if;
  return jsonb_build_object('id',run_id,'voucher_id',voucher_id,'run_no',ref,'gross',gross_total,'net',net_total);
end $$;

create or replace function public.save_bill_of_materials(
  p_company_id uuid,p_output_product_id uuid,p_name text,p_version text,p_output_quantity numeric,
  p_components jsonb,p_notes text default '',p_created_by uuid default null,p_bom_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare bom_id uuid; component jsonb; component_id uuid;
begin
  if not exists(select 1 from products where id=p_output_product_id and company_id=p_company_id) then raise exception 'Output product is invalid'; end if;
  if p_output_quantity<=0 or p_components is null or jsonb_array_length(p_components)=0 then raise exception 'Output quantity and components are required'; end if;
  if p_bom_id is null then
    insert into bills_of_materials(company_id,output_product_id,name,version,output_quantity,notes,created_by)
    values(p_company_id,p_output_product_id,p_name,coalesce(nullif(p_version,''),'1'),p_output_quantity,p_notes,p_created_by) returning id into bom_id;
  else
    update bills_of_materials set output_product_id=p_output_product_id,name=p_name,version=coalesce(nullif(p_version,''),'1'),
      output_quantity=p_output_quantity,notes=p_notes,updated_at=now() where id=p_bom_id and company_id=p_company_id returning id into bom_id;
    if bom_id is null then raise exception 'BOM not found'; end if;
    delete from bom_components where bom_components.bom_id=p_bom_id;
  end if;
  for component in select * from jsonb_array_elements(p_components) loop
    component_id:=(component->>'product_id')::uuid;
    if component_id=p_output_product_id or not exists(select 1 from products where id=component_id and company_id=p_company_id) then raise exception 'Invalid BOM component'; end if;
    insert into bom_components(bom_id,product_id,quantity,wastage_percent,notes)
    values(bom_id,component_id,(component->>'quantity')::numeric,coalesce((component->>'wastage_percent')::numeric,0),component->>'notes');
  end loop;
  return jsonb_build_object('id',bom_id);
end $$;

create or replace function public.record_bom_production(
  p_company_id uuid,p_fiscal_year_id uuid,p_bom_id uuid,p_date date,p_output_quantity numeric,
  p_notes text default ''
) returns jsonb language plpgsql security definer set search_path=public as $$
declare bom bills_of_materials%rowtype; payload jsonb; result jsonb;
begin
  select * into bom from bills_of_materials where id=p_bom_id and company_id=p_company_id and active;
  if not found then raise exception 'Active BOM not found'; end if;
  if p_output_quantity<=0 then raise exception 'Production quantity must be greater than zero'; end if;
  select jsonb_agg(jsonb_build_object('product_id',bc.product_id,'quantity',
    round((bc.quantity*(1+bc.wastage_percent/100))*p_output_quantity/bom.output_quantity,3)) order by bc.id)
  into payload from bom_components bc where bc.bom_id=bom.id;
  select record_production_batch(p_company_id,p_fiscal_year_id,p_date,bom.output_product_id,p_output_quantity,payload,p_notes) into result;
  update production_batches set bom_id=bom.id where id=(result->>'id')::uuid;
  return result||jsonb_build_object('bom_id',bom.id);
end $$;

create or replace function public.record_production_batch(
  p_company_id uuid,p_fiscal_year_id uuid,p_date date,p_output_product_id uuid,
  p_output_quantity numeric,p_consumptions jsonb,p_notes text default ''
) returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer; batch_ref text; batch_id uuid; item jsonb; input_product uuid; input_qty numeric;
  available numeric; input_cost numeric; total_cost numeric:=0; journal_id uuid; raw_account uuid; finished_account uuid;
begin
  if p_output_quantity<=0 then raise exception 'Output quantity must be greater than zero'; end if;
  if p_consumptions is null or jsonb_array_length(p_consumptions)=0 then raise exception 'Add at least one raw material'; end if;
  if not exists(select 1 from products where id=p_output_product_id and company_id=p_company_id) then raise exception 'Output product is invalid'; end if;
  if p_date not between (select start_ad from fiscal_years where id=p_fiscal_year_id and company_id=p_company_id)
    and (select end_ad from fiscal_years where id=p_fiscal_year_id and company_id=p_company_id) then raise exception 'Production date is outside selected fiscal year'; end if;
  select coalesce(max((regexp_match(batch_no,'[0-9]+$'))[1]::integer),0)+1 into n from production_batches where fiscal_year_id=p_fiscal_year_id;
  batch_ref:=n::text;
  for item in select * from jsonb_array_elements(p_consumptions) loop
    input_product:=(item->>'product_id')::uuid; input_qty:=(item->>'quantity')::numeric;
    select stock_qty,purchase_price into available,input_cost from products where id=input_product and company_id=p_company_id for update;
    if not found then raise exception 'Production component is invalid'; end if;
    if input_qty<=0 then raise exception 'Consumption quantity must be greater than zero'; end if;
    if available<input_qty then raise exception 'Insufficient stock for %: available %, required %',(select name from products where id=input_product),available,input_qty; end if;
    total_cost:=total_cost+round(input_qty*coalesce(input_cost,0),2);
  end loop;
  insert into production_batches(company_id,fiscal_year_id,batch_no,production_date,output_product_id,output_quantity,notes)
    values(p_company_id,p_fiscal_year_id,batch_ref,p_date,p_output_product_id,p_output_quantity,p_notes) returning id into batch_id;
  for item in select * from jsonb_array_elements(p_consumptions) loop
    input_product:=(item->>'product_id')::uuid; input_qty:=(item->>'quantity')::numeric;
    select purchase_price into input_cost from products where id=input_product;
    insert into production_consumptions(batch_id,product_id,quantity) values(batch_id,input_product,input_qty);
    update products set stock_qty=stock_qty-input_qty where id=input_product;
    insert into stock_movements(company_id,product_id,production_batch_id,movement_date,quantity,movement_type,unit_cost,notes)
    values(p_company_id,input_product,batch_id,p_date,-input_qty,'out',input_cost,coalesce(nullif(p_notes,''),'Production consumption'));
  end loop;
  update products set stock_qty=stock_qty+p_output_quantity,item_type='finished_good',
    purchase_price=case when total_cost>0 then round(total_cost/p_output_quantity,2) else purchase_price end
  where id=p_output_product_id and company_id=p_company_id;
  insert into stock_movements(company_id,product_id,production_batch_id,movement_date,quantity,movement_type,unit_cost,notes)
  values(p_company_id,p_output_product_id,batch_id,p_date,p_output_quantity,'in',case when p_output_quantity>0 then total_cost/p_output_quantity else 0 end,coalesce(nullif(p_notes,''),'Production output'));
  if total_cost>0 then
    select id into raw_account from accounts where company_id=p_company_id and system_key='raw_inventory';
    select id into finished_account from accounts where company_id=p_company_id and system_key='finished_inventory';
    insert into journal_entries(company_id,fiscal_year_id,entry_date,reference,description,source_type)
    values(p_company_id,p_fiscal_year_id,p_date,'MO-'||batch_ref,coalesce(nullif(p_notes,''),'Production batch '||batch_ref),'production') returning id into journal_id;
    insert into journal_lines(journal_entry_id,company_id,account_id,description,debit,credit) values
      (journal_id,p_company_id,finished_account,'Finished goods produced',total_cost,0),
      (journal_id,p_company_id,raw_account,'Materials consumed',0,total_cost);
  end if;
  return jsonb_build_object('id',batch_id,'batch_no',batch_ref,'production_cost',total_cost);
end $$;

create or replace function public.record_sales_invoice(
  p_company_id uuid,p_fiscal_year_id uuid,p_party_id uuid,p_date date,p_lines jsonb,
  p_discount_percent numeric default 0,p_tax_percent numeric default 0,p_narration text default ''
) returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer; ref text; v_id uuid; line jsonb; product uuid; qty numeric; rate numeric;
  line_amount numeric; sub numeric:=0; discount_value numeric; taxable numeric; tax_value numeric; grand numeric;
  available numeric; item_cost numeric;
begin
  if p_lines is null or jsonb_array_length(p_lines)=0 then raise exception 'At least one product is required'; end if;
  if not exists(select 1 from fiscal_years where id=p_fiscal_year_id and company_id=p_company_id and p_date between start_ad and end_ad and status='open') then raise exception 'Fiscal year is closed or invoice date is invalid'; end if;
  if p_party_id is not null and not exists(select 1 from parties where id=p_party_id and company_id=p_company_id) then raise exception 'Customer is invalid'; end if;
  if p_discount_percent<0 or p_discount_percent>100 or p_tax_percent<0 then raise exception 'Invalid discount or tax percentage'; end if;
  for line in select * from jsonb_array_elements(p_lines) loop
    qty:=coalesce((line->>'quantity')::numeric,0);rate:=coalesce((line->>'rate')::numeric,0);product:=nullif(line->>'product_id','')::uuid;
    if qty<=0 or rate<0 then raise exception 'Invalid quantity or rate'; end if;
    if product is not null then
      select stock_qty into available from products where id=product and company_id=p_company_id for update;
      if not found then raise exception 'Invoice product is invalid'; end if;
      if available<qty then raise exception 'Insufficient stock for %: available %, required %',(select name from products where id=product),available,qty; end if;
    end if;
    sub:=sub+round(qty*rate,2);
  end loop;
  discount_value:=round(sub*p_discount_percent/100,2);taxable:=sub-discount_value;
  tax_value:=round(taxable*p_tax_percent/100,2);grand:=taxable+tax_value;
  insert into voucher_sequences(fiscal_year_id,voucher_type,last_number) values(p_fiscal_year_id,'sale',1)
    on conflict(fiscal_year_id,voucher_type) do update set last_number=voucher_sequences.last_number+1 returning last_number into n;
  ref:=n::text;
  insert into vouchers(company_id,party_id,voucher_type,voucher_no,voucher_date,narration,total,fiscal_year_id,sequence_no,subtotal,discount_percent,discount_amount,tax_percent,tax_amount)
  values(p_company_id,p_party_id,'sale',ref,p_date,p_narration,grand,p_fiscal_year_id,n,sub,p_discount_percent,discount_value,p_tax_percent,tax_value) returning id into v_id;
  for line in select * from jsonb_array_elements(p_lines) loop
    product:=nullif(line->>'product_id','')::uuid;qty:=(line->>'quantity')::numeric;rate:=(line->>'rate')::numeric;line_amount:=round(qty*rate,2);
    insert into voucher_lines(voucher_id,product_id,description,quantity,rate,amount,inventory_item)
    values(v_id,product,coalesce(nullif(line->>'name',''),'Custom item'),qty,rate,line_amount,product is not null);
    if product is not null then
      select purchase_price into item_cost from products where id=product;
      update products set stock_qty=stock_qty-qty where id=product and company_id=p_company_id;
      insert into stock_movements(company_id,product_id,voucher_id,movement_date,quantity,movement_type,unit_cost,notes)
      values(p_company_id,product,v_id,p_date,-qty,'out',item_cost,p_narration);
    end if;
  end loop;
  insert into ledger_entries(company_id,party_id,voucher_id,entry_date,account_name,debit,credit)
  values(p_company_id,p_party_id,v_id,p_date,'Party Account',grand,0);
  return jsonb_build_object('id',v_id,'voucher_no',ref,'sequence_no',n,'subtotal',sub,'discount',discount_value,'tax',tax_value,'total',grand);
end $$;

create or replace function public.record_purchase_invoice(
  p_company_id uuid,p_fiscal_year_id uuid,p_party_id uuid,p_date date,p_lines jsonb,
  p_discount_percent numeric default 0,p_tax_percent numeric default 0,p_narration text default ''
) returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer; ref text; v_id uuid; line jsonb; product uuid; qty numeric; rate numeric; line_amount numeric;
  subtotal_value numeric:=0; discount_value numeric; taxable_value numeric; tax_value numeric; total_value numeric;
  old_stock numeric; old_price numeric; new_price numeric;
begin
  if p_lines is null or jsonb_array_length(p_lines)=0 then raise exception 'At least one product is required'; end if;
  if not exists(select 1 from fiscal_years where id=p_fiscal_year_id and company_id=p_company_id and p_date between start_ad and end_ad and status='open') then raise exception 'Fiscal year is closed or purchase date is invalid'; end if;
  if not exists(select 1 from parties where id=p_party_id and company_id=p_company_id) then raise exception 'Supplier is invalid'; end if;
  if p_discount_percent<0 or p_discount_percent>100 or p_tax_percent<0 then raise exception 'Invalid discount or tax percentage'; end if;
  for line in select * from jsonb_array_elements(p_lines) loop
    qty:=coalesce((line->>'quantity')::numeric,0);rate:=coalesce((line->>'rate')::numeric,0);
    if qty<=0 or rate<0 or coalesce(line->>'name','')='' then raise exception 'Invalid purchase line'; end if;
    subtotal_value:=subtotal_value+round(qty*rate,2);
  end loop;
  discount_value:=round(subtotal_value*p_discount_percent/100,2);taxable_value:=subtotal_value-discount_value;
  tax_value:=round(taxable_value*p_tax_percent/100,2);total_value:=taxable_value+tax_value;
  insert into voucher_sequences(fiscal_year_id,voucher_type,last_number) values(p_fiscal_year_id,'purchase',1)
    on conflict(fiscal_year_id,voucher_type) do update set last_number=voucher_sequences.last_number+1 returning last_number into n;
  ref:=n::text;
  insert into vouchers(company_id,party_id,voucher_type,voucher_no,voucher_date,narration,total,subtotal,fiscal_year_id,
    sequence_no,discount_percent,discount_amount,tax_percent,tax_amount)
  values(p_company_id,p_party_id,'purchase',ref,p_date,p_narration,total_value,subtotal_value,p_fiscal_year_id,n,
    p_discount_percent,discount_value,p_tax_percent,tax_value) returning id into v_id;
  for line in select * from jsonb_array_elements(p_lines) loop
    product:=nullif(line->>'product_id','')::uuid;qty:=(line->>'quantity')::numeric;rate:=(line->>'rate')::numeric;line_amount:=round(qty*rate,2);
    if product is null then
      insert into products(company_id,name,unit,item_type,purchase_price,sale_price,mrp,stock_qty)
      values(p_company_id,line->>'name',coalesce(nullif(line->>'unit',''),'pcs'),coalesce(nullif(line->>'item_type',''),'finished_good'),rate,rate,rate,0) returning id into product;
    else
      select stock_qty,purchase_price into old_stock,old_price from products where id=product and company_id=p_company_id for update;
      if not found then raise exception 'Purchase product is invalid'; end if;
    end if;
    select stock_qty,purchase_price into old_stock,old_price from products where id=product for update;
    new_price:=case when old_stock+qty>0 then round((old_stock*old_price+qty*rate)/(old_stock+qty),2) else rate end;
    insert into voucher_lines(voucher_id,product_id,description,quantity,rate,amount,inventory_item)
    values(v_id,product,line->>'name',qty,rate,line_amount,true);
    update products set stock_qty=stock_qty+qty,purchase_price=new_price where id=product and company_id=p_company_id;
    insert into stock_movements(company_id,product_id,voucher_id,movement_date,quantity,movement_type,unit_cost,notes)
    values(p_company_id,product,v_id,p_date,qty,'in',rate,p_narration);
  end loop;
  insert into ledger_entries(company_id,party_id,voucher_id,entry_date,account_name,debit,credit)
  values(p_company_id,p_party_id,v_id,p_date,'Supplier Account',0,total_value);
  return jsonb_build_object('id',v_id,'voucher_no',ref,'sequence_no',n,'subtotal',subtotal_value,'discount',discount_value,'tax',tax_value,'total',total_value);
end $$;

-- Manual journals, contra and stock adjustments own their exact journal lines.
-- Automatic vouchers continue to be rebuilt from the voucher header.
create or replace function public.rebuild_voucher_journal(p_voucher_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v public.vouchers%rowtype; j uuid; dr_account uuid; cr_account uuid;
  cheque_account uuid; receivable_account uuid; revenue_account uuid; returns_account uuid;
  payable_account uuid; raw_account uuid; finished_account uuid; input_tax_account uuid; output_tax_account uuid;
  cogs_account uuid; taxable_value numeric; raw_value numeric; finished_value numeric; cogs_value numeric;
begin
  select * into v from public.vouchers where id=p_voucher_id;
  if not found or v.fiscal_year_id is null or coalesce(v.total,0)<=0 then return; end if;
  if v.voucher_type in ('journal','contra','stock_adjustment','payroll') then return; end if;
  delete from public.journal_entries where voucher_id=v.id;
  insert into public.journal_entries(company_id,fiscal_year_id,voucher_id,entry_date,reference,description)
  values(v.company_id,v.fiscal_year_id,v.id,v.voucher_date,v.voucher_no,v.narration) returning id into j;
  if v.voucher_type='receipt' and v.payment_mode='Cheque' then
    select id into cheque_account from public.accounts where company_id=v.company_id and system_key='cheques_in_hand';
    select id into receivable_account from public.accounts where company_id=v.company_id and system_key='accounts_receivable';
    insert into public.journal_lines(journal_entry_id,company_id,account_id,party_id,description,debit,credit) values
      (j,v.company_id,cheque_account,v.party_id,coalesce(nullif(v.narration,''),'Cheque received'),v.total,0),
      (j,v.company_id,receivable_account,v.party_id,coalesce(nullif(v.narration,''),'Cheque received'),0,v.total);
    if v.cheque_status='cancelled' then
      insert into public.journal_lines(journal_entry_id,company_id,account_id,party_id,description,debit,credit) values
        (j,v.company_id,receivable_account,v.party_id,'Cancelled cheque receipt adjusted',v.total,0),
        (j,v.company_id,cheque_account,v.party_id,'Cancelled cheque receipt adjusted',0,v.total);
    elsif v.cheque_status='cleared' then
      update public.journal_lines set account_id=(select id from public.accounts where company_id=v.company_id and system_key='cash_bank')
      where journal_entry_id=j and account_id=cheque_account and debit>0;
    end if;
    return;
  end if;

  taxable_value:=greatest(0,coalesce(v.subtotal,0)-coalesce(v.discount_amount,0));
  select id into receivable_account from accounts where company_id=v.company_id and system_key='accounts_receivable';
  select id into payable_account from accounts where company_id=v.company_id and system_key='accounts_payable';
  select id into revenue_account from accounts where company_id=v.company_id and system_key='sales_revenue';
  select id into returns_account from accounts where company_id=v.company_id and system_key='sales_returns';
  select id into raw_account from accounts where company_id=v.company_id and system_key='raw_inventory';
  select id into finished_account from accounts where company_id=v.company_id and system_key='finished_inventory';
  select id into input_tax_account from accounts where company_id=v.company_id and system_key='tax_input';
  select id into output_tax_account from accounts where company_id=v.company_id and system_key='tax_output';
  select id into cogs_account from accounts where company_id=v.company_id and system_key='cost_of_goods';

  if v.voucher_type='sale' then
    insert into journal_lines(journal_entry_id,company_id,account_id,party_id,description,debit,credit) values
      (j,v.company_id,receivable_account,v.party_id,v.narration,v.total,0),
      (j,v.company_id,revenue_account,v.party_id,v.narration,0,taxable_value);
    if coalesce(v.tax_amount,0)>0 then insert into journal_lines(journal_entry_id,company_id,account_id,party_id,description,debit,credit)
      values(j,v.company_id,output_tax_account,v.party_id,'Output tax',0,v.tax_amount); end if;
    select coalesce(sum(abs(sm.quantity)*coalesce(sm.unit_cost,p.purchase_price)),0) into cogs_value
    from stock_movements sm join products p on p.id=sm.product_id and p.company_id=sm.company_id where sm.voucher_id=v.id;
    if cogs_value>0 then insert into journal_lines(journal_entry_id,company_id,account_id,description,debit,credit) values
      (j,v.company_id,cogs_account,'Cost of goods sold',cogs_value,0),(j,v.company_id,finished_account,'Inventory issued',0,cogs_value); end if;
    return;
  elsif v.voucher_type='sale_return' then
    insert into journal_lines(journal_entry_id,company_id,account_id,party_id,description,debit,credit) values
      (j,v.company_id,returns_account,v.party_id,v.narration,taxable_value,0),
      (j,v.company_id,receivable_account,v.party_id,v.narration,0,v.total);
    if coalesce(v.tax_amount,0)>0 then insert into journal_lines(journal_entry_id,company_id,account_id,party_id,description,debit,credit)
      values(j,v.company_id,output_tax_account,v.party_id,'Output tax reversed',v.tax_amount,0); end if;
    select coalesce(sum(abs(sm.quantity)*coalesce(sm.unit_cost,p.purchase_price)),0) into cogs_value
    from stock_movements sm join products p on p.id=sm.product_id and p.company_id=sm.company_id where sm.voucher_id=v.id;
    if cogs_value>0 then insert into journal_lines(journal_entry_id,company_id,account_id,description,debit,credit) values
      (j,v.company_id,finished_account,'Returned inventory received',cogs_value,0),(j,v.company_id,cogs_account,'Cost of goods reversed',0,cogs_value); end if;
    return;
  elsif v.voucher_type in ('purchase','purchase_return') then
    select coalesce(sum(vl.amount),0) into raw_value from voucher_lines vl join products p on p.id=vl.product_id where vl.voucher_id=v.id and p.item_type in ('raw_material','packaging');
    select coalesce(sum(vl.amount),0) into finished_value from voucher_lines vl join products p on p.id=vl.product_id where vl.voucher_id=v.id and p.item_type in ('finished_good','resale_good');
    if raw_value+finished_value>0 and taxable_value<>raw_value+finished_value then
      raw_value:=round(raw_value*taxable_value/(raw_value+finished_value),2); finished_value:=taxable_value-raw_value;
    elsif raw_value+finished_value=0 then raw_value:=taxable_value; end if;
    if v.voucher_type='purchase' then
      if raw_value>0 then insert into journal_lines(journal_entry_id,company_id,account_id,description,debit,credit) values(j,v.company_id,raw_account,'Raw material / packaging purchased',raw_value,0); end if;
      if finished_value>0 then insert into journal_lines(journal_entry_id,company_id,account_id,description,debit,credit) values(j,v.company_id,finished_account,'Finished / resale stock purchased',finished_value,0); end if;
      if coalesce(v.tax_amount,0)>0 then insert into journal_lines(journal_entry_id,company_id,account_id,description,debit,credit) values(j,v.company_id,input_tax_account,'Input tax',v.tax_amount,0); end if;
      insert into journal_lines(journal_entry_id,company_id,account_id,party_id,description,debit,credit) values(j,v.company_id,payable_account,v.party_id,v.narration,0,v.total);
    else
      insert into journal_lines(journal_entry_id,company_id,account_id,party_id,description,debit,credit) values(j,v.company_id,payable_account,v.party_id,v.narration,v.total,0);
      if raw_value>0 then insert into journal_lines(journal_entry_id,company_id,account_id,description,debit,credit) values(j,v.company_id,raw_account,'Raw material purchase returned',0,raw_value); end if;
      if finished_value>0 then insert into journal_lines(journal_entry_id,company_id,account_id,description,debit,credit) values(j,v.company_id,finished_account,'Finished stock purchase returned',0,finished_value); end if;
      if coalesce(v.tax_amount,0)>0 then insert into journal_lines(journal_entry_id,company_id,account_id,description,debit,credit) values(j,v.company_id,input_tax_account,'Input tax reversed',0,v.tax_amount); end if;
    end if;
    return;
  elsif v.voucher_type='receipt' then
    select id into dr_account from public.accounts where company_id=v.company_id and system_key='cash_bank'; cr_account:=receivable_account;
  elsif v.voucher_type='expense' then
    select id into dr_account from public.accounts where company_id=v.company_id and system_key='office_expense';
    select id into cr_account from public.accounts where company_id=v.company_id and system_key='cash_bank';
  elsif v.voucher_type='payment' then
    dr_account:=payable_account; select id into cr_account from public.accounts where company_id=v.company_id and system_key='cash_bank';
  else
    delete from public.journal_entries where id=j; return;
  end if;
  insert into public.journal_lines(journal_entry_id,company_id,account_id,party_id,description,debit,credit) values
    (j,v.company_id,dr_account,v.party_id,v.narration,v.total,0),(j,v.company_id,cr_account,v.party_id,v.narration,0,v.total);
end $$;

do $$ declare row record; begin
  for row in select id from public.vouchers where fiscal_year_id is not null loop perform public.rebuild_voucher_journal(row.id); end loop;
end $$;

revoke all on function public.record_purchase_order(uuid,uuid,uuid,date,date,jsonb,numeric,numeric,text,text,uuid) from public,anon,authenticated;
revoke all on function public.convert_purchase_order_to_bill(uuid,date,uuid) from public,anon,authenticated;
revoke all on function public.record_goods_return(uuid,uuid,uuid,text,date,jsonb,text,uuid) from public,anon,authenticated;
revoke all on function public.record_manual_journal(uuid,uuid,date,jsonb,text,uuid) from public,anon,authenticated;
revoke all on function public.record_contra_voucher(uuid,uuid,date,uuid,uuid,numeric,text,uuid) from public,anon,authenticated;
revoke all on function public.record_stock_adjustment(uuid,uuid,date,jsonb,text,uuid) from public,anon,authenticated;
revoke all on function public.save_bill_of_materials(uuid,uuid,text,text,numeric,jsonb,text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.record_bom_production(uuid,uuid,uuid,date,numeric,text) from public,anon,authenticated;
revoke all on function public.record_payroll_run(uuid,uuid,date,text,jsonb,text,uuid) from public,anon,authenticated;
revoke all on function public.record_sales_invoice(uuid,uuid,uuid,date,jsonb,numeric,numeric,text) from public,anon,authenticated;
revoke all on function public.record_purchase_invoice(uuid,uuid,uuid,date,jsonb,numeric,numeric,text) from public,anon,authenticated;
grant execute on function public.record_purchase_order(uuid,uuid,uuid,date,date,jsonb,numeric,numeric,text,text,uuid) to service_role;
grant execute on function public.convert_purchase_order_to_bill(uuid,date,uuid) to service_role;
grant execute on function public.record_goods_return(uuid,uuid,uuid,text,date,jsonb,text,uuid) to service_role;
grant execute on function public.record_manual_journal(uuid,uuid,date,jsonb,text,uuid) to service_role;
grant execute on function public.record_contra_voucher(uuid,uuid,date,uuid,uuid,numeric,text,uuid) to service_role;
grant execute on function public.record_stock_adjustment(uuid,uuid,date,jsonb,text,uuid) to service_role;
grant execute on function public.save_bill_of_materials(uuid,uuid,text,text,numeric,jsonb,text,uuid,uuid) to service_role;
grant execute on function public.record_bom_production(uuid,uuid,uuid,date,numeric,text) to service_role;
grant execute on function public.record_payroll_run(uuid,uuid,date,text,jsonb,text,uuid) to service_role;
grant execute on function public.record_sales_invoice(uuid,uuid,uuid,date,jsonb,numeric,numeric,text) to service_role;
grant execute on function public.record_purchase_invoice(uuid,uuid,uuid,date,jsonb,numeric,numeric,text) to service_role;
grant all on public.purchase_orders,public.purchase_order_lines,public.bills_of_materials,public.bom_components,public.stock_adjustment_details,public.payroll_runs,public.payroll_lines to service_role;
