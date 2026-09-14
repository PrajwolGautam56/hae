-- Explicit document classification and complete voucher/subledger/stock posting.
-- No business documents are deleted. Derived journals are rebuilt after child rows exist.
alter table public.vouchers add column if not exists bill_category text;
alter table public.vouchers add column if not exists supplier_bill_no text;
alter table public.voucher_lines add column if not exists source_line_id uuid;
alter table public.ledger_entries add column if not exists journal_line_id uuid unique;
alter table public.journal_lines add column if not exists effective_date date;
update public.journal_lines l set effective_date=j.entry_date from public.journal_entries j where j.id=l.journal_entry_id and l.effective_date is null;
create or replace function public.journal_line_effective_date() returns trigger language plpgsql set search_path=public as $$
begin
  if new.effective_date is null then select entry_date into new.effective_date from journal_entries where id=new.journal_entry_id; end if;
  return new;
end $$;
create trigger journal_line_effective_date before insert on public.journal_lines for each row execute function public.journal_line_effective_date();
create index if not exists journal_lines_company_effective_idx on public.journal_lines(company_id,effective_date);

create or replace function public.prevent_negative_stock() returns trigger language plpgsql set search_path=public as $$
begin if new.stock_qty<0 then raise exception 'Insufficient stock for %',new.name; end if; return new; end $$;
create trigger stock_nonnegative_guard before update of stock_qty on public.products for each row execute function public.prevent_negative_stock();
update public.vouchers set bill_category=case when coalesce(tax_amount,0)>0 then 'vat' else 'unclassified' end where bill_category is null;
alter table public.vouchers alter column bill_category set default 'unclassified';
alter table public.vouchers alter column bill_category set not null;
alter table public.vouchers add constraint vouchers_bill_category_check check(bill_category in ('vat','pan','non_vat','unclassified'));
create index if not exists vouchers_company_tax_period_idx on public.vouchers(company_id,voucher_date,bill_category);

