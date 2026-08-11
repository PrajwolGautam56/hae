alter table public.vouchers add column if not exists cheque_no text;
alter table public.vouchers add column if not exists cheque_bank text;
alter table public.vouchers add column if not exists cheque_exchange_date date;
alter table public.vouchers add column if not exists cheque_status text
  check (cheque_status is null or cheque_status in ('pending','cleared','cancelled'));
alter table public.vouchers add column if not exists cheque_cleared_at timestamptz;

create index if not exists vouchers_cheque_due_idx
on public.vouchers(company_id,cheque_status,cheque_exchange_date)
where payment_mode='Cheque';
