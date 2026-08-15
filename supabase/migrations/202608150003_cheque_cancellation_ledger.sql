-- Preserve the original cheque receipt and add an auditable reversal when it is cancelled.
insert into public.accounts(company_id,code,name,account_type,normal_side,system_key)
select id,'1050','Cheques in Hand','asset','debit','cheques_in_hand' from public.companies
on conflict(company_id,code) do update set name=excluded.name,account_type=excluded.account_type,
  normal_side=excluded.normal_side,system_key=excluded.system_key,active=true;

create or replace function public.rebuild_voucher_journal(p_voucher_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v public.vouchers%rowtype; j uuid; dr_account uuid; cr_account uuid;
  cheque_account uuid; receivable_account uuid;
begin
  select * into v from public.vouchers where id=p_voucher_id;
  if not found or v.fiscal_year_id is null or coalesce(v.total,0)<=0 then return; end if;
  delete from public.journal_entries where voucher_id=v.id;
  insert into public.journal_entries(company_id,fiscal_year_id,voucher_id,entry_date,reference,description)
  values(v.company_id,v.fiscal_year_id,v.id,v.voucher_date,v.voucher_no,v.narration) returning id into j;

  if v.voucher_type='receipt' and v.payment_mode='Cheque' then
    select id into cheque_account from public.accounts where company_id=v.company_id and system_key='cheques_in_hand';
    select id into receivable_account from public.accounts where company_id=v.company_id and system_key='accounts_receivable';
    insert into public.journal_lines(journal_entry_id,company_id,account_id,party_id,description,debit,credit)
    values
      (j,v.company_id,cheque_account,v.party_id,coalesce(nullif(v.narration,''),'Cheque received'),v.total,0),
      (j,v.company_id,receivable_account,v.party_id,coalesce(nullif(v.narration,''),'Cheque received'),0,v.total);
    if v.cheque_status='cancelled' then
      insert into public.journal_lines(journal_entry_id,company_id,account_id,party_id,description,debit,credit)
      values
        (j,v.company_id,receivable_account,v.party_id,'Cancelled cheque receipt adjusted',v.total,0),
        (j,v.company_id,cheque_account,v.party_id,'Cancelled cheque receipt adjusted',0,v.total);
    elsif v.cheque_status='cleared' then
      update public.journal_lines set account_id=(select id from public.accounts where company_id=v.company_id and system_key='cash_bank')
      where journal_entry_id=j and account_id=cheque_account and debit>0;
    end if;
    return;
  end if;

  if v.voucher_type='sale' then
    select id into dr_account from public.accounts where company_id=v.company_id and system_key='accounts_receivable';
    select id into cr_account from public.accounts where company_id=v.company_id and system_key='sales_revenue';
  elsif v.voucher_type='receipt' then
    select id into dr_account from public.accounts where company_id=v.company_id and system_key='cash_bank';
    select id into cr_account from public.accounts where company_id=v.company_id and system_key='accounts_receivable';
  elsif v.voucher_type='purchase' then
    select id into dr_account from public.accounts where company_id=v.company_id and system_key='raw_inventory';
    select id into cr_account from public.accounts where company_id=v.company_id and system_key='accounts_payable';
  elsif v.voucher_type='expense' then
    select id into dr_account from public.accounts where company_id=v.company_id and system_key='office_expense';
    select id into cr_account from public.accounts where company_id=v.company_id and system_key='cash_bank';
  elsif v.voucher_type='payment' then
    select id into dr_account from public.accounts where company_id=v.company_id and system_key='accounts_payable';
    select id into cr_account from public.accounts where company_id=v.company_id and system_key='cash_bank';
  else
    delete from public.journal_entries where id=j; return;
  end if;
  insert into public.journal_lines(journal_entry_id,company_id,account_id,party_id,description,debit,credit)
  values
    (j,v.company_id,dr_account,v.party_id,v.narration,v.total,0),
    (j,v.company_id,cr_account,v.party_id,v.narration,0,v.total);
end $$;

drop trigger if exists sync_voucher_journal_trigger on public.vouchers;
create trigger sync_voucher_journal_trigger
after insert or update of total,voucher_date,party_id,narration,payment_mode,cheque_status,money_account_id
on public.vouchers for each row execute function public.sync_voucher_journal();

create or replace function public.update_payment_receipt(
  p_voucher_id uuid,p_party_id uuid,p_date date,p_amount numeric,p_narration text,p_payment_mode text,
  p_cheque_no text default null,p_cheque_bank text default null,p_cheque_exchange_date date default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v vouchers%rowtype;
begin
  select * into v from vouchers where id=p_voucher_id and voucher_type='receipt' for update;
  if v.id is null then raise exception 'Receipt not found'; end if;
  if p_amount<=0 then raise exception 'Amount must be greater than zero'; end if;
  if p_date not between (select start_ad from fiscal_years where id=v.fiscal_year_id) and (select end_ad from fiscal_years where id=v.fiscal_year_id) then raise exception 'Date is outside receipt fiscal year'; end if;
  if p_payment_mode='Cheque' and (coalesce(p_cheque_no,'')='' or coalesce(p_cheque_bank,'')='' or p_cheque_exchange_date is null) then raise exception 'Complete cheque details are required'; end if;
  insert into voucher_audit_logs(voucher_id,before_data) values(v.id,to_jsonb(v));
  delete from ledger_entries where voucher_id=v.id and account_name='Cancelled Cheque Receipt Adjustment';
  update vouchers set party_id=p_party_id,voucher_date=p_date,total=p_amount,narration=p_narration,
    payment_mode=p_payment_mode,cheque_no=case when p_payment_mode='Cheque' then p_cheque_no else null end,
    cheque_bank=case when p_payment_mode='Cheque' then p_cheque_bank else null end,
    cheque_exchange_date=case when p_payment_mode='Cheque' then p_cheque_exchange_date else null end,
    cheque_status=case when p_payment_mode='Cheque' then 'pending' else null end,
    cheque_cleared_at=null,money_account_id=case when p_payment_mode='Cheque' then null else money_account_id end
  where id=v.id;
  update ledger_entries set party_id=p_party_id,entry_date=p_date,debit=0,credit=p_amount,
    account_name='Party Account' where voucher_id=v.id and account_name<>'Cancelled Cheque Receipt Adjustment';
  return jsonb_build_object('id',v.id,'total',p_amount);
end $$;

create or replace function public.set_received_cheque_status(
  p_voucher_id uuid,p_status text,p_destination_account_id uuid default null,p_approved_by uuid default null
) returns void language plpgsql security definer set search_path=public as $$
declare v public.vouchers%rowtype; cleared_at timestamptz;
begin
  if p_status not in ('pending','cleared','cancelled') then raise exception 'Invalid cheque status'; end if;
  select * into v from public.vouchers where id=p_voucher_id and voucher_type='receipt' and payment_mode='Cheque' for update;
  if not found then raise exception 'Cheque receipt not found'; end if;
  delete from public.ledger_entries where voucher_id=v.id and account_name='Cancelled Cheque Receipt Adjustment';

  if p_status='cleared' then
    if p_destination_account_id is null then raise exception 'Select the bank account or office cash where the cheque was cleared'; end if;
    if not exists(select 1 from public.money_accounts where id=p_destination_account_id and company_id=v.company_id and account_type in ('bank','office_cash') and active=true) then raise exception 'Invalid cheque clearance destination'; end if;
    cleared_at:=now();
    update public.vouchers set cheque_status='cleared',cheque_cleared_at=cleared_at,money_account_id=p_destination_account_id where id=v.id;
    update public.money_movements set to_account_id=p_destination_account_id,from_account_id=null,amount=v.total,
      movement_date=v.voucher_date,payment_mode='Cheque',party_id=v.party_id,handled_by=v.handled_by,
      generated_by=v.generated_by,approved_by=p_approved_by,title=coalesce(nullif(v.narration,''),'Cheque cleared'),
      reference=v.voucher_no,notes=v.narration,status='posted',posted_at=cleared_at where voucher_id=v.id;
    if not found then
      insert into public.money_movements(company_id,fiscal_year_id,voucher_id,movement_date,movement_type,to_account_id,
        amount,payment_mode,party_id,handled_by,generated_by,approved_by,title,reference,notes,status,posted_at)
      values(v.company_id,v.fiscal_year_id,v.id,v.voucher_date,'customer_receipt',p_destination_account_id,
        v.total,'Cheque',v.party_id,v.handled_by,v.generated_by,p_approved_by,
        coalesce(nullif(v.narration,''),'Cheque cleared'),v.voucher_no,v.narration,'posted',cleared_at);
    end if;
  elsif p_status='cancelled' then
    update public.vouchers set cheque_status='cancelled',cheque_cleared_at=null,money_account_id=null where id=v.id;
    insert into public.ledger_entries(company_id,party_id,voucher_id,entry_date,account_name,debit,credit)
    values(v.company_id,v.party_id,v.id,timezone('Asia/Kathmandu',now())::date,'Cancelled Cheque Receipt Adjustment',v.total,0);
    update public.money_movements set status='cancelled',posted_at=null,approved_by=p_approved_by where voucher_id=v.id;
  else
    update public.vouchers set cheque_status='pending',cheque_cleared_at=null,money_account_id=null where id=v.id;
    update public.money_movements set status='pending',posted_at=null,approved_by=p_approved_by where voucher_id=v.id;
  end if;
  perform public.rebuild_voucher_journal(v.id);
  perform public.refresh_future_opening_balances(v.company_id,v.fiscal_year_id);
end $$;

-- Idempotent backfill for any cheque already cancelled before this migration.
delete from public.ledger_entries where account_name='Cancelled Cheque Receipt Adjustment';
insert into public.ledger_entries(company_id,party_id,voucher_id,entry_date,account_name,debit,credit)
select company_id,party_id,id,coalesce(cheque_cleared_at::date,timezone('Asia/Kathmandu',now())::date),'Cancelled Cheque Receipt Adjustment',total,0
from public.vouchers where voucher_type='receipt' and payment_mode='Cheque' and cheque_status='cancelled';
do $$ declare row record; begin
  for row in select id from public.vouchers where voucher_type='receipt' and payment_mode='Cheque' loop
    perform public.rebuild_voucher_journal(row.id);
  end loop;
end $$;
