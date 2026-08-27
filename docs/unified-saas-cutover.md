# Unified Supabase cutover runbook

The target is one shared Supabase project, one Auth directory, and shared business tables partitioned by `company_id`. Kritech Control stores subscriptions, limits, domains, module entitlements and the mapping to each business company.

## Safety gates

1. Keep the existing HAE project read/write until a verified migration window.
2. Apply every existing business migration to the new unified project, followed by `202608270001_unified_multi_tenant_saas.sql` and `202608270002_multi_tenant_security_hardening.sql`.
3. Apply `202608270001_unified_entitlements.sql` to Kritech Control.
4. Create encrypted/offsite backups of both projects. Run `scripts/backup-unified-databases.sh`; restore the dump into a disposable Postgres database and verify it opens.
5. Copy HAE data using a controlled database migration, preserving every UUID and foreign key. Do not import demo seed companies.
6. Run `scripts/reconcile-company.mjs COMPANY_UUID` against the source snapshot and destination. Counts and financial totals must match exactly; ledger debit and credit must balance.
7. Configure the three `UNIFIED_SUPABASE_*` server variables. Never expose the secret key as `NEXT_PUBLIC_*`.
8. Test two users in two companies, including the same email in both. Verify invoices, receipts, reports, customer portal, exports, user limits and disabled modules.
9. Put the legacy app briefly into maintenance/read-only mode, copy the final delta, reconcile again, then deploy the unified environment variables.
10. Keep the legacy project and backups unchanged for at least 30 days. Roll back by restoring the legacy environment variables if reconciliation or QA fails.
11. Run Supabase Security Advisor, then test hostile cross-tenant UUID substitutions before enabling the second customer.

## Ongoing backup policy

- Supabase managed daily backups/PITR according to the purchased plan.
- Nightly logical `pg_dump` stored outside Supabase with encryption and retention (7 daily, 4 weekly, 12 monthly).
- Monthly restore drill into a disposable database.
- Daily reconciliation/audit alert for unbalanced journal totals or failed voucher posting.
