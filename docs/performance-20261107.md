# Login and accounting save responsiveness

Local implementation only; no production data or schema was changed.

## Causes confirmed in code

- Every accounting mutation waited for the entire accounting snapshot (master data, ledger, dashboard, stock and balances), plus repeated company/FY/member lookups, before returning success.
- Invoice creation/editing repeated metadata updates already performed inside `record_classified_invoice`. Each extra voucher UPDATE also invokes the deferred journal rebuild trigger.
- Password verification and business-company lookup ran sequentially despite being independent. Registry company, subscription and entitlement reads were also needlessly serial.
- Client login/save handlers did not consistently clear their busy state on rejected network requests.
- A pre-mutation cache request could complete later and replace freshly invalidated data.

## Changes

- Accounting clients may request `Prefer: return=minimal`. The server acknowledges only after the existing write workflow completes; it does not wait for a second dashboard read. Legacy clients still receive their snapshot and reuse the already verified context/member.
- The UI closes the saved form, shows a persistent refresh status and fetches current balances/stock separately. A refresh failure is explicitly **not** a save failure. Refresh retry is GET-only. Next accounting save and FY switching are gated until synchronization succeeds.
- Removed redundant invoice attribution/due-date UPDATEs; the transactional RPC remains the source of those fields. No journal, stock, ownership or carry-forward writes were moved to background work.
- Independent login/registry reads run concurrently. Password verification and active company membership remain mandatory. No shared authenticated-user cache was introduced.
- Removed redundant post-login router refresh. Successful login clears old company snapshots/report caches.
- Added busy-state cleanup, duplicate-submit locking, stale-response guards and cache invalidation generations.

## Verification and limits

- Automated tests cover minimal acknowledgement without snapshot reads, compatibility, invalidation races, concurrent login, denied authentication/membership, and transactional metadata preservation.
- Real production login/save latency was not benchmarked: no real customer accounting entries were created for testing. Measure browser Network timings after deployment before claiming a percentage improvement or upgrading infrastructure.
- These performance changes require no new SQL migration. Earlier Task/Quotation work in this worktree has its own unapplied migration and must not be included accidentally in a performance-only release.
