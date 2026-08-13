alter table public.companies alter column currency set default 'NPR';
update public.companies set currency='NPR' where currency is distinct from 'NPR';
