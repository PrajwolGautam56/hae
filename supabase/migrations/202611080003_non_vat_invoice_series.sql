-- Preserve every issued number. Only new non-VAT sales enter the independent NB series.
alter table public.vouchers add column number_series text not null default 'standard'
  check(number_series in ('standard','non_vat'));
alter table public.vouchers add constraint vouchers_non_vat_series_check
  check(number_series<>'non_vat' or (voucher_type='sale' and bill_category='non_vat'));
drop index if exists public.vouchers_fy_type_sequence_unique;
create unique index vouchers_fy_type_series_sequence_unique
  on public.vouchers(fiscal_year_id,voucher_type,number_series,sequence_no)
  where fiscal_year_id is not null and sequence_no is not null;

create or replace function public.record_numbered_sales_invoice(
  p_company_id uuid,p_fiscal_year_id uuid,p_party_id uuid,p_date date,p_lines jsonb,
  p_discount_percent numeric,p_tax_percent numeric,p_narration text,p_number_series text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer; ref text; v_id uuid; line jsonb; product uuid; qty numeric; rate numeric;
  line_amount numeric; sub numeric:=0; discount_value numeric; taxable numeric; tax_value numeric; grand numeric;
  available numeric; item_cost numeric; required record; sequence_key text;
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
    if available<required.quantity then raise exception 'Insufficient stock for %: available %, required %',(select name from products where id=required.product_id),available,required.quantity; end if;
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
  return jsonb_build_object('id',v_id,'voucher_no',ref,'sequence_no',n,'number_series',p_number_series,
    'subtotal',sub,'discount',discount_value,'tax',tax_value,'total',grand);
end $$;

-- Existing server integrations keep the original signature and standard number stream.
create or replace function public.record_sales_invoice(
  p_company_id uuid,p_fiscal_year_id uuid,p_party_id uuid,p_date date,p_lines jsonb,
  p_discount_percent numeric default 0,p_tax_percent numeric default 0,p_narration text default ''
) returns jsonb language plpgsql security definer set search_path=public as $$
begin return record_numbered_sales_invoice(p_company_id,p_fiscal_year_id,p_party_id,p_date,p_lines,p_discount_percent,p_tax_percent,p_narration,'standard'); end $$;

create or replace function public.record_classified_invoice(
  p_company_id uuid,p_fiscal_year_id uuid,p_party_id uuid,p_date date,p_lines jsonb,
  p_invoice_type text,p_bill_category text,p_discount_percent numeric,p_tax_percent numeric,
  p_narration text,p_due_date date,p_supplier_bill_no text,p_member_id uuid,p_voucher_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; v_id uuid; v vouchers%rowtype;
begin
  if p_invoice_type is null or p_invoice_type not in ('sale','purchase') then raise exception 'Invalid invoice type'; end if;
  if p_bill_category is null or p_bill_category not in ('vat','pan','non_vat') or (p_invoice_type='sale' and p_bill_category='pan') then raise exception 'Select VAT or non-VAT; PAN is available for purchases'; end if;
  if p_bill_category<>'vat' and p_tax_percent<>0 then raise exception 'Non-VAT/PAN bills cannot include VAT'; end if;
  if p_tax_percent<0 or p_tax_percent>100 then raise exception 'Invalid VAT percentage'; end if;
  if not exists(select 1 from team_members where id=p_member_id and company_id=p_company_id and active) then raise exception 'Active company member is required'; end if;
  if p_due_date is not null and p_due_date<p_date then raise exception 'Due date cannot precede invoice date'; end if;
  if p_voucher_id is null then
    if p_invoice_type='sale' then
      result:=record_numbered_sales_invoice(p_company_id,p_fiscal_year_id,p_party_id,p_date,p_lines,p_discount_percent,p_tax_percent,p_narration,
        case when p_bill_category='non_vat' then 'non_vat' else 'standard' end);
    else result:=record_purchase_invoice(p_company_id,p_fiscal_year_id,p_party_id,p_date,p_lines,p_discount_percent,p_tax_percent,p_narration); end if;
    v_id:=(result->>'id')::uuid;
  else
    if p_invoice_type<>'sale' then raise exception 'Use a purchase return to correct a posted purchase'; end if;
    select * into v from vouchers where id=p_voucher_id and company_id=p_company_id and fiscal_year_id=p_fiscal_year_id and voucher_type='sale' for update;
    if not found then raise exception 'Invoice does not belong to this company and fiscal year'; end if;
    if v.document_status='cancelled' then raise exception 'A cancelled bill cannot be edited or posted again'; end if;
    if v.bill_category<>'unclassified' and v.bill_category<>p_bill_category then raise exception 'An issued bill cannot change VAT/non-VAT type. Cancel it and create a new bill in the correct series'; end if;
    if exists(select 1 from vouchers where source_voucher_id=p_voucher_id) then raise exception 'This invoice has returns; reverse the return before editing the invoice'; end if;
    if p_party_id is not null and not exists(select 1 from parties where id=p_party_id and company_id=p_company_id) then raise exception 'Customer is invalid'; end if;
    if exists(select 1 from jsonb_array_elements(p_lines) x where nullif(x->>'product_id','') is not null and not exists(select 1 from products where id=(x->>'product_id')::uuid and company_id=p_company_id)) then raise exception 'Invoice product is invalid'; end if;
    result:=update_sales_invoice(p_voucher_id,p_party_id,p_date,p_lines,p_discount_percent,p_tax_percent,p_narration);
    v_id:=p_voucher_id;
  end if;
  update vouchers set bill_category=p_bill_category,supplier_bill_no=nullif(trim(p_supplier_bill_no),''),due_date=p_due_date,
    generated_by=coalesce(generated_by,p_member_id),handled_by=coalesce(handled_by,p_member_id) where id=v_id returning * into v;
  return coalesce(result,'{}'::jsonb)||jsonb_build_object('id',v_id,'bill_category',p_bill_category,
    'voucher_no',v.voucher_no,'sequence_no',v.sequence_no,'number_series',v.number_series);
end $$;

-- Classifying old unclassified bills must not be a back door for switching an issued series.
create or replace function public.classify_voucher_bill(p_company_id uuid,p_voucher_id uuid,p_category text,p_member_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v vouchers%rowtype;
begin
  if not exists(select 1 from team_members where id=p_member_id and company_id=p_company_id and active and role in ('admin','manager','accountant')) then raise exception 'An administrator, manager or accountant must classify bills'; end if;
  select * into v from vouchers where id=p_voucher_id and company_id=p_company_id for update;
  if not found or v.voucher_type not in ('sale','purchase') then raise exception 'Select the original sales or purchase invoice'; end if;
  if v.document_status='cancelled' then raise exception 'A cancelled bill cannot be reclassified'; end if;
  if p_category is null or p_category not in ('vat','pan','non_vat') or (v.voucher_type='sale' and p_category='pan') then raise exception 'Invalid bill classification'; end if;
  if v.voucher_type='sale' and v.bill_category<>'unclassified' and v.bill_category<>p_category then raise exception 'An issued sales bill cannot change VAT/non-VAT type. Cancel it and create a new bill in the correct series'; end if;
  if p_category<>'vat' and v.tax_amount>0 then raise exception 'This bill contains VAT; correct the invoice instead of relabelling tax'; end if;
  insert into voucher_audit_logs(voucher_id,action,before_data) values(v.id,'bill_classification',jsonb_build_object('voucher',to_jsonb(v),'actor',p_member_id));
  update vouchers set bill_category=p_category where company_id=p_company_id and (id=v.id or source_voucher_id=v.id);
end $$;

create or replace function public.record_cancelled_sales_invoice_in_series(
  p_company_id uuid,p_fiscal_year_id uuid,p_member_id uuid,p_date date,p_reason text,p_voucher_id uuid,p_number_series text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; n integer; v vouchers%rowtype;
begin
  if p_number_series is null or p_number_series not in ('standard','non_vat') then raise exception 'Invalid invoice number series'; end if;
  if p_voucher_id is not null or p_number_series='standard' then
    result:=record_cancelled_sales_invoice(p_company_id,p_fiscal_year_id,p_member_id,p_date,p_reason,p_voucher_id);
    select * into v from vouchers where id=(result->>'id')::uuid;
    return result||jsonb_build_object('number_series',v.number_series);
  end if;
  if not exists(select 1 from team_members where id=p_member_id and company_id=p_company_id and active and role in ('admin','manager','accountant')) then raise exception 'Only an administrator, manager or accountant can cancel a sales bill'; end if;
  if not exists(select 1 from fiscal_years where id=p_fiscal_year_id and company_id=p_company_id and p_date between start_ad and end_ad and status='open') then raise exception 'Select an open fiscal year and a date within it'; end if;
  insert into voucher_sequences(fiscal_year_id,voucher_type,last_number) values(p_fiscal_year_id,'sale_non_vat',1)
    on conflict(fiscal_year_id,voucher_type) do update set last_number=voucher_sequences.last_number+1 returning last_number into n;
  insert into vouchers(company_id,fiscal_year_id,voucher_type,voucher_no,sequence_no,voucher_date,narration,
    document_status,bill_category,number_series,subtotal,discount_percent,discount_amount,tax_percent,tax_amount,total,generated_by,handled_by)
  values(p_company_id,p_fiscal_year_id,'sale','NB '||n::text,n,p_date,'Cancelled bill'||case when nullif(trim(p_reason),'') is null then '' else ' · '||trim(p_reason) end,
    'cancelled','non_vat','non_vat',0,0,0,0,0,0,p_member_id,p_member_id) returning * into v;
  return jsonb_build_object('id',v.id,'voucher_no',v.voucher_no,'sequence_no',n,'number_series','non_vat','total',0,'document_status','cancelled');
end $$;

revoke all on function public.record_numbered_sales_invoice(uuid,uuid,uuid,date,jsonb,numeric,numeric,text,text),public.record_cancelled_sales_invoice_in_series(uuid,uuid,uuid,date,text,uuid,text) from public,anon,authenticated;
grant execute on function public.record_numbered_sales_invoice(uuid,uuid,uuid,date,jsonb,numeric,numeric,text,text),public.record_cancelled_sales_invoice_in_series(uuid,uuid,uuid,date,text,uuid,text) to service_role;
revoke all on function public.classify_voucher_bill(uuid,uuid,text,uuid),public.record_classified_invoice(uuid,uuid,uuid,date,jsonb,text,text,numeric,numeric,text,date,text,uuid,uuid),public.record_sales_invoice(uuid,uuid,uuid,date,jsonb,numeric,numeric,text) from public,anon,authenticated;
grant execute on function public.classify_voucher_bill(uuid,uuid,text,uuid),public.record_classified_invoice(uuid,uuid,uuid,date,jsonb,text,text,numeric,numeric,text,date,text,uuid,uuid),public.record_sales_invoice(uuid,uuid,uuid,date,jsonb,numeric,numeric,text) to service_role;
