alter table public.products add column if not exists item_type text not null default 'finished_good'
  check (item_type in ('raw_material','packaging','finished_good','resale_good'));

-- Invoice, receipt and purchase sequences are independent within each fiscal year.
alter table public.vouchers drop constraint if exists vouchers_company_id_voucher_no_key;
create unique index if not exists vouchers_fy_type_sequence_unique
  on public.vouchers(fiscal_year_id,voucher_type,sequence_no)
  where fiscal_year_id is not null and sequence_no is not null;

create table if not exists public.production_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  fiscal_year_id uuid not null references public.fiscal_years(id),
  batch_no text not null,
  production_date date not null,
  output_product_id uuid not null references public.products(id),
  output_quantity numeric(18,3) not null check(output_quantity > 0),
  notes text,
  created_at timestamptz not null default now(),
  unique(company_id,fiscal_year_id,batch_no)
);

create table if not exists public.production_consumptions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.production_batches(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity numeric(18,3) not null check(quantity > 0)
);

alter table public.production_batches enable row level security;
alter table public.production_consumptions enable row level security;

create or replace function public.record_production_batch(
  p_company_id uuid,p_fiscal_year_id uuid,p_date date,p_output_product_id uuid,
  p_output_quantity numeric,p_consumptions jsonb,p_notes text default ''
) returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer; batch_ref text; batch_id uuid; item jsonb; input_product uuid; input_qty numeric; available numeric;
begin
  if p_output_quantity<=0 then raise exception 'Output quantity must be greater than zero'; end if;
  if p_consumptions is null or jsonb_array_length(p_consumptions)=0 then raise exception 'Add at least one raw material'; end if;
  if p_date not between (select start_ad from fiscal_years where id=p_fiscal_year_id) and (select end_ad from fiscal_years where id=p_fiscal_year_id) then raise exception 'Production date is outside selected fiscal year'; end if;
  select coalesce(max((regexp_match(batch_no,'[0-9]+$'))[1]::integer),0)+1 into n from production_batches where fiscal_year_id=p_fiscal_year_id;
  batch_ref:=n::text;
  for item in select * from jsonb_array_elements(p_consumptions) loop
    input_product:=(item->>'product_id')::uuid; input_qty:=(item->>'quantity')::numeric;
    select stock_qty into available from products where id=input_product and company_id=p_company_id for update;
    if input_qty<=0 then raise exception 'Consumption quantity must be greater than zero'; end if;
    if available<input_qty then raise exception 'Insufficient stock for %: available %, required %',(select name from products where id=input_product),available,input_qty; end if;
  end loop;
  insert into production_batches(company_id,fiscal_year_id,batch_no,production_date,output_product_id,output_quantity,notes)
    values(p_company_id,p_fiscal_year_id,batch_ref,p_date,p_output_product_id,p_output_quantity,p_notes) returning id into batch_id;
  for item in select * from jsonb_array_elements(p_consumptions) loop
    input_product:=(item->>'product_id')::uuid; input_qty:=(item->>'quantity')::numeric;
    insert into production_consumptions(batch_id,product_id,quantity) values(batch_id,input_product,input_qty);
    update products set stock_qty=stock_qty-input_qty where id=input_product;
  end loop;
  update products set stock_qty=stock_qty+p_output_quantity,item_type='finished_good' where id=p_output_product_id and company_id=p_company_id;
  return jsonb_build_object('id',batch_id,'batch_no',batch_ref);
end $$;

create or replace function public.record_purchase_bill(
  p_company_id uuid,p_fiscal_year_id uuid,p_party_id uuid,p_date date,p_lines jsonb,p_narration text default ''
) returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer; ref text; v_id uuid; line jsonb; product uuid; qty numeric; rate numeric; amount numeric; total_value numeric:=0;
begin
  if p_lines is null or jsonb_array_length(p_lines)=0 then raise exception 'At least one product is required'; end if;
  for line in select * from jsonb_array_elements(p_lines) loop qty:=(line->>'quantity')::numeric;rate:=(line->>'rate')::numeric;if qty<=0 or rate<0 then raise exception 'Invalid line';end if;total_value:=total_value+qty*rate;end loop;
  insert into voucher_sequences(fiscal_year_id,voucher_type,last_number) values(p_fiscal_year_id,'purchase',1) on conflict(fiscal_year_id,voucher_type) do update set last_number=voucher_sequences.last_number+1 returning last_number into n;
  ref:=n::text;
  insert into vouchers(company_id,party_id,voucher_type,voucher_no,voucher_date,narration,total,subtotal,fiscal_year_id,sequence_no) values(p_company_id,p_party_id,'purchase',ref,p_date,p_narration,total_value,total_value,p_fiscal_year_id,n) returning id into v_id;
  for line in select * from jsonb_array_elements(p_lines) loop
    product:=nullif(line->>'product_id','')::uuid;qty:=(line->>'quantity')::numeric;rate:=(line->>'rate')::numeric;amount:=qty*rate;
    if product is null then
      insert into products(company_id,name,unit,item_type,purchase_price,sale_price,stock_qty) values(p_company_id,line->>'name',coalesce(nullif(line->>'unit',''),'pcs'),coalesce(nullif(line->>'item_type',''),'finished_good'),rate,rate,0) returning id into product;
    end if;
    insert into voucher_lines(voucher_id,product_id,description,quantity,rate,amount,inventory_item) values(v_id,product,line->>'name',qty,rate,amount,true);
    update products set stock_qty=stock_qty+qty,purchase_price=rate where id=product;
    insert into stock_movements(company_id,product_id,voucher_id,movement_date,quantity,movement_type) values(p_company_id,product,v_id,p_date,qty,'in');
  end loop;
  insert into ledger_entries(company_id,party_id,voucher_id,entry_date,account_name,debit,credit) values(p_company_id,p_party_id,v_id,p_date,'Supplier Account',0,total_value);
  return jsonb_build_object('id',v_id,'voucher_no',ref,'sequence_no',n,'total',total_value);
end $$;
