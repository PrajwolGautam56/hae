# Overdue reminders and paid SMS credits

## What is implemented

- Overview: today's FIFO overdue parties, total overdue, bill terms/days, preview, manual SMS/email, ledger links and recent send history. This uses today's account, not the currently selected historical FY. Undated imported openings are not assumed overdue. An invoice without an explicit due date uses its invoice date, consistent with the existing ageing report; its missing term is disclosed in the message.
- Party details: separate optional contact email (not portal login email), SMS/email opt-ins, company-scoped optimistic concurrency and audit.
- Platform admin → Clients → SMS credits & reminders: shared client/tenant wallet, paid or complimentary credit additions, audited removal of available credits, client allowance rules, company-attributed usage and reconciliation for uncertain sends. Reserved/spent credits cannot be removed.
- Overview → Write & send SMS: select any company party, write a custom message and see the dynamic credit charge before sending. The selected company's name is appended automatically. This does not require an overdue debt and does not postpone the independent 15-day overdue schedule.
- Clients see only their available/used/reserved credits and per-message charge. Provider names, provider IDs, wholesale purchase costs, internal credit rates and segment formulas are never exposed in client API responses or screens. Detailed diagnostics remain in platform administration.
- Server worker: opt-in only; first check after debt becomes overdue, then at least 15 days after the last accepted reminder **for that channel**. Manual accepted reminders restart this interval. Rechecks the latest FIFO debt. Fully paid/not-yet-due parties are skipped. SMS needs available enabled paid credits; email does not consume SMS credits.

## Before production activation

1. Apply the approved migrations `202611160001_overdue_reminders_and_sms_credits.sql` and `202611170001_manual_sms_and_credit_adjustments.sql` with fresh verified backups on the **unified HAE business project**, not the separate Control project. No financial ledger/journal entries or existing invoice totals are modified. All new tables/RPCs are service-role-only. The guarded `scripts/release-overdue-reminders.mjs` supports `inspect`, `dry-run`, `apply <backup>` and the second migration through `--manual-sms`. Set `SUPABASE_DB_POOLER_HOST` to the project's official session-pooler hostname if IPv6 is unavailable. Maintenance connections verify TLS against the pinned public Supabase CA.
2. Configure **server-only** messaging settings using encrypted Supabase Vault or `.env.example`. The Vault fallback is enabled by migration `202611170002_private_messaging_runtime.sql`; the guarded release script uses `--runtime` for it. `scripts/configure-messaging-runtime.mjs vault` imports the SMS settings from an ignored `.env.messaging.local` file and generates/stores an independent random scheduler secret. The application reads only the explicit messaging allowlist using a service-role-only RPC, caches it for five minutes, and fails closed if refresh fails. Explicit server environment values override Vault (so an environment kill switch remains authoritative). Never prefix the SMS key with `NEXT_PUBLIC_`, embed it in Git, or send it in a browser URL. Use the approved sender/route/campaign for the account. The particular company name is included in the message; email uses that company's display name with the platform's verified email sender domain.
3. Configure your own **client** credit allowance rule in the platform admin panel. The application's rule uses GSM-7 160/153 units and Unicode 70/67 UTF-16 units, with extension characters counted as two units. This is independent of your provider purchase price. No provider rupee price needs to be given to the client or set to enable this feature. The final message must fit within 720 characters. The chosen internal credit rate and the final message determine the quoted client-credit charge; the client sees only that charge. An optional top-up payment amount is private audit metadata, not automatic pricing or a company financial receipt.
4. Platform admin: set client credits/segment, enable SMS, and manually add paid or complimentary credits with a note. To reduce a balance, use Remove available credits and enter a negative adjustment; the database rejects removals exceeding available credits. The shared wallet applies to all that client's companies; sends remain company-scoped. No credits are seeded automatically.
5. Add valid mobile/email contacts and explicitly opt in the relevant parties. The client should have the party's agreement before enabling automatic notifications.
6. Set `OVERDUE_REMINDERS_ENABLED=true` after the above setup. A real test requires an explicitly selected test mobile number; never pick an existing customer's number for a test. No SMS/emails are sent by the test suite, and no production scheduler is enabled by a code push alone.

## Scheduler setup (required for automatic reminders)

### Supabase Cron (works without a Vercel paid scheduling plan)

After deploying the runtime-aware application and storing the Vault settings:

