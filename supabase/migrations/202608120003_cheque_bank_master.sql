create table if not exists public.cheque_banks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(company_id,name)
);

alter table public.cheque_banks enable row level security;

insert into public.cheque_banks(company_id,name)
select distinct company_id,trim(cheque_bank) from public.vouchers
where payment_mode='Cheque' and nullif(trim(cheque_bank),'') is not null
on conflict(company_id,name) do nothing;
