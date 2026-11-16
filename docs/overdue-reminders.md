# Overdue reminders and paid SMS credits

## What is implemented

- Overview: today's FIFO overdue parties, total overdue, bill terms/days, preview, manual SMS/email, ledger links and recent send history. This uses today's account, not the currently selected historical FY. Undated imported openings are not assumed overdue. An invoice without an explicit due date uses its invoice date, consistent with the existing ageing report; its missing term is disclosed in the message.
- Party details: separate optional contact email (not portal login email), SMS/email opt-ins, company-scoped optimistic concurrency and audit.
- Platform admin → Clients → SMS credits & reminders: shared client/tenant wallet, manual paid-credit additions, rate/access settings, company-attributed usage, audit and reconciliation for uncertain sends.
- Server worker: opt-in only; first check after debt becomes overdue, then at least 15 days after the last accepted reminder **for that channel**. Manual accepted reminders restart this interval. Rechecks the latest FIFO debt. Fully paid/not-yet-due parties are skipped. SMS needs available enabled paid credits; email does not consume SMS credits.

## Before production activation

1. Approve a fresh backup and migration `202611160001_overdue_reminders_and_sms_credits.sql` on the **unified HAE business project**, not the separate Control project. No financial ledger/journal entries or existing invoice totals are modified. All new tables/RPCs are service-role-only.
2. Configure **server-only** variables from `.env.example`. Never prefix the SMS key with `NEXT_PUBLIC_`, embed it in Git, or send it in a browser URL. Use the SMS Pasal approved sender/route/campaign for the account. The sender ID shown on the phone is provider-approved; the particular legal company name is included in the message text. Email uses that company's display name with the platform's verified email sender domain.
3. Confirm with SMS Pasal the multipart billing rules (GSM-7 160/153 units and Unicode 70/67 UTF-16 units) and set `SMSPASAL_BILLING_CONFIRMED=true` only when they match. The estimate counts GSM extension characters as two units. The provider maximum is 720 characters; oversized messages are blocked before reserving credits. The rate is **credits per segment**, not rupees per character. An optional top-up payment amount is audit metadata, not automatic pricing or a financial receipt.
4. Platform admin: set confirmed credits/segment for the client, enable SMS, add the paid credits with a payment reference. The shared wallet applies to all that client's companies; individual sends remain company-scoped. No default/free credits are seeded.
5. Add valid mobile/email contacts and explicitly opt in the relevant parties. The client should have the party's agreement before enabling automatic notifications.
6. Set `OVERDUE_REMINDERS_ENABLED=true` only after the above checks and an explicitly approved single test send. No SMS or emails are sent by the test suite, and no production scheduler is enabled by this code change alone.

## Scheduler setup (required for automatic reminders)

Set a strong random `CRON_SECRET` (minimum 32 characters) on the **business application deployment**, then arrange a server scheduler to call:

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
