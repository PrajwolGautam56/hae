-- Additive audit/idempotency wrapper. Does not modify any existing quantities or vouchers.
create table public.manual_stock_requests (
  company_id uuid not null references public.companies(id),request_id uuid not null,
  product_id uuid not null,fiscal_year_id uuid not null,actor_id uuid not null,voucher_id uuid not null,
  request_payload jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
  primary key(company_id,request_id),
  constraint manual_stock_requests_company_product_fkey foreign key(company_id,product_id) references public.products(company_id,id),
  constraint manual_stock_requests_company_fy_fkey foreign key(company_id,fiscal_year_id) references public.fiscal_years(company_id,id),
  constraint manual_stock_requests_company_actor_fkey foreign key(company_id,actor_id) references public.team_members(company_id,id),
  constraint manual_stock_requests_company_voucher_fkey foreign key(company_id,voucher_id) references public.vouchers(company_id,id)
);
create index manual_stock_product_history on public.manual_stock_requests(company_id,product_id,created_at desc);
alter table public.manual_stock_requests enable row level security;
revoke all on public.manual_stock_requests from public,anon,authenticated,service_role;
grant select on public.manual_stock_requests to service_role;

create function public.record_manual_stock_adjustment(
 p_company_id uuid,p_fiscal_year_id uuid,p_product_id uuid,p_actor_id uuid,p_request_id uuid,p_date date,
 p_mode text,p_quantity numeric,p_expected_stock numeric,p_expected_cost numeric,p_reason text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare prior manual_stock_requests%rowtype; product products%rowtype; payload jsonb; result jsonb; delta numeric; note text;
begin
 if not exists(select 1 from team_members where id=p_actor_id and company_id=p_company_id and active and role in ('admin','manager','accountant')) then raise exception 'Company administrator, manager or accountant required'; end if;
 if p_request_id is null then raise exception 'Request ID required'; end if;
 payload:=jsonb_build_object('fiscalYearId',p_fiscal_year_id,'productId',p_product_id,'actorId',p_actor_id,'date',p_date,'mode',p_mode,'quantity',p_quantity,'expectedStock',p_expected_stock,'expectedCost',p_expected_cost,'reason',trim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_request_id::text,0));
 select * into prior from manual_stock_requests where company_id=p_company_id and request_id=p_request_id;
 if found then
   if prior.request_payload is distinct from payload then raise exception 'Request was already used with different values; check stock history before starting another adjustment'; end if;
   return prior.result||jsonb_build_object('duplicate',true);
 end if;
 if not exists(select 1 from companies where id=p_company_id and active) or not exists(select 1 from fiscal_years where id=p_fiscal_year_id and company_id=p_company_id and status='open' and p_date between start_ad and end_ad) then raise exception 'Select an open fiscal year and a date inside it'; end if;
 if p_mode is null or p_mode not in ('add','remove','count') or p_quantity is null or p_quantity::text in ('NaN','Infinity','-Infinity') or p_quantity<0 or p_quantity>1000000000 or p_quantity<>round(p_quantity,3) or (p_mode<>'count' and p_quantity=0) then raise exception 'Invalid stock adjustment quantity'; end if;
 if p_reason is null or length(trim(p_reason))<3 or length(p_reason)>1000 then raise exception 'A manual stock reason is required'; end if;
 -- Match the existing stock-journal lock order: sequence first, then product.
 insert into voucher_sequences(fiscal_year_id,voucher_type,last_number) values(p_fiscal_year_id,'stock_adjustment',0) on conflict do nothing;
 perform 1 from voucher_sequences where fiscal_year_id=p_fiscal_year_id and voucher_type='stock_adjustment' for update;
 select * into product from products where id=p_product_id and company_id=p_company_id and active for update;
 if not found then raise exception 'Active stock product does not belong to this company'; end if;
 if p_expected_stock is distinct from product.stock_qty or p_expected_cost is distinct from product.purchase_price then raise exception 'Stock or book cost changed. Refresh and review before saving'; end if;
 delta:=case p_mode when 'count' then p_quantity-product.stock_qty when 'remove' then -p_quantity else p_quantity end;
 if delta=0 then raise exception 'Stock is already equal to the counted quantity; no change needed'; end if;
 if product.stock_qty+delta<0 then raise exception 'This adjustment would make stock negative'; end if;
 note:='Manual stock adjustment (not a purchase): '||trim(p_reason)||case when product.purchase_price=0 then ' [No non-zero book cost recorded; quantity-only adjustment]' else '' end;
 result:=record_stock_adjustment(p_company_id,p_fiscal_year_id,p_date,jsonb_build_array(jsonb_build_object('product_id',product.id,'quantity_delta',delta,'unit_cost',product.purchase_price,'reason',note)),note,p_actor_id);
 result:=result||jsonb_build_object('requestId',p_request_id,'productId',product.id,'date',p_date,'stockBefore',product.stock_qty,'stockAfter',product.stock_qty+delta,'quantityDelta',delta,'unitCost',product.purchase_price,'source','manual','reason',trim(p_reason));
 insert into manual_stock_requests(company_id,request_id,product_id,fiscal_year_id,actor_id,voucher_id,request_payload,result)
 values(p_company_id,p_request_id,product.id,p_fiscal_year_id,p_actor_id,(result->>'id')::uuid,payload,result);
 return result;
end $$;
revoke all on function public.record_manual_stock_adjustment(uuid,uuid,uuid,uuid,uuid,date,text,numeric,numeric,numeric,text) from public,anon,authenticated;
grant execute on function public.record_manual_stock_adjustment(uuid,uuid,uuid,uuid,uuid,date,text,numeric,numeric,numeric,text) to service_role;
