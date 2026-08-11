alter table public.vouchers add column if not exists subtotal numeric(18,2) not null default 0;
alter table public.vouchers add column if not exists discount_percent numeric(7,3) not null default 0;
alter table public.vouchers add column if not exists discount_amount numeric(18,2) not null default 0;
alter table public.vouchers add column if not exists tax_percent numeric(7,3) not null default 0;
alter table public.vouchers add column if not exists tax_amount numeric(18,2) not null default 0;

do $$ declare c uuid; begin
  select id into c from public.companies order by created_at limit 1;
  insert into public.products(company_id,sku,name,unit,sale_price,purchase_price,stock_qty,low_stock_at) values
    (c,'CEM-001','Penden Cement 50kg','bag',520,455,450,50),
    (c,'ROD-012','TMT Steel Rod 12mm','pcs',780,710,280,40),
    (c,'PLY-018','Commercial Plywood 18mm','sheet',2450,2180,95,15),
    (c,'GI-001','GI Pipe 1 inch','pcs',890,810,130,20)
  on conflict(company_id,name) do nothing;
end $$;

create or replace function public.record_sales_invoice(
  p_company_id uuid,p_fiscal_year_id uuid,p_party_id uuid,p_date date,p_lines jsonb,
  p_discount_percent numeric default 0,p_tax_percent numeric default 0,p_narration text default ''
) returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer; fy_label text; ref text; v_id uuid; line jsonb; product uuid; qty numeric; rate numeric;
  line_amount numeric; sub numeric:=0; discount_value numeric; taxable numeric; tax_value numeric; grand numeric;
begin
  if p_lines is null or jsonb_array_length(p_lines)=0 then raise exception 'At least one product is required'; end if;
  if (select status from fiscal_years where id=p_fiscal_year_id)='closed' then raise exception 'Fiscal year is closed'; end if;
  for line in select * from jsonb_array_elements(p_lines) loop
    qty:=coalesce((line->>'quantity')::numeric,0); rate:=coalesce((line->>'rate')::numeric,0);
    if qty<=0 or rate<0 then raise exception 'Invalid product quantity or rate'; end if; sub:=sub+(qty*rate);
  end loop;
  discount_value:=round(sub*greatest(0,p_discount_percent)/100,2); taxable:=sub-discount_value;
  tax_value:=round(taxable*greatest(0,p_tax_percent)/100,2); grand:=taxable+tax_value;
  insert into voucher_sequences(fiscal_year_id,voucher_type,last_number) values(p_fiscal_year_id,'sale',1)
    on conflict(fiscal_year_id,voucher_type) do update set last_number=voucher_sequences.last_number+1 returning last_number into n;
  select label_bs into fy_label from fiscal_years where id=p_fiscal_year_id; ref:='INV-'||fy_label||'-'||lpad(n::text,4,'0');
  insert into vouchers(company_id,party_id,voucher_type,voucher_no,voucher_date,narration,total,fiscal_year_id,sequence_no,subtotal,discount_percent,discount_amount,tax_percent,tax_amount)
    values(p_company_id,p_party_id,'sale',ref,p_date,p_narration,grand,p_fiscal_year_id,n,sub,p_discount_percent,discount_value,p_tax_percent,tax_value) returning id into v_id;
  for line in select * from jsonb_array_elements(p_lines) loop
    product:=nullif(line->>'product_id','')::uuid; qty:=(line->>'quantity')::numeric; rate:=(line->>'rate')::numeric; line_amount:=qty*rate;
    insert into voucher_lines(voucher_id,product_id,description,quantity,rate,amount,inventory_item)
      values(v_id,product,coalesce(line->>'name','Custom item'),qty,rate,line_amount,product is not null);
    if product is not null then
      update products set stock_qty=stock_qty-qty where id=product;
      insert into stock_movements(company_id,product_id,voucher_id,movement_date,quantity,movement_type) values(p_company_id,product,v_id,p_date,-qty,'out');
    end if;
  end loop;
  insert into ledger_entries(company_id,party_id,voucher_id,entry_date,account_name,debit,credit) values(p_company_id,p_party_id,v_id,p_date,'Party Account',grand,0);
  return jsonb_build_object('id',v_id,'voucher_no',ref,'subtotal',sub,'discount',discount_value,'tax',tax_value,'total',grand);
end $$;
