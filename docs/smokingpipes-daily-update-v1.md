# Smokingpipes Daily Update V1

Daily Update V1 is still under real-site validation. It never applies,
commits, pushes, deploys, or bypasses verification by itself.

## Current safety status

A 107-page result is not trusted when any page records strong verification.
If `captchaDetected=true`, the run is blocked even when
`fullExpectedRangeScanned=true`:

- `allowApply=false`;
- no detail queue is created or reused;
- no product details are fetched;
- no daily-next or public-products-next candidate is generated;
- production, commit, and push remain false.

Do not enable a Daily Update scheduled task yet. Detail-probe real validation
must pass before the next Daily Update stage.

## 2026-06-22 real verification-probe findings

Two real list-only probes established the current pacing boundary.

Conservative run `20260622-182843`:

- 107/107 pages;
- 967865 ms total;
- 9.045 seconds per page;
- no weak or strong signal;
- no CAPTCHA.

Former daily-profile run `20260622-193847`:

- strong verification on page 60;
- 277635 ms total;
- 4.627 seconds per page;
- first strong signal after 276.164 seconds;
- page 60 parsed zero products and contained a verification keyword.

Conclusions:

- full reconciliation must use the conservative profile;
- approximately 4.6 seconds per page is too aggressive for a long scan;
- approximately 9 seconds per page completed the real 107-page scan;
- OUT OF STOCK and missing-price records did not trigger verification;
- page 73 is not a fixed risk page and was likely an old false positive;
- risk appears related to many continuous requests in a short period;
- faster pacing is limited to a short 5-10 page daily-new investigation.

## Verification probe

```powershell
node scripts/inventory/run-inventory-automation-v1.mjs --source=smokingpipes --mode=verification-probe --refresh-list --max-pages=107 --browser-channel=msedge --allow-manual-verification=true --page-warmup-min-ms=1500 --page-warmup-max-ms=3000 --page-delay-min-ms=3000 --page-delay-max-ms=6000 --page-batch-size=30 --page-batch-cooldown-min-ms=30000 --page-batch-cooldown-max-ms=60000 --no-commit --no-deploy --verbose
```

Probe mode scans list pages only. It does not fetch details, create inventory
candidates, or write production data. Strong verification stops access
immediately.

Outputs:

- `data/inventory/smokingpipes-verification-telemetry.json`
- `data/review/smokingpipes-verification-telemetry-report.md`

Each page records timing, pacing, parsed products, out-of-stock and
missing-price counts, weak and strong signals, and final classification.
Screenshots are optional and only captured for strong signals. Cookies,
headers, browser profiles, and sensitive session data are not stored.

## Chrome persistent-profile diagnostic

Daily Update is still not fully validated for unattended real operation.
Chrome persistent-profile support is a controlled diagnostic for comparing the
existing Edge behavior with a dedicated Chrome session. It does not approve
automatic Daily Update, apply, commit, deployment, or CAPTCHA bypass.

Use the dedicated profile documented in
`docs/smokingpipes-browser-profile-v1.md`. Never point the runner at the normal
Chrome `User Data` directory. Manual verification has a timeout, and recovery
is accepted only after the requested list or detail product content parses
successfully.

Run `browser-preflight` first to verify local Chrome startup and profile
locking. Then use `verification-probe` and finally the isolated
`detail-probe`. Daily Update should not advance to its next rollout stage until
the real Chrome detail-probe has been reviewed successfully.

Weak verification text with normal parsed product cards is a warning. Strong
verification requires zero parsed products and explicit challenge evidence.
OUT OF STOCK, sold out, and missing price are never verification evidence.

## Full reconcile pacing

The enforced default for Daily Update or verification-probe scans over 10
pages is:

- page warmup: 1500-3000 ms;
- page delay: 3000-6000 ms;
- batch size: 30 pages;
- batch cooldown: 30000-60000 ms.

If faster values are supplied for a scan exceeding 10 pages, the runner
replaces them with these conservative minimums. It does not merely warn.

Recommended full Daily Update command:

```powershell
node scripts/inventory/run-inventory-automation-v1.mjs --source=smokingpipes --mode=daily-update --refresh-list --fetch-new-details --daily-new-max-details=100 --browser-channel=msedge --allow-manual-verification=true --page-warmup-min-ms=1500 --page-warmup-max-ms=3000 --page-delay-min-ms=3000 --page-delay-max-ms=6000 --page-batch-size=30 --page-batch-cooldown-min-ms=30000 --page-batch-cooldown-max-ms=60000 --detail-warmup-min-ms=1000 --detail-warmup-max-ms=3000 --detail-delay-min-ms=3000 --detail-delay-max-ms=8000 --detail-batch-size=50 --detail-batch-cooldown-min-ms=0 --detail-batch-cooldown-max-ms=0 --no-commit --no-deploy --verbose
```

