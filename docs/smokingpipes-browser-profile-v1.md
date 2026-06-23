# Smokingpipes Browser Profile V1

## Purpose

This mode compares the existing Edge/Chromium runtime with a dedicated local
Chrome persistent profile. A persistent profile can retain normal browser
session state after a user manually completes Smokingpipes verification.

It does not bypass CAPTCHA. It does not use proxy rotation, VPN/node switching,
anti-detect browsers, stealth plugins, or fingerprint spoofing.

## Profile selection

Profile priority:

1. `--browser-profile-dir="..."`.
2. `--browser-profile=sp-chrome`.
3. `--browser-channel=chrome` without a profile option.
4. Edge/Chromium keep the existing project-local
   `.cache/smokingpipes-profile`.

On Windows, `sp-chrome` resolves to:

```text
%LOCALAPPDATA%\YandouBuy\chrome-profile-sp
```

For the current Windows account this is normally:

```text
C:\Users\NING MEI\AppData\Local\YandouBuy\chrome-profile-sp
```

Do not use the daily Chrome profile:

```text
%LOCALAPPDATA%\Google\Chrome\User Data
%LOCALAPPDATA%\Google\Chrome\User Data\Default
```

The runner rejects the entire daily Chrome `User Data` tree. This avoids
profile locking, accidental access to unrelated browser data, and damage to
the user's normal Chrome profile.

## Profile lock

Chrome uses an independent lock:

```text
data/inventory/state/smokingpipes-chrome-profile.lock
```

Only one inventory process may use the dedicated Chrome profile. A lock whose
owning PID is no longer running is identified as stale and replaced. A live or
unreadable lock blocks safely.

The runner never kills Chrome and never deletes the profile. If Chrome itself
already owns the profile, close that dedicated Chrome window manually and run
the command again.

## Browser preflight

Offline test:

```powershell
node scripts/inventory/run-inventory-automation-v1.mjs --source=smokingpipes --mode=browser-preflight --mock --browser-channel=chrome --browser-profile=sp-chrome --verbose
```

Real preflight:

```powershell
node scripts/inventory/run-inventory-automation-v1.mjs --source=smokingpipes --mode=browser-preflight --browser-channel=chrome --browser-profile=sp-chrome --allow-manual-verification=true --no-commit --no-deploy --verbose
```

Real preflight opens only the lightweight Smokingpipes home page. It does not
scan list pages, parse product inventory, generate a diff, create a details
queue, or write candidate/production data.

If preflight sees strong verification it reports `blocked`. Preflight does not
claim product-page recovery because it deliberately does not parse products.
Use verification-probe or detail-probe to verify manual recovery against
normal product content.

Outputs:

```text
data/inventory/smokingpipes-browser-profile-state.json
data/review/smokingpipes-browser-profile-report.md
```

## Verification probe with Chrome

```powershell
node scripts/inventory/run-inventory-automation-v1.mjs --source=smokingpipes --mode=verification-probe --refresh-list --max-pages=107 --browser-channel=chrome --browser-profile=sp-chrome --allow-manual-verification=true --no-commit --no-deploy --verbose
```

The full 107-page pacing safety rules still apply. A strong verification page
pauses for manual handling only when manual verification is explicitly
allowed. The wait is bounded by `--manual-verification-timeout-ms`.

Recovery is accepted only after the requested list page parses at least one
valid product card. Merely removing a verification keyword or returning to a
generic page is not enough.

## Detail probe with Chrome

```powershell
node scripts/inventory/run-inventory-automation-v1.mjs --source=smokingpipes --mode=detail-probe --detail-probe-max=5 --browser-channel=chrome --browser-profile=sp-chrome --allow-manual-verification=true --detail-warmup-min-ms=3000 --detail-warmup-max-ms=5000 --detail-delay-min-ms=8000 --detail-delay-max-ms=15000 --detail-batch-size=3 --detail-batch-cooldown-min-ms=60000 --detail-batch-cooldown-max-ms=120000 --no-commit --no-deploy --verbose
```

Detail-probe still uses only trusted `diff.newIds`. If there are no trusted
candidates it is a no-op and does not start Chrome.

After manual verification, recovery is accepted only when the requested
product detail parses successfully and its `sourceProductId` exactly matches
the candidate. A mismatch or timeout blocks the run.

## Reporting

Browser reports and probe telemetry record:

- requested and effective browser channel;
- requested profile name/directory;
- effective profile directory and source;
- persistent-context status;
- executable path when available;
- whether the profile directory was created;
- whether manual verification was allowed and recovered.

These fields make Edge ephemeral/default behavior and Chrome persistent
profile behavior directly comparable without changing production data.
