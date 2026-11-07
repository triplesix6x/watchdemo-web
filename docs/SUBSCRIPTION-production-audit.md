# Subscription production regression audit

Date: 2026-11-05

Status: confirmed findings corrected and verified locally. Changes remain uncommitted in both repositories. This document does not approve deployment or certify every possible execution path.

## Request and baseline

After committing and deploying the previous implementation, the operator reported poorly positioned login controls, repeated successful access/reconciliation requests and unavailable quota counters in the desktop application. The operator requested independent logic/security and maintainability reviews, agent-assisted fixes and local changes in both repositories, without commits or pushes.

Audited deployed baselines:

- Web: `8f8509f..5455669`, including `92d0669` (`Hotfix: subscriprion tracking`) and its merge.
- Windows application: `3821a58..f195bbf` (`0 8 5`).

The reviews traced subscription, authentication, API/IPC, quota periods, account locking, import staging/recovery, groups, sets, paid data, signed leases and related reactive UI callers. This was a broad source audit, not proof that every file or possible interleaving is defect-free. Source review and executable verification are reported separately.

## Confirmed findings in the deployed implementation

### P1: Access reads recursively emit authentication transitions

Original locations: `D:/demo-manager/src-tauri/src/services/auth.rs:69-71,265-273` and `D:/demo-manager/src/lib/auth.svelte.ts:35-41,68-80`.

A successful quota read called `publish_view()`, emitting `auth://state`. The frontend handler cleared its access snapshot, advanced its revision and requested access again. The next successful read emitted the same event. This was an event feedback cycle, not an intentional polling interval. Competing responses were retired, leaving quota displays unknown despite HTTP 200 responses.

Required correction: quota reads must not announce an authentication transition. Preserve counters across unchanged identity notifications, coalesce concurrent reads and reject only genuinely stale activation results. Do not hide logs or merely increase a timer.

### P1: A snapshot read owns full mutation synchronization

Original location: `D:/demo-manager/src-tauri/src/services/subscription.rs:142-178`.

Every read performed access GET, group reconciliation, pending-operation recovery, a second reconciliation and tombstone synchronization. Even an empty library generated three HTTP requests. Recovery failures could prevent an accepted snapshot from reaching the UI.

Required correction: separate read ownership from activation/mutation synchronization. Reconcile actual inventory when activation or server generation requires it; retain explicit recovery and tombstone paths. A failed pending mutation must not automatically erase otherwise valid quota information.

### P1: Definitive local validation is treated as uncertain submission

Original locations: `D:/demo-manager/src/lib/subscription.ts:73-93`, `D:/demo-manager/src/lib/components/Sidebar.svelte:157-176,497-504` and `D:/demo-manager/src-tauri/src/adapters/persistence/sqlite_subscription.rs:46-50`.

A duplicate group name is rejected before staging/reservation, but the creation controller retains the immutable pending payload. The UI then offers only retry of the same invalid name.

Required correction: distinguish a known pre-submission refusal from an uncertain response. Release pending identity only for a proven terminal outcome; do not clear arbitrary database/network errors that might follow a committed operation.

### P1: Recovery publishes imports without notifying the catalog

Original locations: `D:/demo-manager/src-tauri/src/services/subscription.rs:245-250,274-283`, `D:/demo-manager/src-tauri/src/services/import.rs:98,118-122` and `D:/demo-manager/src/lib/importController.ts:127-147`.

If the server commits but its response is lost, later cancellation can discover the committed state and publish the demo locally. The original success-only `demo_added` notification is absent from that path. The item is persisted and charged but missing from the mounted catalog until another reload.

Required correction: publication owns its activation-bound visibility notification after the local transaction, including recovery/cancellation. Do not depend exclusively on the initiating command's success callback.

### P1: Normal web credential rotation invalidates another same-session request

Original location: `frontend/src/api/client.ts:49-52,188-189,199-218`.

Requests A and B share an expired bearer. A refreshes successfully before B's original 401 arrives. B sees a changed credential revision and returns an authentication failure despite a valid current session.

Required correction: distinguish verified same-session rotation from semantic activation replacement. Permit one bounded retry through the former; never reuse a different login, including same-account relogin, or a mismatched subject/session. Preserve logout-cookie ordering and pending reset barriers.

## Login chrome

The language and window buttons were fixed independently to opposite shell corners, outside the otherwise accepted login card. This layout predates the subscription diff; it is not falsely attributed to the quota changes. The isolated UI change places compact controls in a coherent card-local header while retaining the form, logo and palette. Geometry, focus and routing require rendered checks, not source approval alone.

## Review and verification record

Two independent read-only reviews were used, one for correctness/security and one for maintainability/logic design. The latter confirmed the additional validation, recovery notification and same-session request defects. Reviewers found existing protections for account serialization, immutable metering timestamps, transactional local publication, paid-data read/delete boundaries, signed lease verification and opaque quota metadata in the paths examined. Those observations are not universal security guarantees.

The previous verification checked native services and mounted components separately but did not exercise the access-read/auth-event cycle. That coverage gap is a cause of the escaped regression. New checks must exercise the production event/request ownership seams and assert bounded request counts, installed counters and eventual quietness, not merely successful parsing or compilation.

### Web correction verified

The web worker changed only `frontend/src/api/client.ts` and its production-client checks. Explicit credential installation/clearing now retires opaque request ownership; only a validated same-subject/session refresh preserves it. An original late 401 may retry the current bearer once within that ownership. Logout, same-account relogin, A → B → A and cross-tab subject/session changes remain replacement boundaries.

Executed sequentially in the Windows Job Object (1 GiB aggregate memory, one logical CPU):

