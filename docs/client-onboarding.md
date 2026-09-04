# Kritech client onboarding

## One-time platform readiness

The deployment needs the shared business database variables:

- `UNIFIED_SUPABASE_URL`
- `UNIFIED_SUPABASE_PUBLISHABLE_KEY`
- `UNIFIED_SUPABASE_SECRET_KEY`

Apply all business migrations to that project, ending with the unified tenant
and security migrations. Kritech Control may remain a separate metadata project.

For the current two-project setup, the least disruptive cutover is to keep the
`Hamro` project as Kritech Control and promote the existing HAE business project
to the shared business database. Point the three `UNIFIED_SUPABASE_*` variables
to that HAE project only after applying the unified migrations and taking a
verified backup. No accounting rows need to be moved for this approach.

## Onboard a client (staff checklist)

1. Open **Kritech Control → Clients → New client**. Enter the group name,
   subdomain and primary contact. The system creates a Starter subscription.
2. Open **Subscription** only when company/user limits or modules must change.
3. Select **Add company** on the client. Company creation automatically attempts
   to provision its isolated shared-database workspace.
4. Open **Companies** and follow the single numbered button shown for that row:
   **1 · Provision workspace**, **2 · Add first admin**, or **3 · Activate login**.
   Completed companies show **Ready**.
5. The first active company user is always made Administrator and receives a
   one-time password setup email. Additional manager, accountant and staff users
   can then be added from **Manage users**.
6. Add one proxied Cloudflare wildcard DNS record (`*`) for the platform root
   domain. A new client subdomain then needs no code or database credential.
7. Open the client subdomain, select the company and confirm administrator login.

The screen intentionally hides project IDs, region and database credentials from
operations staff. If setup fails, the exact database/API error is shown and the
numbered action remains available for a safe retry.

Company administrators can subsequently manage their own company users from the
business dashboard. Kritech platform administrators can provision, invite,
change roles or deactivate company users from Control. The final active company
administrator cannot be removed or demoted.
