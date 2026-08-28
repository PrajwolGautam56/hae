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

## Onboard a client

1. Open Kritech Control and select **New client**.
2. Enter the client/group name, unique subdomain, contact and subscription.
3. Add one or more companies under that client.
4. In **Companies**, click **Provision**. This creates the isolated business
   company, chart of accounts, office cash account and current Nepali fiscal year.
5. Click **Users** and create the first company administrator. The first active
   user is forced to the `admin` role and receives a one-time password setup link.
6. Add manager, accountant and staff users as required. The tenant subscription
   user limit is enforced across its companies.
7. Confirm the Cloudflare DNS record for the client subdomain, test login, then
   set the client onboarding stage to **Ready**.

Company administrators can subsequently manage their own company users from the
business dashboard. Kritech platform administrators can provision, invite,
change roles or deactivate company users from Control. The final active company
administrator cannot be removed or demoted.
