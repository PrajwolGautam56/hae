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
6. Open the **Domain setup** checklist on the client card. Add that hostname to
   the **existing Vercel project → Settings → Domains**. Copy the DNS target
   Vercel supplies into a Cloudflare CNAME record for the subdomain (for example,
   name `ag` for `ag.kritechglobal.com`). Start DNS-only until Vercel verifies the
   domain and certificate. Use the target shown by Vercel, not an assumed IP.
   Cloudflare DNS alone does not register a hostname with the application host.
7. Open the client subdomain, select the company and confirm administrator login.

The screen intentionally hides project IDs, region and database credentials from
operations staff. If setup fails, the exact database/API error is shown and the
numbered action remains available for a safe retry.

Company administrators can subsequently manage their own company users from the
business dashboard. Kritech platform administrators can provision, invite,
change roles or deactivate company users from Control. The final active company
administrator cannot be removed or demoted.

## Company logo and launch check

Add or edit the company and upload its logo (PNG, JPEG or WebP, up to 500 KB).
The selected company's branding is used in its workspace and invoice detail.
Set the subscription's company limit, user limit and manufacturing module before
handing over the account. Invite the first administrator, activate the company,
then test its login, company selection and a report. Do not create sample financial
transactions in a customer's live books as a test.

Every company uses the same deployed application and shared business schema.
There is **no new branch, deployment, Supabase project or set of tables per
company**. Records are scoped by company and tenant membership, not just the
subdomain. Never distribute the server-side Supabase secret to customers.

Wildcard domains can reduce repeated DNS steps, but require both DNS and Vercel
wildcard TLS/domain configuration. Ask the platform operator to configure this
once; staff should use the per-domain checklist until it is verified.
See [Vercel domain setup](https://vercel.com/docs/domains/working-with-domains/add-a-domain)
and [wildcard domains with external DNS](https://vercel.com/kb/guide/wildcard-domain-without-vercel-nameservers).

## Troubleshooting

- DNS not found: check the exact subdomain and CNAME in Cloudflare.
- Vercel domain/certificate error: verify that hostname in the existing project's Domains page.
- Company absent: confirm the tenant's hostname and company assignment in Control.
- Login unavailable: follow the company's numbered setup button and ensure an active administrator exists.
- Email not delivered: verify the sending domain and a valid `Name <email@domain>` sender; do not repeatedly create duplicate users.

Backups must cover both Control metadata and business data. Shared-project backup
restores affect every customer: restore into a separate recovery project first,
then recover only the affected company's rows with relationship checks. Schedule
and test backups before relying on this as the only copy of the books.
