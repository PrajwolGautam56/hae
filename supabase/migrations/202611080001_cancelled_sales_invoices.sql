-- A cancelled sales invoice retains its fiscal-year number but has no accounting or stock effect.
-- Both a reserved cancelled number and cancellation of a posted bill are one transaction.
create or replace function public.record_cancelled_sales_invoice(
  p_company_id uuid,
  p_fiscal_year_id uuid,
  p_member_id uuid,
  p_date date,
  p_reason text default '',
  p_voucher_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v public.vouchers%rowtype;
  n integer;
  movement record;
  cancellation_note text := 'Cancelled bill' || case when nullif(trim(coalesce(p_reason,'')),'') is null then '' else ' · ' || trim(p_reason) end;
begin
  if not exists (
    select 1 from public.team_members
    where id=p_member_id and company_id=p_company_id and active
      and role in ('admin','manager','accountant')
  ) then raise exception 'Only an administrator, manager or accountant can cancel a sales bill'; end if;

  if p_voucher_id is null then
    if not exists (
      select 1 from public.fiscal_years
      where id=p_fiscal_year_id and company_id=p_company_id
        and p_date between start_ad and end_ad and status='open'
    ) then raise exception 'Select an open fiscal year and a date within it'; end if;
    insert into public.voucher_sequences(fiscal_year_id,voucher_type,last_number)
      values(p_fiscal_year_id,'sale',1)
      on conflict(fiscal_year_id,voucher_type)
      do update set last_number=public.voucher_sequences.last_number+1
      returning last_number into n;
    insert into public.vouchers(
      company_id,fiscal_year_id,voucher_type,voucher_no,sequence_no,voucher_date,
      narration,document_status,bill_category,subtotal,discount_percent,
      discount_amount,tax_percent,tax_amount,total,generated_by,handled_by
    ) values (
      p_company_id,p_fiscal_year_id,'sale',n::text,n,p_date,
      cancellation_note,'cancelled','non_vat',0,0,0,0,0,0,p_member_id,p_member_id
    ) returning * into v;
  else
    select * into v from public.vouchers
      where id=p_voucher_id and company_id=p_company_id
        and fiscal_year_id=p_fiscal_year_id and voucher_type='sale' for update;
    if not found then raise exception 'Sales bill does not belong to this company and fiscal year'; end if;
    if v.document_status='cancelled' then raise exception 'This sales bill is already cancelled'; end if;
    if v.document_status<>'posted' then raise exception 'Only a posted sales bill can be cancelled'; end if;
    if exists(select 1 from public.vouchers where source_voucher_id=v.id) then
      raise exception 'This bill has a linked return. Resolve the return before cancelling it';
    end if;
    insert into public.voucher_audit_logs(voucher_id,action,before_data)
      select v.id,'cancel',jsonb_build_object(
        'voucher',to_jsonb(v),
        'lines',coalesce((select jsonb_agg(to_jsonb(l)) from public.voucher_lines l where l.voucher_id=v.id),'[]'::jsonb),
        'stock_movements',coalesce((select jsonb_agg(to_jsonb(s)) from public.stock_movements s where s.voucher_id=v.id),'[]'::jsonb),
        'actor',p_member_id,'reason',p_reason
      );
    for movement in
      select product_id,sum(quantity) as quantity
      from public.stock_movements
      where company_id=p_company_id and voucher_id=v.id
      group by product_id
    loop
      update public.products set stock_qty=stock_qty-movement.quantity
        where id=movement.product_id and company_id=p_company_id;
    end loop;
    delete from public.stock_movements where company_id=p_company_id and voucher_id=v.id;
    delete from public.voucher_lines where voucher_id=v.id;
    delete from public.ledger_entries where company_id=p_company_id and voucher_id=v.id;
    update public.vouchers set document_status='cancelled',narration=cancellation_note,
      subtotal=0,discount_percent=0,discount_amount=0,tax_percent=0,tax_amount=0,total=0,
      bill_category='non_vat',due_date=null
      where id=v.id returning * into v;
  end if;
  return jsonb_build_object('id',v.id,'voucher_no',v.voucher_no,
    'sequence_no',v.sequence_no,'total',0,'document_status','cancelled');
end $$;

-- These existing deferred triggers must never rebuild a zero-value journal for a cancelled bill.
create or replace function public.post_complete_voucher() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.document_status='cancelled' then
    delete from public.journal_entries where voucher_id=new.id;
  else
    perform public.rebuild_voucher_journal(new.id);
  end if;
  return null;
end $$;

create or replace function public.post_stock_voucher() returns trigger
language plpgsql security definer set search_path=public as $$
declare target_id uuid;
begin
  if tg_op<>'INSERT' and old.voucher_id is not null then
    target_id:=old.voucher_id;
    if exists(select 1 from public.vouchers where id=target_id and document_status='cancelled') then
      delete from public.journal_entries where voucher_id=target_id;
    else perform public.rebuild_voucher_journal(target_id); end if;
  end if;
  if tg_op<>'DELETE' and new.voucher_id is not null then
    target_id:=new.voucher_id;
    if exists(select 1 from public.vouchers where id=target_id and document_status='cancelled') then
      delete from public.journal_entries where voucher_id=target_id;
    else perform public.rebuild_voucher_journal(target_id); end if;
  end if;
  return null;
end $$;

revoke all on function public.record_cancelled_sales_invoice(uuid,uuid,uuid,date,text,uuid) from public,anon,authenticated;
grant execute on function public.record_cancelled_sales_invoice(uuid,uuid,uuid,date,text,uuid) to service_role;
