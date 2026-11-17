import {readFile} from 'node:fs/promises';
export const ids={tenant:'10000000-0000-4000-8000-000000000001',otherTenant:'10000000-0000-4000-8000-000000000002',company:'20000000-0000-4000-8000-000000000001',sibling:'20000000-0000-4000-8000-000000000002',other:'20000000-0000-4000-8000-000000000003',member:'30000000-0000-4000-8000-000000000001',staff:'30000000-0000-4000-8000-000000000002',otherMember:'30000000-0000-4000-8000-000000000003',party:'40000000-0000-4000-8000-000000000001',secondParty:'40000000-0000-4000-8000-000000000002',otherParty:'40000000-0000-4000-8000-000000000003'};
export async function fixture(PGlite,latest=false){
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create table platform_tenants(id uuid primary key);
    create table companies(id uuid primary key,organization_id uuid references platform_tenants(id),name text,active boolean default true);
    create table team_members(id uuid primary key,company_id uuid references companies(id),role text,active boolean default true,unique(company_id,id));
    create table parties(id uuid primary key,company_id uuid references companies(id),name text,place text,address text,phone text,tax_no text,opening_balance numeric default 0,unique(company_id,id));
    create table ledger_entries(id int primary key,debit numeric,credit numeric);
    insert into platform_tenants values('${ids.tenant}'),('${ids.otherTenant}');
    insert into companies(id,organization_id,name) values('${ids.company}','${ids.tenant}','Hamro Afno Enterprises'),('${ids.sibling}','${ids.tenant}','AG Manufacturing'),('${ids.other}','${ids.otherTenant}','Other private company');
    insert into team_members(id,company_id,role) values('${ids.member}','${ids.company}','admin'),('${ids.staff}','${ids.company}','staff'),('${ids.otherMember}','${ids.other}','admin');
    insert into parties(id,company_id,name,phone) values('${ids.party}','${ids.company}','AP Traders','9841000000'),('${ids.secondParty}','${ids.company}','Buyer 2','9841000001'),('${ids.otherParty}','${ids.other}','Other buyer','9841000002');
    insert into ledger_entries values(1,100000,0),(2,0,50000);`);
  const profile=await readFile(new URL('../../supabase/migrations/202611100001_party_details_and_opening_policy.sql',import.meta.url),'utf8');
  await db.exec(profile.slice(0,profile.indexOf('-- Imported balances')));
  await db.exec(await readFile(new URL('../../supabase/migrations/202611160001_overdue_reminders_and_sms_credits.sql',import.meta.url),'utf8'));
  if(latest)await db.exec(await readFile(new URL('../../supabase/migrations/202611170001_manual_sms_and_credit_adjustments.sql',import.meta.url),'utf8'));
  return db;
}
