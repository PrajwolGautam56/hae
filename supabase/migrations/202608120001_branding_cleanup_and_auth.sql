update public.companies
set name='Hamro Afno Enterprises',
    address='Butwal-10, Rupandehi',
    phone='071-438662',
    logo_url='/hamro-afno-logo.jpeg';

delete from public.parties
where name in ('Tashi Delek Traders','Druk Hardware House','Karma General Store','Norbu Enterprise');

delete from public.products
where name in ('Penden Cement 50kg','TMT Steel Rod 12mm','Commercial Plywood 18mm','GI Pipe 1 inch');

alter table public.team_members add column if not exists auth_user_id uuid unique;