## Short daily-new pacing

Faster pacing is only permitted when `max-pages` is 10 or lower:

```powershell
node scripts/inventory/run-inventory-automation-v1.mjs --source=smokingpipes --mode=daily-update --max-pages=10 --page-warmup-min-ms=500 --page-warmup-max-ms=1500 --page-delay-min-ms=1000 --page-delay-max-ms=3000 --page-batch-size=10 --page-batch-cooldown-min-ms=0 --page-batch-cooldown-max-ms=0 --no-commit --no-deploy --verbose
```

A partial scan cannot generate a full-reconcile candidate or mark disappeared
products sold. Do not use the former daily profile or a fast profile for 107
pages.

## Risk levels

Verification telemetry and Daily reports use the same classification:

- `blocked`: strong verification appeared;
- `high`: average below 6 seconds per page and more than 30 pages requested;
- `low`: at least 100 pages completed at 8 seconds per page or slower with no
  weak or strong signal;
- `medium`: all other observations.

For `blocked`, the next action is: stop access, do not retry immediately, and
use the conservative profile later.

## Detail probe

Detail probe tests only trusted current diff new IDs. The diff must have:

- `allowApply=true`;
- `captchaDetected=false`;
- `fullExpectedRangeScanned=true`;
- no fatal warnings.

It never selects still-available, sold, disappeared, or bulk missing-price
products. If no trusted `newIds` are available, status is
`no-detail-probe-candidates`, no browser starts, and the operation is a no-op.

Recommended first real test, not yet executed:

```powershell
node scripts/inventory/run-inventory-automation-v1.mjs --source=smokingpipes --mode=detail-probe --detail-probe-max=5 --browser-channel=msedge --allow-manual-verification=true --detail-warmup-min-ms=2000 --detail-warmup-max-ms=4000 --detail-delay-min-ms=5000 --detail-delay-max-ms=10000 --detail-batch-size=5 --detail-batch-cooldown-min-ms=30000 --detail-batch-cooldown-max-ms=60000 --no-commit --no-deploy --verbose
```

Outputs are completely isolated:

- `data/inventory/smokingpipes-detail-probe-telemetry.json`
- `data/review/smokingpipes-detail-probe-report.md`

Detail probe never writes the formal queue, daily-next, recent-new, production
products, or production public indexes. Strong verification stops immediately.
A weak signal allows the current parse to finish but stops expansion to later
candidates. Parse failures are recorded once and are not repeatedly retried.

## Detail-probe test ladder

1. First round: maximum 5, delay 5-10 seconds, batch size 5, cooldown 30-60
   seconds.
2. Second round: only after five clean successes; maximum 10, delay 5-10
   seconds, batch size 10, cooldown 30-60 seconds.
3. Third round: only after ten clean successes; maximum 20, optionally delay
   4-8 seconds, never below 4 seconds.

If any round records strong verification, stop and do not enter Daily Update
or fetch additional details.

## Daily candidate safety

Daily candidate output additionally requires:

- all 107 pages completed without strong verification;
- every trusted daily new detail completed or cached;
- public candidate validation passed;
- Daily audit blockers are empty.

Sold products remain in the public catalog as reference products. Recent-new
contains only public-ready, currently sellable daily additions.

## Current rollout order

1. Run the detail-probe ladder manually.
2. Review list and detail telemetry together.
3. Resume controlled Daily Update validation only after detail probes pass.
4. Keep formal apply as a separate manual approval.
5. Do not create or modify a Windows scheduled task yet.
6. Do not enable automatic push.

No mode authorizes proxy rotation, VPN/node switching, anti-detect browsers,
fingerprint spoofing, CAPTCHA bypass, or continued access after strong
verification.

## Progressive partial workflow

The independent Progressive Daily layer is documented in
`docs/smokingpipes-progressive-daily-v1.md`. It checkpoints successful new
details across interrupted runs and builds an additive partial candidate
without weakening the full Daily Update reconciliation gate.

Partial scans still cannot infer disappeared or sold-by-absence. Progressive
partial apply V1 is preview-only and never writes production data.
