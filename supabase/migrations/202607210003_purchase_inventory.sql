create or replace function public.record_purchase_bill(
  p_company_id uuid,p_fiscal_year_id uuid,p_party_id uuid,p_date date,p_lines jsonb,p_narration text default ''
) returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer; fy_label text; ref text; v_id uuid; line jsonb; product uuid; qty numeric; rate numeric; amount numeric; total_value numeric:=0;
begin
  if p_lines is null or jsonb_array_length(p_lines)=0 then raise exception 'At least one product is required'; end if;
  if (select status from fiscal_years where id=p_fiscal_year_id)='closed' then raise exception 'Fiscal year is closed'; end if;
  for line in select * from jsonb_array_elements(p_lines) loop qty:=(line->>'quantity')::numeric;rate:=(line->>'rate')::numeric;if qty<=0 or rate<0 then raise exception 'Invalid line';end if;total_value:=total_value+qty*rate;end loop;
  insert into voucher_sequences(fiscal_year_id,voucher_type,last_number) values(p_fiscal_year_id,'purchase',1) on conflict(fiscal_year_id,voucher_type) do update set last_number=voucher_sequences.last_number+1 returning last_number into n;
  select label_bs into fy_label from fiscal_years where id=p_fiscal_year_id;ref:='PUR-'||fy_label||'-'||lpad(n::text,4,'0');
  insert into vouchers(company_id,party_id,voucher_type,voucher_no,voucher_date,narration,total,subtotal,fiscal_year_id,sequence_no) values(p_company_id,p_party_id,'purchase',ref,p_date,p_narration,total_value,total_value,p_fiscal_year_id,n) returning id into v_id;
  for line in select * from jsonb_array_elements(p_lines) loop
    product:=nullif(line->>'product_id','')::uuid;qty:=(line->>'quantity')::numeric;rate:=(line->>'rate')::numeric;amount:=qty*rate;
    if product is null then
      insert into products(company_id,name,unit,purchase_price,sale_price,stock_qty) values(p_company_id,line->>'name',coalesce(line->>'unit','pcs'),rate,rate,0) returning id into product;
    end if;
    insert into voucher_lines(voucher_id,product_id,description,quantity,rate,amount,inventory_item) values(v_id,product,line->>'name',qty,rate,amount,true);
    update products set stock_qty=stock_qty+qty,purchase_price=rate where id=product;
    insert into stock_movements(company_id,product_id,voucher_id,movement_date,quantity,movement_type) values(p_company_id,product,v_id,p_date,qty,'in');
  end loop;
  insert into ledger_entries(company_id,party_id,voucher_id,entry_date,account_name,debit,credit) values(p_company_id,p_party_id,v_id,p_date,'Supplier Account',0,total_value);
  return jsonb_build_object('id',v_id,'voucher_no',ref,'total',total_value);
end $$;
