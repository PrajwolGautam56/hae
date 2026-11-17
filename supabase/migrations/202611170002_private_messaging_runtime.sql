-- Existing Supabase Vault encrypts values at rest. Only server service-role code may read this allowlist.
create function public.get_messaging_runtime_config() returns jsonb
language sql stable security definer set search_path=public,vault as $$
  select coalesce(jsonb_object_agg(name,decrypted_secret),'{}'::jsonb)
  from vault.decrypted_secrets
  where name in ('SMSPASAL_API_KEY','SMSPASAL_SENDER_ID','SMSPASAL_ROUTE_ID','SMSPASAL_CAMPAIGN_ID','CRON_SECRET','OVERDUE_REMINDERS_ENABLED');
$$;
revoke all on function public.get_messaging_runtime_config() from public,anon,authenticated;
grant execute on function public.get_messaging_runtime_config() to service_role;
