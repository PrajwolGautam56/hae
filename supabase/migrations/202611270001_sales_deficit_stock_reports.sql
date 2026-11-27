-- Permit an audited sales deficit, while retaining stock protection elsewhere.
-- No existing product quantities, invoices, ledger entries or movements are changed.
-- A new audit ordering column resolves equal timestamps (including repeated
-- product lines posted in the same transaction); historical values stay intact.
alter table public.stock_movements add column movement_order bigint generated always as identity;
create index stock_company_period_audit_idx on public.stock_movements(company_id,movement_date,created_at,movement_order);
create or replace function public.prevent_negative_stock() returns trigger language plpgsql set search_path=public as $$
begin
  if new.stock_qty<0
     and not (old.stock_qty<0 and new.stock_qty>=old.stock_qty)
     and current_setting('hae.sales_stock_company',true) is distinct from new.company_id::text then
    raise exception 'Insufficient stock for %',new.name;
  end if;
  return new;
end $$;

create or replace function public.record_numbered_sales_invoice(
  p_company_id uuid,p_fiscal_year_id uuid,p_party_id uuid,p_date date,p_lines jsonb,
  p_discount_percent numeric,p_tax_percent numeric,p_narration text,p_number_series text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer; ref text; v_id uuid; line jsonb; product uuid; qty numeric; rate numeric;
  line_amount numeric; sub numeric:=0; discount_value numeric; taxable numeric; tax_value numeric; grand numeric;
  previous_stock_scope text:=current_setting('hae.sales_stock_company',true); available numeric; item_cost numeric; required record; sequence_key text;
begin
  if p_number_series is null or p_number_series not in ('standard','non_vat') then raise exception 'Invalid invoice number series'; end if;
  if p_number_series='non_vat' and p_tax_percent<>0 then raise exception 'A non-VAT bill cannot include VAT'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'At least one product is required'; end if;
  if not exists(select 1 from fiscal_years where id=p_fiscal_year_id and company_id=p_company_id and p_date between start_ad and end_ad and status='open') then raise exception 'Fiscal year is closed or invoice date is invalid'; end if;
  if p_party_id is not null and not exists(select 1 from parties where id=p_party_id and company_id=p_company_id) then raise exception 'Customer is invalid'; end if;
  if p_discount_percent is null or p_tax_percent is null or p_discount_percent::text in ('NaN','Infinity','-Infinity') or p_tax_percent::text in ('NaN','Infinity','-Infinity') or p_discount_percent<0 or p_discount_percent>100 or p_tax_percent<0 or p_tax_percent>100 then raise exception 'Invalid discount or tax percentage'; end if;
  for line in select * from jsonb_array_elements(p_lines) loop
    qty:=coalesce((line->>'quantity')::numeric,0);rate:=coalesce((line->>'rate')::numeric,0);
    if qty::text in ('NaN','Infinity','-Infinity') or rate::text in ('NaN','Infinity','-Infinity') or qty<=0 or rate<0 or nullif(trim(line->>'name'),'') is null then raise exception 'Invalid item, quantity or rate'; end if;
    sub:=sub+round(qty*rate,2);
  end loop;
  -- Lock products in a stable order and validate combined quantities, including repeated lines.
  for required in select nullif(x->>'product_id','')::uuid as product_id,sum((x->>'quantity')::numeric) as quantity
    from jsonb_array_elements(p_lines) x where nullif(x->>'product_id','') is not null
    group by nullif(x->>'product_id','')::uuid order by nullif(x->>'product_id','')::uuid
  loop
    select stock_qty into available from products where id=required.product_id and company_id=p_company_id for update;
    if not found then raise exception 'Invoice product is invalid'; end if;

  end loop;
  discount_value:=round(sub*p_discount_percent/100,2);taxable:=sub-discount_value;
  tax_value:=round(taxable*p_tax_percent/100,2);grand:=taxable+tax_value;
  sequence_key:=case when p_number_series='non_vat' then 'sale_non_vat' else 'sale' end;
  insert into voucher_sequences(fiscal_year_id,voucher_type,last_number) values(p_fiscal_year_id,sequence_key,1)
    on conflict(fiscal_year_id,voucher_type) do update set last_number=voucher_sequences.last_number+1 returning last_number into n;
  ref:=case when p_number_series='non_vat' then 'NB '||n::text else n::text end;
  insert into vouchers(company_id,party_id,voucher_type,voucher_no,voucher_date,narration,total,fiscal_year_id,sequence_no,
    subtotal,discount_percent,discount_amount,tax_percent,tax_amount,number_series,bill_category)
  values(p_company_id,p_party_id,'sale',ref,p_date,p_narration,grand,p_fiscal_year_id,n,
    sub,p_discount_percent,discount_value,p_tax_percent,tax_value,p_number_series,case when p_number_series='non_vat' then 'non_vat' else 'unclassified' end) returning id into v_id;
  perform set_config('hae.sales_stock_company',p_company_id::text,true);
  for line in select * from jsonb_array_elements(p_lines) loop
    product:=nullif(line->>'product_id','')::uuid;qty:=(line->>'quantity')::numeric;rate:=(line->>'rate')::numeric;line_amount:=round(qty*rate,2);
    insert into voucher_lines(voucher_id,product_id,description,quantity,rate,amount,inventory_item)
      values(v_id,product,line->>'name',qty,rate,line_amount,product is not null);
    if product is not null then
      select purchase_price into item_cost from products where id=product;
      update products set stock_qty=stock_qty-qty where id=product and company_id=p_company_id;
      insert into stock_movements(company_id,product_id,voucher_id,movement_date,quantity,movement_type,unit_cost,notes)
        values(p_company_id,product,v_id,p_date,-qty,'out',item_cost,p_narration);
    end if;
  end loop;
  insert into ledger_entries(company_id,party_id,voucher_id,entry_date,account_name,debit,credit)
    values(p_company_id,p_party_id,v_id,p_date,'Party Account',grand,0);
  perform set_config('hae.sales_stock_company',coalesce(previous_stock_scope,''),true);
  return jsonb_build_object('id',v_id,'voucher_no',ref,'sequence_no',n,'number_series',p_number_series,
    'subtotal',sub,'discount',discount_value,'tax',tax_value,'total',grand);
end $$;


create or replace function public.update_sales_invoice(
  p_voucher_id uuid,p_party_id uuid,p_date date,p_lines jsonb,p_discount_percent numeric default 0,p_tax_percent numeric default 0,p_narration text default ''
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v vouchers%rowtype; line jsonb; product uuid; qty numeric; rate numeric; line_amount numeric; sub numeric:=0; discount_value numeric; taxable numeric; tax_value numeric; grand numeric; available numeric; previous_stock_scope text:=current_setting('hae.sales_stock_company',true);
begin
  select * into v from vouchers where id=p_voucher_id and voucher_type='sale' for update;
  if v.id is null then raise exception 'Sales invoice not found'; end if;
  if v.document_status='cancelled' then raise exception 'A cancelled bill cannot be edited'; end if;
  if not exists(select 1 from fiscal_years where id=v.fiscal_year_id and company_id=v.company_id and status='open') then raise exception 'Fiscal year is closed'; end if;
  if p_party_id is not null and not exists(select 1 from parties where id=p_party_id and company_id=v.company_id) then raise exception 'Customer is invalid'; end if;
  if p_discount_percent is null or p_tax_percent is null or p_discount_percent::text in ('NaN','Infinity','-Infinity') or p_tax_percent::text in ('NaN','Infinity','-Infinity') or p_discount_percent<0 or p_discount_percent>100 or p_tax_percent<0 or p_tax_percent>100 then raise exception 'Invalid discount or tax percentage'; end if;
  if p_date not between (select start_ad from fiscal_years where id=v.fiscal_year_id) and (select end_ad from fiscal_years where id=v.fiscal_year_id) then raise exception 'Date is outside invoice fiscal year'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'At least one product is required'; end if;
  -- Lock the union of old and new items in stable order before reversing stock.
  perform 1 from products p where p.company_id=v.company_id and p.id in (
    select product_id from voucher_lines where voucher_id=v.id and product_id is not null
    union select nullif(x->>'product_id','')::uuid from jsonb_array_elements(p_lines) x
  ) order by p.id for update;
  insert into voucher_audit_logs(voucher_id,before_data) select v.id,jsonb_build_object('voucher',to_jsonb(v),'lines',coalesce(jsonb_agg(to_jsonb(vl)) filter(where vl.id is not null),'[]'::jsonb)) from voucher_lines vl where vl.voucher_id=v.id group by v.id;
  perform set_config('hae.sales_stock_company',v.company_id::text,true);
  update products p set stock_qty=p.stock_qty+old.quantity from (select product_id,sum(quantity) quantity from voucher_lines where voucher_id=v.id and product_id is not null group by product_id) old where p.id=old.product_id;
  delete from stock_movements where voucher_id=v.id; delete from voucher_lines where voucher_id=v.id;
  for line in select * from jsonb_array_elements(p_lines) loop
    product:=nullif(line->>'product_id','')::uuid;qty:=coalesce((line->>'quantity')::numeric,0);rate:=coalesce((line->>'rate')::numeric,0);
    if qty::text in ('NaN','Infinity','-Infinity') or rate::text in ('NaN','Infinity','-Infinity') or qty<=0 or rate<0 then raise exception 'Invalid quantity or rate'; end if; line_amount:=round(qty*rate,2);sub:=sub+line_amount;
    if product is not null then select stock_qty into available from products where id=product and company_id=v.company_id for update; if not found then raise exception 'Invoice product is invalid'; end if; end if;
    insert into voucher_lines(voucher_id,product_id,description,quantity,rate,amount,inventory_item) values(v.id,product,coalesce(nullif(line->>'name',''),(select name from products where id=product),'Custom item'),qty,rate,line_amount,product is not null);
    if product is not null then update products set stock_qty=stock_qty-qty where id=product and company_id=v.company_id;insert into stock_movements(company_id,product_id,voucher_id,movement_date,quantity,movement_type,unit_cost,notes) values(v.company_id,product,v.id,p_date,-qty,'out',(select purchase_price from products where id=product),p_narration);end if;
  end loop;
  discount_value:=round(sub*greatest(0,p_discount_percent)/100,2);taxable:=sub-discount_value;tax_value:=round(taxable*greatest(0,p_tax_percent)/100,2);grand:=taxable+tax_value;
  update vouchers set party_id=p_party_id,voucher_date=p_date,narration=p_narration,total=grand,subtotal=sub,discount_percent=p_discount_percent,discount_amount=discount_value,tax_percent=p_tax_percent,tax_amount=tax_value where id=v.id;
  update ledger_entries set party_id=p_party_id,entry_date=p_date,debit=grand,credit=0 where voucher_id=v.id;
  perform set_config('hae.sales_stock_company',coalesce(previous_stock_scope,''),true);
  return jsonb_build_object('id',v.id,'total',grand);
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
    if delta=0 or (product.stock_qty+delta<0 and delta<0) then raise exception 'Adjustment would make stock negative for %',product.name; end if;
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


create or replace function public.record_manual_stock_adjustment(
 p_company_id uuid,p_fiscal_year_id uuid,p_product_id uuid,p_actor_id uuid,p_request_id uuid,p_date date,
 p_mode text,p_quantity numeric,p_expected_stock numeric,p_expected_cost numeric,p_reason text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare prior manual_stock_requests%rowtype; product products%rowtype; payload jsonb; result jsonb; delta numeric; note text;
begin
 if not exists(select 1 from team_members where id=p_actor_id and company_id=p_company_id and active and role in ('admin','manager','accountant')) then raise exception 'Company administrator, manager or accountant required'; end if;
 if p_request_id is null then raise exception 'Request ID required'; end if;
 payload:=jsonb_build_object('fiscalYearId',p_fiscal_year_id,'productId',p_product_id,'actorId',p_actor_id,'date',p_date,'mode',p_mode,'quantity',p_quantity,'expectedStock',p_expected_stock,'expectedCost',p_expected_cost,'reason',trim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_request_id::text,0));
 select * into prior from manual_stock_requests where company_id=p_company_id and request_id=p_request_id;
 if found then
   if prior.request_payload is distinct from payload then raise exception 'Request was already used with different values; check stock history before starting another adjustment'; end if;
   return prior.result||jsonb_build_object('duplicate',true);
 end if;
 if not exists(select 1 from companies where id=p_company_id and active) or not exists(select 1 from fiscal_years where id=p_fiscal_year_id and company_id=p_company_id and status='open' and p_date between start_ad and end_ad) then raise exception 'Select an open fiscal year and a date inside it'; end if;
 if p_mode is null or p_mode not in ('add','remove','count') or p_quantity is null or p_quantity::text in ('NaN','Infinity','-Infinity') or p_quantity<0 or p_quantity>1000000000 or p_quantity<>round(p_quantity,3) or (p_mode<>'count' and p_quantity=0) then raise exception 'Invalid stock adjustment quantity'; end if;
 if p_reason is null or length(trim(p_reason))<3 or length(p_reason)>1000 then raise exception 'A manual stock reason is required'; end if;
 -- Match the existing stock-journal lock order: sequence first, then product.
 insert into voucher_sequences(fiscal_year_id,voucher_type,last_number) values(p_fiscal_year_id,'stock_adjustment',0) on conflict do nothing;
 perform 1 from voucher_sequences where fiscal_year_id=p_fiscal_year_id and voucher_type='stock_adjustment' for update;
 select * into product from products where id=p_product_id and company_id=p_company_id and active for update;
 if not found then raise exception 'Active stock product does not belong to this company'; end if;
 if p_expected_stock is distinct from product.stock_qty or p_expected_cost is distinct from product.purchase_price then raise exception 'Stock or book cost changed. Refresh and review before saving'; end if;
 delta:=case p_mode when 'count' then p_quantity-product.stock_qty when 'remove' then -p_quantity else p_quantity end;
 if delta=0 then raise exception 'Stock is already equal to the counted quantity; no change needed'; end if;
 if product.stock_qty+delta<0 and delta<0 then raise exception 'This adjustment would make stock negative'; end if;
 note:='Manual stock adjustment (not a purchase): '||trim(p_reason)||case when product.purchase_price=0 then ' [No non-zero book cost recorded; quantity-only adjustment]' else '' end;
 result:=record_stock_adjustment(p_company_id,p_fiscal_year_id,p_date,jsonb_build_array(jsonb_build_object('product_id',product.id,'quantity_delta',delta,'unit_cost',product.purchase_price,'reason',note)),note,p_actor_id);
 result:=result||jsonb_build_object('requestId',p_request_id,'productId',product.id,'date',p_date,'stockBefore',product.stock_qty,'stockAfter',product.stock_qty+delta,'quantityDelta',delta,'unitCost',product.purchase_price,'source','manual','reason',trim(p_reason));
 insert into manual_stock_requests(company_id,request_id,product_id,fiscal_year_id,actor_id,voucher_id,request_payload,result)
 values(p_company_id,p_request_id,product.id,p_fiscal_year_id,p_actor_id,(result->>'id')::uuid,payload,result);
 return result;
end $$;

-- All mutations remain server-only. CREATE OR REPLACE preserves existing ACLs;
-- repeat the policy explicitly for fresh deployments and reviews.
revoke all on function public.record_numbered_sales_invoice(uuid,uuid,uuid,date,jsonb,numeric,numeric,text,text),
 public.update_sales_invoice(uuid,uuid,date,jsonb,numeric,numeric,text),
 public.record_stock_adjustment(uuid,uuid,date,jsonb,text,uuid),
 public.record_manual_stock_adjustment(uuid,uuid,uuid,uuid,uuid,date,text,numeric,numeric,numeric,text)
 from public,anon,authenticated;
grant execute on function public.record_numbered_sales_invoice(uuid,uuid,uuid,date,jsonb,numeric,numeric,text,text),
 public.update_sales_invoice(uuid,uuid,date,jsonb,numeric,numeric,text),
 public.record_stock_adjustment(uuid,uuid,date,jsonb,text,uuid),
 public.record_manual_stock_adjustment(uuid,uuid,uuid,uuid,uuid,date,text,numeric,numeric,numeric,text)
 to service_role;

-- A single MVCC snapshot keeps quantities, movements and actor metadata consistent
-- even if another staff member posts an invoice during report generation.
create function public.stock_report_snapshot(p_company_id uuid,p_from date,p_to date)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
  'products',coalesce((select jsonb_agg(to_jsonb(p) order by p.name,p.id) from
    (select id,sku,name,unit,item_type,stock_qty,purchase_price,sale_price,created_at from products where company_id=p_company_id) p),'[]'::jsonb),
  'future',coalesce((select jsonb_agg(to_jsonb(f)) from
    (select product_id,sum(quantity) quantity from stock_movements where company_id=p_company_id and movement_date>p_to group by product_id) f),'[]'::jsonb),
  'movements',coalesce((select jsonb_agg(to_jsonb(m) order by m.movement_date,m.created_at,m.movement_order) from (
    select s.id,s.product_id,s.voucher_id,s.production_batch_id,s.movement_date,s.created_at,s.movement_order,s.quantity,s.movement_type,s.unit_cost,s.notes,
      v.voucher_no,v.voucher_type,b.batch_no,
      coalesce(r.actor_id,v.generated_by,v.handled_by) actor_id,
      tm.name actor_name,r.request_id manual_request_id,r.result->>'reason' manual_reason,
      r.created_at manual_recorded_at
    from stock_movements s
    left join vouchers v on v.id=s.voucher_id and v.company_id=p_company_id
    left join production_batches b on b.id=s.production_batch_id and b.company_id=p_company_id
    left join manual_stock_requests r on r.voucher_id=s.voucher_id and r.product_id=s.product_id and r.company_id=p_company_id
    left join team_members tm on tm.id=coalesce(r.actor_id,v.generated_by,v.handled_by) and tm.company_id=p_company_id
    where s.company_id=p_company_id and s.movement_date between p_from and p_to
  ) m),'[]'::jsonb)
 );
$$;
revoke all on function public.stock_report_snapshot(uuid,date,date) from public,anon,authenticated;
grant execute on function public.stock_report_snapshot(uuid,date,date) to service_role;

-- Product creation must not overwrite an existing item's quantity through an
-- upsert. Initial stock uses the same staff-attributed manual journal as later
-- additions, so every new opening quantity appears in the movement report.
create function public.create_catalog_product(
 p_company_id uuid,p_fiscal_year_id uuid,p_actor_id uuid,p_date date,p_product jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare item products%rowtype; qty numeric:=coalesce((p_product->>'openingStock')::numeric,0);
 cost numeric:=coalesce((p_product->>'purchasePrice')::numeric,0); price numeric:=coalesce((p_product->>'salePrice')::numeric,0);
 retail numeric:=coalesce((p_product->>'mrp')::numeric,0); low numeric:=coalesce((p_product->>'lowStockAt')::numeric,0); value numeric; adjustment jsonb;
begin
 if not exists(select 1 from team_members where id=p_actor_id and company_id=p_company_id and active) then raise exception 'Active company member required'; end if;
 if not exists(select 1 from companies where id=p_company_id and active) or not exists(select 1 from fiscal_years where id=p_fiscal_year_id and company_id=p_company_id and status='open' and p_date between start_ad and end_ad) then raise exception 'Select an open fiscal year and a date inside it'; end if;
 if nullif(trim(p_product->>'name'),'') is null then raise exception 'Product name required'; end if;
 if coalesce(p_product->>'itemType','') not in ('resale_good','finished_good','raw_material','packaging') then raise exception 'Invalid product category'; end if;
 foreach value in array array[qty,cost,price,retail,low] loop
   if value::text in ('NaN','Infinity','-Infinity') or value<0 or value>1000000000 then raise exception 'Invalid product price or opening quantity'; end if;
 end loop;
 if qty<>round(qty,3) then raise exception 'Use up to 3 decimal places for stock'; end if;
 insert into products(company_id,name,sku,unit,sale_price,purchase_price,mrp,stock_qty,low_stock_at,item_type)
 values(p_company_id,trim(p_product->>'name'),coalesce(p_product->>'sku',''),coalesce(nullif(trim(p_product->>'unit'),''),'pcs'),price,cost,retail,0,low,p_product->>'itemType') returning * into item;
 if qty>0 then
  adjustment:=record_manual_stock_adjustment(p_company_id,p_fiscal_year_id,item.id,p_actor_id,gen_random_uuid(),p_date,'add',qty,0,item.purchase_price,'Opening stock entered when creating product');
 end if;
 return jsonb_build_object('id',item.id,'openingAdjustment',adjustment);
end $$;
revoke all on function public.create_catalog_product(uuid,uuid,uuid,date,jsonb) from public,anon,authenticated;
grant execute on function public.create_catalog_product(uuid,uuid,uuid,date,jsonb) to service_role;
