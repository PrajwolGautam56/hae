-- A received cheque is held off-book until it is actually cleared.
-- Clearance atomically selects the company bank or office cash destination
-- and posts the corresponding money movement.
create or replace function public.set_received_cheque_status(
  p_voucher_id uuid,
  p_status text,
  p_destination_account_id uuid default null,
  p_approved_by uuid default null
) returns void language plpgsql security definer set search_path=public as $$
declare
  v public.vouchers%rowtype;
  cleared_at timestamptz;
begin
  if p_status not in ('pending','cleared','cancelled') then
    raise exception 'Invalid cheque status';
  end if;

  select * into v from public.vouchers
  where id=p_voucher_id and voucher_type='receipt' and payment_mode='Cheque'
  for update;
  if not found then raise exception 'Cheque receipt not found'; end if;

  if p_status='cleared' then
    if p_destination_account_id is null then
      raise exception 'Select the bank account or office cash where the cheque was cleared';
    end if;
    if not exists(
      select 1 from public.money_accounts
      where id=p_destination_account_id and company_id=v.company_id
        and account_type in ('bank','office_cash') and active=true
    ) then raise exception 'Invalid cheque clearance destination'; end if;
    cleared_at:=now();
    update public.vouchers set cheque_status='cleared',cheque_cleared_at=cleared_at,
      money_account_id=p_destination_account_id where id=v.id;

    update public.money_movements set to_account_id=p_destination_account_id,
      from_account_id=null,amount=v.total,movement_date=v.voucher_date,
      payment_mode='Cheque',party_id=v.party_id,handled_by=v.handled_by,
      generated_by=v.generated_by,approved_by=p_approved_by,
      title=coalesce(nullif(v.narration,''),'Cheque cleared'),reference=v.voucher_no,
      notes=v.narration,status='posted',posted_at=cleared_at
    where voucher_id=v.id;
    if not found then
      insert into public.money_movements(
        company_id,fiscal_year_id,voucher_id,movement_date,movement_type,
        to_account_id,amount,payment_mode,party_id,handled_by,generated_by,
        approved_by,title,reference,notes,status,posted_at
      ) values(
        v.company_id,v.fiscal_year_id,v.id,v.voucher_date,'customer_receipt',
        p_destination_account_id,v.total,'Cheque',v.party_id,v.handled_by,v.generated_by,
        p_approved_by,coalesce(nullif(v.narration,''),'Cheque cleared'),v.voucher_no,
        v.narration,'posted',cleared_at
      );
    end if;
  else
    update public.vouchers set cheque_status=p_status,cheque_cleared_at=null,
      money_account_id=null where id=v.id;
    update public.money_movements set status=p_status,posted_at=null,
      approved_by=p_approved_by where voucher_id=v.id;
  end if;
end $$;