-- Classify legacy bills without changing their financial amounts or removing history.
create or replace function public.classify_voucher_bill(p_company_id uuid,p_voucher_id uuid,p_category text,p_member_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v vouchers%rowtype;
begin
  if not exists(select 1 from team_members where id=p_member_id and company_id=p_company_id and active and role in ('admin','manager','accountant')) then raise exception 'An administrator, manager or accountant must classify bills'; end if;
  select * into v from vouchers where id=p_voucher_id and company_id=p_company_id for update;
  if not found or v.voucher_type not in ('sale','purchase') then raise exception 'Select the original sales or purchase invoice'; end if;
  if p_category is null or p_category not in ('vat','pan','non_vat') or (v.voucher_type='sale' and p_category='pan') then raise exception 'Invalid bill classification'; end if;
  if p_category<>'vat' and v.tax_amount>0 then raise exception 'This bill contains VAT; correct the invoice instead of relabelling tax'; end if;
  insert into voucher_audit_logs(voucher_id,before_data) values(v.id,jsonb_build_object('voucher',to_jsonb(v),'action','bill_classification','actor',p_member_id));
  update vouchers set bill_category=p_category where company_id=p_company_id and (id=v.id or source_voucher_id=v.id);
end $$;
revoke all on function public.classify_voucher_bill(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.classify_voucher_bill(uuid,uuid,text,uuid) to service_role;

create or replace function public.record_classified_invoice(
  p_company_id uuid,p_fiscal_year_id uuid,p_party_id uuid,p_date date,p_lines jsonb,
  p_invoice_type text,p_bill_category text,p_discount_percent numeric,p_tax_percent numeric,
  p_narration text,p_due_date date,p_supplier_bill_no text,p_member_id uuid,p_voucher_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; v_id uuid;
begin
  if p_invoice_type not in ('sale','purchase') then raise exception 'Invalid invoice type'; end if;
  if p_bill_category not in ('vat','pan','non_vat') or (p_invoice_type='sale' and p_bill_category='pan') then raise exception 'Select VAT or non-VAT; PAN is available for purchases'; end if;
  if p_bill_category<>'vat' and p_tax_percent<>0 then raise exception 'Non-VAT/PAN bills cannot include VAT'; end if;
  if p_tax_percent<0 or p_tax_percent>100 then raise exception 'Invalid VAT percentage'; end if;
  if not exists(select 1 from team_members where id=p_member_id and company_id=p_company_id and active) then raise exception 'Active company member is required'; end if;
  if p_due_date is not null and p_due_date<p_date then raise exception 'Due date cannot precede invoice date'; end if;
  if p_voucher_id is null then
    if p_invoice_type='sale' then result:=record_sales_invoice(p_company_id,p_fiscal_year_id,p_party_id,p_date,p_lines,p_discount_percent,p_tax_percent,p_narration);
    else result:=record_purchase_invoice(p_company_id,p_fiscal_year_id,p_party_id,p_date,p_lines,p_discount_percent,p_tax_percent,p_narration); end if;
    v_id:=(result->>'id')::uuid;
  else
    if p_invoice_type<>'sale' then raise exception 'Use a purchase return to correct a posted purchase'; end if;
    if not exists(select 1 from vouchers where id=p_voucher_id and company_id=p_company_id and fiscal_year_id=p_fiscal_year_id and voucher_type='sale') then raise exception 'Invoice does not belong to this company and fiscal year'; end if;
    if exists(select 1 from vouchers where source_voucher_id=p_voucher_id) then raise exception 'This invoice has returns; reverse the return before editing the invoice'; end if;
    result:=update_sales_invoice(p_voucher_id,p_party_id,p_date,p_lines,p_discount_percent,p_tax_percent,p_narration);
    v_id:=p_voucher_id;
  end if;
  update vouchers set bill_category=p_bill_category,supplier_bill_no=nullif(trim(p_supplier_bill_no),''),
    due_date=p_due_date,generated_by=coalesce(generated_by,p_member_id),handled_by=coalesce(handled_by,p_member_id) where id=v_id;
  return coalesce(result,'{}'::jsonb)||jsonb_build_object('id',v_id,'bill_category',p_bill_category);
end $$;

-- A deferred trigger sees final invoice lines and stock costs in the same transaction.
create or replace function public.post_complete_voucher() returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform rebuild_voucher_journal(new.id);
  return null;
end $$;
drop trigger if exists sync_voucher_journal_trigger on public.vouchers;
create constraint trigger sync_voucher_journal_trigger after insert or update on public.vouchers
deferrable initially deferred for each row execute function public.post_complete_voucher();

create or replace function public.post_stock_voucher() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op<>'INSERT' and old.voucher_id is not null then perform rebuild_voucher_journal(old.voucher_id); end if;
  if tg_op<>'DELETE' and new.voucher_id is not null then perform rebuild_voucher_journal(new.voucher_id); end if;
  return null;
end $$;
create constraint trigger stock_voucher_journal_sync after insert or update or delete on public.stock_movements
deferrable initially deferred for each row execute function public.post_stock_voucher();

-- Only receivable/payable manual journal lines belong in the party subledger.
create or replace function public.sync_manual_party_ledger() returns trigger language plpgsql security definer set search_path=public as $$
declare entry journal_entries%rowtype; key text;
begin
  if tg_op='DELETE' then delete from ledger_entries where journal_line_id=old.id; return old; end if;
  select * into entry from journal_entries where id=new.journal_entry_id;
  if entry.source_type<>'manual_journal' then return new; end if;
  select system_key into key from accounts where id=new.account_id and company_id=new.company_id;
  if key in ('accounts_receivable','accounts_payable') then
    if new.party_id is null then raise exception 'Select a party for receivable/payable journal lines'; end if;
    insert into ledger_entries(company_id,party_id,voucher_id,entry_date,account_name,debit,credit,journal_line_id)
    values(new.company_id,new.party_id,entry.voucher_id,entry.entry_date,coalesce(new.description,'Manual journal'),new.debit,new.credit,new.id)
    on conflict(journal_line_id) do update set party_id=excluded.party_id,entry_date=excluded.entry_date,account_name=excluded.account_name,debit=excluded.debit,credit=excluded.credit;
  else delete from ledger_entries where journal_line_id=new.id;
  end if;
  return new;
end $$;
create trigger journal_party_subledger_sync after insert or update or delete on public.journal_lines for each row execute function public.sync_manual_party_ledger();

create or replace function public.roll_party_ledger_forward() returns trigger language plpgsql security definer set search_path=public as $$
declare c uuid; d date; fy uuid;
begin
  if tg_op='DELETE' then c:=old.company_id; d:=old.entry_date; else c:=new.company_id; d:=new.entry_date; end if;
  select id into fy from fiscal_years where company_id=c and d between start_ad and end_ad;
  if fy is not null then perform refresh_future_opening_balances(c,fy); end if;
  return null;
end $$;
create constraint trigger party_ledger_rollover after insert or update or delete on public.ledger_entries
deferrable initially deferred for each row execute function public.roll_party_ledger_forward();

create or replace function public.record_goods_return(
  p_company_id uuid,p_fiscal_year_id uuid,p_source_voucher_id uuid,p_return_type text,
  p_date date,p_lines jsonb,p_narration text default '',p_generated_by uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare src vouchers%rowtype; original voucher_lines%rowtype; line jsonb; v_id uuid; n int;
  qty numeric; used numeric; sub numeric:=0; disc numeric; tax numeric; gross numeric;
  return_lines jsonb:='[]'; cost numeric; seen uuid[]:='{}';
begin
  if p_return_type not in ('sale_return','purchase_return') then raise exception 'Invalid return type'; end if;
  select * into src from vouchers where id=p_source_voucher_id and company_id=p_company_id for update;
  if not found or src.voucher_type<>(case when p_return_type='sale_return' then 'sale' else 'purchase' end) then raise exception 'Original invoice does not match this return'; end if;
  if p_date<src.voucher_date then raise exception 'Return cannot predate original invoice'; end if;
  if not exists(select 1 from fiscal_years where id=p_fiscal_year_id and company_id=p_company_id and p_date between start_ad and end_ad and status='open') then raise exception 'Return date must be in an open fiscal year'; end if;
  if p_lines is null or jsonb_array_length(p_lines)=0 then raise exception 'Select items to return'; end if;
  for line in select * from jsonb_array_elements(p_lines) loop
    select * into original from voucher_lines where id=nullif(line->>'source_line_id','')::uuid and voucher_id=src.id;
    if not found then raise exception 'Select an original invoice line for each return'; end if;
    if original.id=any(seen) then raise exception 'Duplicate returned invoice line'; end if;
    seen:=array_append(seen,original.id); qty:=(line->>'quantity')::numeric;
    select coalesce(sum(vl.quantity),0) into used from vouchers v join voucher_lines vl on vl.voucher_id=v.id
      where v.source_voucher_id=src.id and v.voucher_type=p_return_type and v.document_status='posted'
      and (vl.source_line_id=original.id or (vl.source_line_id is null and vl.product_id is not distinct from original.product_id));
    if qty is null or qty<=0 or qty+used>original.quantity then raise exception 'Return quantity exceeds remaining quantity for %',original.description; end if;
    if original.product_id is not null then
      perform 1 from products where id=original.product_id and company_id=p_company_id for update;
      if p_return_type='purchase_return' and (select stock_qty from products where id=original.product_id)<qty then raise exception 'Insufficient stock for purchase return'; end if;
    end if;
    sub:=sub+round(qty*original.rate,2);
    return_lines:=return_lines||jsonb_build_array(jsonb_build_object('source_line_id',original.id,'product_id',original.product_id,'name',original.description,'quantity',qty,'rate',original.rate));
  end loop;
  disc:=round(sub*coalesce(src.discount_percent,0)/100,2);tax:=round((sub-disc)*coalesce(src.tax_percent,0)/100,2);gross:=sub-disc+tax;
  insert into voucher_sequences(fiscal_year_id,voucher_type,last_number) values(p_fiscal_year_id,p_return_type,1)
    on conflict(fiscal_year_id,voucher_type) do update set last_number=voucher_sequences.last_number+1 returning last_number into n;
  insert into vouchers(company_id,party_id,fiscal_year_id,voucher_type,voucher_no,sequence_no,voucher_date,narration,
    subtotal,discount_percent,discount_amount,tax_percent,tax_amount,total,source_voucher_id,generated_by,handled_by,bill_category,supplier_bill_no)
  values(p_company_id,src.party_id,p_fiscal_year_id,p_return_type,n::text,n,p_date,p_narration,sub,src.discount_percent,disc,src.tax_percent,tax,gross,src.id,p_generated_by,p_generated_by,src.bill_category,src.supplier_bill_no) returning id into v_id;
  for line in select * from jsonb_array_elements(return_lines) loop
    qty:=(line->>'quantity')::numeric;
    insert into voucher_lines(voucher_id,product_id,description,quantity,rate,amount,inventory_item,source_line_id)
      values(v_id,(line->>'product_id')::uuid,line->>'name',qty,(line->>'rate')::numeric,round(qty*(line->>'rate')::numeric,2),(line->>'product_id') is not null,(line->>'source_line_id')::uuid);
    if (line->>'product_id') is not null then
      select sum(abs(quantity)*unit_cost)/nullif(sum(abs(quantity)),0) into cost from stock_movements where voucher_id=src.id and product_id=(line->>'product_id')::uuid;
      update products set stock_qty=stock_qty+case when p_return_type='sale_return' then qty else -qty end where id=(line->>'product_id')::uuid and company_id=p_company_id;
      insert into stock_movements(company_id,product_id,voucher_id,movement_date,quantity,movement_type,unit_cost,notes)
      values(p_company_id,(line->>'product_id')::uuid,v_id,p_date,case when p_return_type='sale_return' then qty else -qty end,
        case when p_return_type='sale_return' then 'in' else 'out' end,coalesce(cost,(line->>'rate')::numeric),p_narration);
    end if;
  end loop;
  insert into ledger_entries(company_id,party_id,voucher_id,entry_date,account_name,debit,credit)
  values(p_company_id,src.party_id,v_id,p_date,case when p_return_type='sale_return' then 'Sales Return' else 'Purchase Return' end,
    case when p_return_type='purchase_return' then gross else 0 end,case when p_return_type='sale_return' then gross else 0 end);
  return jsonb_build_object('id',v_id,'voucher_no',n::text,'total',gross);
end $$;

create or replace function public.rebuild_voucher_journal(p_voucher_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v public.vouchers%rowtype; j uuid; dr_account uuid; cr_account uuid;
  cheque_account uuid; receivable_account uuid; revenue_account uuid; returns_account uuid;
  payable_account uuid; raw_account uuid; finished_account uuid; input_tax_account uuid; output_tax_account uuid;
  cogs_account uuid; taxable_value numeric; raw_value numeric; finished_value numeric; cogs_value numeric;
begin
  select * into v from public.vouchers where id=p_voucher_id;
  if not found or v.fiscal_year_id is null then return; end if;
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
      update journal_lines set effective_date=coalesce((select max(entry_date) from ledger_entries where voucher_id=v.id and account_name='Cancelled Cheque Receipt Adjustment'),v.voucher_date)
      where journal_entry_id=j and description='Cancelled cheque receipt adjusted';
    elsif v.cheque_status='cleared' then
      insert into journal_lines(journal_entry_id,company_id,account_id,description,debit,credit,effective_date) values
        (j,v.company_id,(select id from accounts where company_id=v.company_id and system_key='cash_bank'),'Cheque cleared',v.total,0,coalesce(timezone('Asia/Kathmandu',v.cheque_cleared_at)::date,v.voucher_date)),
        (j,v.company_id,cheque_account,'Cheque cleared',0,v.total,coalesce(timezone('Asia/Kathmandu',v.cheque_cleared_at)::date,v.voucher_date));
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

create or replace function public.record_purchase_invoice(
  p_company_id uuid,p_fiscal_year_id uuid,p_party_id uuid,p_date date,p_lines jsonb,
  p_discount_percent numeric default 0,p_tax_percent numeric default 0,p_narration text default ''
) returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer; ref text; v_id uuid; line jsonb; product uuid; qty numeric; rate numeric; line_amount numeric;
  subtotal_value numeric:=0; discount_value numeric; taxable_value numeric; tax_value numeric; total_value numeric;
  old_stock numeric; old_price numeric; new_price numeric; net_unit_cost numeric;
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
    net_unit_cost:=rate*(1-p_discount_percent/100);
    new_price:=case when old_stock+qty>0 then round((old_stock*old_price+qty*net_unit_cost)/(old_stock+qty),4) else net_unit_cost end;
    insert into voucher_lines(voucher_id,product_id,description,quantity,rate,amount,inventory_item)
    values(v_id,product,line->>'name',qty,rate,line_amount,true);
    update products set stock_qty=stock_qty+qty,purchase_price=new_price where id=product and company_id=p_company_id;
    insert into stock_movements(company_id,product_id,voucher_id,movement_date,quantity,movement_type,unit_cost,notes)
    values(p_company_id,product,v_id,p_date,qty,'in',net_unit_cost,p_narration);
  end loop;
  insert into ledger_entries(company_id,party_id,voucher_id,entry_date,account_name,debit,credit)
  values(p_company_id,p_party_id,v_id,p_date,'Supplier Account',0,total_value);
  return jsonb_build_object('id',v_id,'voucher_no',ref,'sequence_no',n,'subtotal',subtotal_value,'discount',discount_value,'tax',tax_value,'total',total_value);
end $$;


-- Rebuild derived entries only after the final document/stock state is available.
do $$ declare r record; begin
  for r in select id from vouchers where total>0 order by voucher_date loop perform rebuild_voucher_journal(r.id); end loop;
end $$;
update journal_lines jl set description=jl.description from journal_entries j,accounts a
where j.id=jl.journal_entry_id and a.id=jl.account_id and j.source_type='manual_journal'
and a.system_key in ('accounts_receivable','accounts_payable') and jl.party_id is not null;

revoke all on function public.record_classified_invoice(uuid,uuid,uuid,date,jsonb,text,text,numeric,numeric,text,date,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.record_classified_invoice(uuid,uuid,uuid,date,jsonb,text,text,numeric,numeric,text,date,text,uuid,uuid) to service_role;
revoke all on function public.post_complete_voucher(),public.post_stock_voucher(),public.sync_manual_party_ledger(),public.roll_party_ledger_forward() from public,anon,authenticated;