- Frontend TypeScript: passed.
- All 18 frontend check scripts: passed, including 40 client/auth deferred-request cases and 18 reset-controller cases. Nine client cases are new for this correction; the mobile layout source check is also new.
- Existing mounted React/browser cookie-ordering suite: all three groups passed (logout/login cookie ordering, delayed same-account `/me`, and shared-cookie cross-tab identity rejection).

An independent focused review of this two-file correction and real authentication callers found no confirmed issue. It was source-only and does not independently certify the runtime results. The browser suite uses simulated loopback HTTP; it is not a live production or complete backend/browser composition.

## Desktop corrections and follow-up review

All five deployed findings above were corrected. Ordinary `refresh()` now reads access without journal recovery or repeated inventory reconciliation. Explicit `synchronize()` remains responsible for activation/recovery, and generation changes still reconcile actual groups before new creation. Access reads do not emit `auth://state`. Frontend reads coalesce; unchanged local identity notifications neither erase counters nor start network reads.

New local staging refusals carry `submission: "not_submitted"` only when the journal proves that all supplied IDs are new and local validation failed before submission. Uncertain errors keep their original operation identity. Publication now emits an account/activation-owned `catalog://changed` notification after the SQLite transaction, including recovery and cancellation paths. This is separate from authentication/access events.

A post-fix independent review identified three further corrections:

- Overlapping catalog refreshes needed latest-request ownership for both installing results and ending loading. Otherwise an older `[A]` response could replace a newer `[A, B]` catalog.
- A pre-existing denial-recovery test needed to call explicit `synchronize()`, not the newly read-only `refresh()`. Separate tests continue to require that reads do not recover mutations.
- Saved-set publication needed a saved-shelf refresh, not full review initialization, which reset the selected player. Request/context ownership now protects saved and automatic sets independently.

These were corrected by a separate bounded worker. Final independent source review found no additional confirmed issue in that correction or the mobile layout delta. This is bounded review evidence, not a whole-repository guarantee.

### Executed desktop verification

Checks ran sequentially, using one CPU and a 1 GiB Windows Job Object; Rust compilation and native execution used the previously authorized 4 GiB limit.

| Check | Actual result |
| --- | --- |
| Native unit compilation, `cargo test --offline --locked -j 1 --lib --no-run`, `CARGO_INCREMENTAL=0` | PASS, 54.31 s; seven pre-existing unused-code/import warnings |
| Native subscription filter | 20/20 PASS, including read-only requests on all tiers, activation/recovery separation, generation reset, pre-submission validation, lost-commit publication and authentication-event silence |
| Native playbook, updater and entitlement filters | 2/2, 10/10 and 2/2 PASS; one entitlement case overlaps the subscription filter: **33 unique native tests** overall |
| Production TypeScript subscription helpers/controllers | 25 behavior groups PASS |
| Production auth store and actual AccountModal mount callbacks in headless module harness | 4/4 PASS |
| Production App/MatchReviewTab script harness | 15/15 PASS, including reversed completions and context retirement |
| Svelte check | 0 errors, 0 warnings |
| RU/EN validation | 714 matching keys, 78 checked files |
| Mounted AuthStore + AccountModal in browser | Basic/Plus/Pro counters visible; eight duplicate authentication events and eight concurrent explicit refreshes each produce at most one additional access read; unchanged local events and idle time produce none |
| Mounted LoginApp in browser | RU/EN at 375, 491 and 1280 px: controls stay inside the card, have at least 44 px hit areas, accessible labels, keyboard focus and correct simulated native-call routing |

The initial headless multi-instance test harness shared mount callback slices, causing one instance to replay another's callbacks. The fixture now gives each actual component script its own lifecycle registrations; the original request-count assertions remain intact. Browser setup failures were likewise fixture-only (a conflicting `$state` binding and missing native `isTauri` export); failed attempts are not counted as passes.

Artifacts: `docs/qa/subscription-production-audit/browser-result.json`, `quota-{basic,plus,pro}.png` and `login-{ru,en}-{375,491,1280}.png`. The 491 px Russian login and Plus account screenshots were visually inspected. The browser mounts actual production stores/components but simulates the native bridge; it does not validate a packaged Tauri window or the operating system window manager.

## Mobile replay alignment — additional report

The operator subsequently reported the website replay's asymmetric right gutter. Desktop `width: 100%` survived inside the mobile negative-margin band, keeping the narrower content width while moving the frame left. At 390 px this left 32 CSS px on the right, consistent with the supplied screenshot.

`frontend/src/features/home/home.css` now uses `width: auto` only in the existing ≤899 px rule. The housing stretches across both negative margins; radar padding stays symmetric. Desktop sizing, map geometry, typography and CTA styling are unchanged. No overflow masking was added.

The isolated browser mounts the actual `Home`, `Radar`, `PublicLayout`, auth context, production CSS and motion initialization. Measured frame bounds were **0..375**, **0..390** and **0..430** at the corresponding mobile widths; at 1280 px the original right column remained **550..1240**. All four widths had no horizontal page overflow, page exceptions or external requests. The 390 px screenshot was visually inspected. HTTP is simulated and reduced motion is enabled; physical iOS Safari remains untested.

Artifacts: `docs/qa/subscription-production-audit/mobile-replay-result.json` and `mobile-replay-{375,390,430,1280}.png`.

## Delivery boundary

No production service was contacted. Temporary browser/server processes are closed in `finally`; test data uses the existing isolated fixtures. No commits, staging, pushes, releases, dependency installations or deployment were performed for this correction. User-provided untracked files and the four earlier untracked QA images were preserved. The temporary login worktree was merged as a patch and removed; all application changes remain in the two original working trees.

Remaining verification limits are packaged/native window behavior, physical Safari and exhaustive whole-application interleavings. PostgreSQL/API schemas were not changed by this correction, so the previous database integration evidence is historical rather than a newly executed database run.
