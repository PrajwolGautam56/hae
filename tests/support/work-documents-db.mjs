import { readFile } from 'node:fs/promises';
export const ids = { company:'10000000-0000-0000-0000-000000000001', other:'10000000-0000-0000-0000-000000000002', fy:'20000000-0000-0000-0000-000000000001', fy2:'20000000-0000-0000-0000-000000000002', staff:'30000000-0000-0000-0000-000000000001', otherStaff:'30000000-0000-0000-0000-000000000002' };
export async function fixture(PGlite) {
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create table companies(id uuid primary key,name text,logo_url text,address text,phone text,settings jsonb default '{}',created_at timestamptz default now());
    create table fiscal_years(id uuid primary key,company_id uuid references companies(id),start_ad date,end_ad date,label_bs text,unique(company_id,id));
    create table parties(id uuid primary key default gen_random_uuid(),company_id uuid references companies(id),name text,phone text,party_type text,unique(company_id,name));
    insert into companies(id,name,address,settings) values('${ids.company}','QA Company','Test address','{"pan":"123456789"}'),('${ids.other}','Other company','Other address','{}');
    insert into fiscal_years values('${ids.fy}','${ids.company}','2026-07-17','2027-07-16','2083/84'),('${ids.fy2}','${ids.other}','2026-07-17','2027-07-16','2083/84');`);
  let initial=await readFile(new URL('../../supabase/migrations/202608100001_crm_work_management.sql',import.meta.url),'utf8');
  initial=initial.replace(/do \$\$ declare c uuid; begin[\s\S]*?end \$\$;/,'');
  await db.exec(initial);
  await db.exec(`create unique index team_company_id on team_members(company_id,id);
    insert into team_members(id,company_id,name,role) values('${ids.staff}','${ids.company}','QA Employee','admin'),('${ids.otherStaff}','${ids.other}','Foreign Employee','staff');`);
  await db.exec(await readFile(new URL('../../supabase/migrations/202609260001_tasks_and_commercial_documents.sql',import.meta.url),'utf8'));
  return db;
}
