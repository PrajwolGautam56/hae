create table if not exists public.voucher_audit_logs (
  id uuid primary key default gen_random_uuid(), voucher_id uuid not null references public.vouchers(id) on delete cascade,
  action text not null default 'edit', before_data jsonb not null, changed_at timestamptz not null default now()
);
alter table public.voucher_audit_logs enable row level security;

create or replace function public.update_sales_invoice(
  p_voucher_id uuid,p_party_id uuid,p_date date,p_lines jsonb,p_discount_percent numeric default 0,p_tax_percent numeric default 0,p_narration text default ''
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v vouchers%rowtype; line jsonb; product uuid; qty numeric; rate numeric; line_amount numeric; sub numeric:=0; discount_value numeric; taxable numeric; tax_value numeric; grand numeric; available numeric;
begin
  select * into v from vouchers where id=p_voucher_id and voucher_type='sale' for update;
  if v.id is null then raise exception 'Sales invoice not found'; end if;
  if p_date not between (select start_ad from fiscal_years where id=v.fiscal_year_id) and (select end_ad from fiscal_years where id=v.fiscal_year_id) then raise exception 'Date is outside invoice fiscal year'; end if;
  if p_lines is null or jsonb_array_length(p_lines)=0 then raise exception 'At least one product is required'; end if;
  insert into voucher_audit_logs(voucher_id,before_data) select v.id,jsonb_build_object('voucher',to_jsonb(v),'lines',coalesce(jsonb_agg(to_jsonb(vl)) filter(where vl.id is not null),'[]'::jsonb)) from voucher_lines vl where vl.voucher_id=v.id group by v.id;
  update products p set stock_qty=p.stock_qty+old.quantity from (select product_id,sum(quantity) quantity from voucher_lines where voucher_id=v.id and product_id is not null group by product_id) old where p.id=old.product_id;
  delete from stock_movements where voucher_id=v.id; delete from voucher_lines where voucher_id=v.id;
  for line in select * from jsonb_array_elements(p_lines) loop
    product:=nullif(line->>'product_id','')::uuid;qty:=coalesce((line->>'quantity')::numeric,0);rate:=coalesce((line->>'rate')::numeric,0);
    if qty<=0 or rate<0 then raise exception 'Invalid quantity or rate'; end if; line_amount:=qty*rate;sub:=sub+line_amount;
    if product is not null then select stock_qty into available from products where id=product for update; if available<qty then raise exception 'Insufficient stock for %',(select name from products where id=product); end if; end if;
    insert into voucher_lines(voucher_id,product_id,description,quantity,rate,amount,inventory_item) values(v.id,product,coalesce(nullif(line->>'name',''),(select name from products where id=product),'Custom item'),qty,rate,line_amount,product is not null);
    if product is not null then update products set stock_qty=stock_qty-qty where id=product;insert into stock_movements(company_id,product_id,voucher_id,movement_date,quantity,movement_type) values(v.company_id,product,v.id,p_date,-qty,'out');end if;
  end loop;
  discount_value:=round(sub*greatest(0,p_discount_percent)/100,2);taxable:=sub-discount_value;tax_value:=round(taxable*greatest(0,p_tax_percent)/100,2);grand:=taxable+tax_value;
  update vouchers set party_id=p_party_id,voucher_date=p_date,narration=p_narration,total=grand,subtotal=sub,discount_percent=p_discount_percent,discount_amount=discount_value,tax_percent=p_tax_percent,tax_amount=tax_value where id=v.id;
  update ledger_entries set party_id=p_party_id,entry_date=p_date,debit=grand,credit=0 where voucher_id=v.id;
  return jsonb_build_object('id',v.id,'total',grand);
end $$;

create or replace function public.update_payment_receipt(
  p_voucher_id uuid,p_party_id uuid,p_date date,p_amount numeric,p_narration text,p_payment_mode text,p_cheque_no text default null,p_cheque_bank text default null,p_cheque_exchange_date date default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v vouchers%rowtype;
begin
  select * into v from vouchers where id=p_voucher_id and voucher_type='receipt' for update;if v.id is null then raise exception 'Receipt not found';end if;
  if p_amount<=0 then raise exception 'Amount must be greater than zero';end if;
  if p_date not between (select start_ad from fiscal_years where id=v.fiscal_year_id) and (select end_ad from fiscal_years where id=v.fiscal_year_id) then raise exception 'Date is outside receipt fiscal year';end if;
  if p_payment_mode='Cheque' and (coalesce(p_cheque_no,'')='' or coalesce(p_cheque_bank,'')='' or p_cheque_exchange_date is null) then raise exception 'Complete cheque details are required';end if;
  insert into voucher_audit_logs(voucher_id,before_data) values(v.id,to_jsonb(v));
  update vouchers set party_id=p_party_id,voucher_date=p_date,total=p_amount,narration=p_narration,payment_mode=p_payment_mode,cheque_no=case when p_payment_mode='Cheque' then p_cheque_no else null end,cheque_bank=case when p_payment_mode='Cheque' then p_cheque_bank else null end,cheque_exchange_date=case when p_payment_mode='Cheque' then p_cheque_exchange_date else null end,cheque_status=case when p_payment_mode='Cheque' then coalesce(cheque_status,'pending') else null end where id=v.id;
  update ledger_entries set party_id=p_party_id,entry_date=p_date,debit=0,credit=p_amount where voucher_id=v.id;
  return jsonb_build_object('id',v.id,'total',p_amount);
end $$;