```
node scripts/configure-messaging-runtime.mjs probe
node scripts/configure-messaging-runtime.mjs schedule
node scripts/configure-messaging-runtime.mjs status
```

The no-send probe refuses to run when any party is opted in. `schedule` first validates the live worker with that safe probe, then enables Supabase `pg_cron`/`pg_net` and creates a single named 15-minute job. It reads the Authorization secret from Vault at execution time; the secret is not embedded in the cron command. Browser roles are explicitly denied access to the private cron/network schemas. Do not also enable Vercel cron for the same worker.

### Alternative: Vercel or external scheduler

Set a strong random `CRON_SECRET` (minimum 32 characters) in Vault or on the **business application deployment**, then arrange a server scheduler to call:

```
GET https://hamro.kritechglobal.com/api/cron/overdue-reminders
Authorization: Bearer <CRON_SECRET>
```

Recommended interval: every 15 minutes. This is a *checking interval*, not a sending interval; the database enforces 15 days per party/channel. Use exactly one business deployment as the scheduler target. Overlapping invocations are safe through queue claims, party/channel locks, request IDs and held credits.

For a Vercel plan that supports this frequency, add the following to `vercel.json` after approval (preserve existing settings):

```json
"crons": [{ "path": "/api/cron/overdue-reminders", "schedule": "*/15 * * * *" }]
```

Alternatively use a secure external scheduler with the Authorization header. Vercel injects `CRON_SECRET` for its configured cron calls. No public browser login is needed; without the correct secret the route returns 401. The route uses both unified and Control credentials to re-verify active client/subscription/accounting entitlement and company access. Disabled, expired and suspended clients do not receive automatic sends.

Each worker claims up to 20 party checks, observes a runtime deadline, checks a party at most once in six hours, and allows unfinished leases to expire in ten minutes. This is deliberately bounded. Monitor returned `deferred`/`checked` counts and backlog as clients grow; increase scheduler frequency or move the same worker to a durable queue if capacity becomes insufficient. Do not claim exact-to-the-minute delivery; first sends happen on an eligible scheduled check.

## Accounting for credits and uncertain sends

- `available + held + spent = credited` is a database constraint.
- `credited` is the net total granted allowance after administrator additions/removals, not a price or amount paid. Every adjustment is an append-only audited entry and a locked transaction.
- Reserve credits in a locked transaction **before** the provider request. Client input cannot choose the tenant/company, recipient, amount or message; these are reconstructed server-side and the preview hash is verified.
- Only documented `SMS-SHOOT-ID/...` acceptance is recorded as accepted/spent. A documented `ERR:` rejection refunds the reservation exactly once. HTTP timeout/unrecognized response leaves credits held and blocks further reminders for that party/channel, preventing an accidental duplicate billable SMS.
- **Accepted is not delivered.** A phone delivery failure after provider acceptance is not automatically refunded; this depends on the provider's billing policy. SMS Pasal DLR polling/webhooks are not implemented in this release. Use the stored shoot ID and provider dashboard to investigate.
- Platform admins can resolve an uncertain/stale reserved send after checking actual provider records, with mandatory evidence/note. A fresh reservation cannot be manually resolved for two minutes while a provider call may still be processing. Never release held credits solely because the recipient says they did not receive a message.
- If provider acceptance succeeded but the database outcome could not be saved, the reservation remains and is never automatically re-sent. Reconcile it using provider records. SMS Pasal does not document request idempotency, so blind HTTP retries are intentionally forbidden. Resend receives its own idempotency key in addition to our database dedupe.
- Both accepted and failed outcomes are terminal. Corrections to an accepted delivery need an explicit future audited adjustment workflow, not editing or deleting the existing credit ledger.
- Back up the new wallet, delivery and credit-ledger tables with the other business tables; they are included by the existing application backup script's table discovery. Full provider backups/PITR and off-device backup retention remain separate operational requirements.

## Verification

```
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node --test tests/*.test.mjs
node node_modules/next/dist/bin/next build --webpack
```

Tests mock provider HTTP calls and use an isolated Postgres-compatible engine. They cover credit conservation, duplicate top-ups, simultaneous-request safety through locking/constraints, reservations/refunds, cooldown, zero credits, opt-ins, role/tenant isolation, Unicode segments, provider parsing and replay behavior without modifying production balances or sending real messages.

Provider references: [SMS Pasal](https://sms.smspasal.com/) (account-provided API documentation), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
