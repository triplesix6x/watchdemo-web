# Legal prelaunch frontend — coordinator QA

Implementation agent authored these checks but **did not run** tests, builds, servers or browsers (D25). Run only serially under `docs/scripts/run_limited_check.sh` from authoritative main, with no other verification job active. Do not install dependencies or use production data for this QA.

## Source and generated ownership

`src/content/legal.generated.json` and `public/legal/catalog-manifest.json` were copied from the catalog lane. They are generated, not frontend-owned edits: do not hand-edit or include them in the frontend commit. Current expected release: sequence 0, all five documents draft, legal review false, retention unset. Effective test documents exist only inside `signupPolicy.check.ts`, never in the published catalog.

## Serial commands for the parent (not executed by the worker)

From `frontend/`, using the absolute limiter path if this worktree has no `docs/scripts/`:

1. `LIMITER=/home/bigboss/PycharmProjects/watchdemo-web/docs/scripts/run_limited_check.sh`
2. `"$LIMITER" npm run check`
3. `"$LIMITER" npm run build:mock`
4. `"$LIMITER" node scripts/legal-prerender-check.mjs`

The existing check runner discovers `src/**/*.check.ts`, including:

- `src/features/legal/catalog.check.ts`: canonical hash, exact UTF-8 body hashes, all-draft release guard, generated manifest parity.
- `src/features/legal/signupPolicy.check.ts`: boundary rejection, draft/no acceptance, exact effective revision/hash/status/URL matching, unchecked/absent/mismatched text rejection, exact single terms payload.
- `src/features/pricing/prelaunchTiers.check.ts`: fixed IDs/prices, sales closed, monthly compatibility quota and actual period, group/set limits, voice/notes/playbooks, replay/stats on all plans.

For the browser pass, keep the already-built **mock** static server and browser inside one limited scope. `scripts/serve.mjs` serves `dist/` without an API proxy. A typical parent-owned invocation from `frontend/` is:

```sh
"$LIMITER" bash -c '
  node scripts/serve.mjs 4540 &
  server=$!
  trap "kill $server 2>/dev/null || true" EXIT
  QA_ORIGIN=http://127.0.0.1:4540 QA_MOCK_ONLY=1 \
    QA_OUTPUT_DIR=/home/bigboss/.cache/watchdemo-legal-prelaunch-qa \
    node scripts/legal-prelaunch-qa.mjs
'
```

Confirm the server is ready before navigation if needed. Do not run ordinary `npm run dev`: its API proxy targets production. The QA script requires localhost and explicit mock acknowledgement, blocks all API and external requests **before navigation**, uses only mock in-memory account data, and fails if any such request was attempted. It does not start a server. Use `QA_CHROME` only to select an already-installed browser. If the resource-limited scope cannot run Chromium, stop and report the limitation rather than running unrestricted.

## Browser coverage and artifacts

`legal-prelaunch-qa.mjs` runs 375px and 1280px RU/EN sequentially. It writes viewport screenshots and `legal-prelaunch-qa.json` to the explicit persistent output directory. It checks:

- Small first-visit notice, remembered dismissal (not analytics consent), settings Dialog keyboard cycle/Escape/focus restoration, no fake analytics control.
- Hub/latest/immutable revision direct links, Russian original in both shells, draft noindex, body equality, exact TXT bytes/hash, print chrome hidden.
- Draft registration with no added checkbox; unavailable/malformed effective text and policy failure block submission; stale 409 preserves email/username/password and offers policy reload.
- Register, Login and Overview failed resend does not show success, and retry can succeed.
- Sales-closed pricing, Telegram guest CTA, authenticated existing support-chat CTA, account legal footer.
- Horizontal overflow, page errors and axe serious/critical WCAG 2 A/AA and 2.1 AA violations on the legal hub/document/settings, pricing and signup surfaces.

Local-only mock controls: `wd-mock-legal-case=policy-error|enforced-unavailable|stale-register`, `wd-mock-resend-fail=1`, `wd-mock-unverified=1`, login `unverified@example.invalid`. These do not activate draft documents or add production API behavior. Clear storage after manual QA.

## Remaining manual review

- Inspect screenshots for readable legal line lengths, long hashes/metadata, sticky header/notice overlap, small-screen tap targets, public/auth/account footer and language switching. Review print preview separately; screenshots cannot validate pagination or an OS print dialog.
- Test 200% zoom, reduced motion and a narrow landscape viewport; check existing mobile nav and cookie Dialog do not conflict. Confirm Onest, ink/blue tokens and Home GhostFibers remain unchanged.
- Effective **successful** browser registration cannot be tested against this approved all-draft bundle. Its exact payload and matching gates are covered by pure fixtures; an integration/browser pass for effective success needs a separately coordinated nonpublished effective fixture and matching backend policy, never a modification of the live draft snapshot. Recheck checkbox clearing/field preservation after stale effective-policy 409 there.
- Review neutral Resend disclosure on register, resend/forgot-password, reset-password, unverified login/account, profile email and security password flows. It is informational, not a blanket consent or an invented legal basis. Existing users get no new mandatory legal banner.
- Review FAQ data requests via existing support only, sensitive-data warning, and deletion text: no all-record purge or local-demo/file deletion promise. No export button was added.
- Windows quota enforcement and legal activation, mail evidence and admin grant semantics remain other lanes' responsibilities; the UI does not claim to implement them.
