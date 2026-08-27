# Tenant security model

The application treats every customer company as potentially hostile to every
other company. A subdomain and a company-selection cookie are routing inputs;
neither is accepted as an authorization boundary.

## Request boundary

1. Resolve the tenant from the request host.
2. Resolve the company by both `organization_id` and company slug.
3. Validate the Supabase Auth access token on the server.
4. Require an active `team_members` or `parties` row for that exact company.
5. Re-resolve every submitted party, product, voucher, account, employee, lead,
   task, order, and fiscal-year ID inside that company before any privileged
   database call.

The server secret key is never exposed as a `NEXT_PUBLIC_*` value. Business
tables and security-definer RPCs are not executable through the browser Data
API. Application APIs may use the server key only after the checks above.

## Database boundary

- Every company-owned table carries `company_id` and has RLS enabled.
- Browser roles have no business-table or RPC grants.
- Composite foreign keys such as `(company_id, party_id)` prevent a privileged
  API bug from linking records across companies.
- Child tables that inherit company ownership from a parent use guard triggers.
- Existing rows are introduced with `NOT VALID` constraints so deployment does
  not rewrite or block the production database. New writes are protected at
  once. Historical constraints must be validated after reconciliation.

## Identity rules

One Auth identity may intentionally belong to more than one company. A company
administrator may invite or disable membership only in their own company.
Administrators cannot overwrite a customer's shared Auth password. Password
changes use a one-time recovery link delivered to the identity owner.

## Production verification

- Run the tenant isolation regression test and a production build.
- Back up and reconcile the database before applying security migrations.
- Apply `202608270002_multi_tenant_security_hardening.sql` after the unified
  foundation migration.
- Run Supabase Security Advisor and Performance Advisor after deployment.
- Test with two tenants: tamper every URL/body UUID and verify a 403/404/error
  without observing or mutating the other tenant.
- Enable MFA for Kritech platform administrators, rate-limit login/reset APIs,
  alert on repeated authorization failures, and perform recurring restore tests.

