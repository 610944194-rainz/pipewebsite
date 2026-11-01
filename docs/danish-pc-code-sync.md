# Danish PC daily code synchronization

## What was already present

PC scheduling is independent of GitHub hosting. Pushing `main` does not immediately
update the PC. `scripts/run-danish-auto-publish.ps1 -Publish` / `-Daily` already
fetched origin and merged `origin/main` with `--ff-only` before starting Node.
The existing code could continue using cached code after three fetch failures.
A task calling Node directly bypasses this wrapper entirely. Cloud inspection
cannot confirm the actual PC task configuration or that it has pulled a commit.

## Changes

- All live wrapper modes (`Publish`, `Daily`, `CollectOnly`) now sync first.
  DryRun remains offline and does not fetch or publish.
- By default, three unsuccessful fetch attempts stop the run and use the existing
  startup-failure notification path; stale code is not silently used.
- An explicit `-AllowCachedCode` preserves the old degraded operation for someone
  choosing availability over a verified current GitHub revision. This mode does
  not guarantee the latest code and is not the recommended scheduled setting.
- Clean tracked files, `main`, ff-only and HEAD equality checks remain required.
  No reset, clean, forced checkout, automatic stash or automatic commit is added.
- `git-sync-completed` logs revision, remote revision, degraded state and actual
  fetch attempts. `node-started` records the code revision used by the collector.
  `git-sync-failed` explains why no collection was started.
- Existing PushDeer notification, ShadowBot startup, publish destination, shutdown
  option and daily schedule are preserved. No PC scheduled task was modified here.

## One-time PC adoption, after the changes have been pushed to main

Open PowerShell in the existing automation checkout on the PC:

```powershell
git branch --show-current
git status --short
git pull --ff-only origin main
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\inventory\test-danish-pc-update-setup-v1.ps1
```

If the branch is not main, tracked files are modified, or Git reports divergence,
stop and resolve those changes; do not reset or delete them. Run the commands as
the same Windows user as the scheduled task, with that user's GitHub credentials.

The last command is read-only. It reports the actual task actions, checkout,
revision, branch and whether strict synchronization is configured. It neither
starts collection nor changes schedule, notification, power settings or tasks.
For a custom task name supply `-TaskName 'your existing task name'`.

A correct task action uses an absolute PowerShell executable and:

```text
-NoProfile -ExecutionPolicy Bypass -File "<existing checkout>\scripts\run-danish-auto-publish.ps1" -Publish
```

Keep the actual existing live mode (`-Publish`, `-Daily` or `-CollectOnly`) and
other arguments such as `-ShutdownAfterRun`, run time, task principal and trigger.
If the diagnostic reports a direct Node action or another checkout, edit **only
the existing task's action** to use the corresponding absolute wrapper path.
Do not create a second daily task. A direct invocation of the Node runner does
not promise code synchronization.

The first pull installs the improved wrapper and the new storefront adapter.
Subsequent scheduled runs fetch the latest main automatically. Changes to the
PowerShell wrapper itself load fully on the next process invocation; the child
Node collector and adapter files are loaded after the current run's Git sync.
No package manifests changed, so this update needs no npm dependency change.

## Verification on PC

At the next run check `data/inventory/state/danish-scheduler-launch.log`:
`git-sync-completed` must have `gitSyncDegraded=false` and matching `head` /
`cachedOriginMain`. `node-started` must record the same revision. Compare it to
the pushed commit. A successful fetch tests actual GitHub availability for that
run; the read-only setup diagnostic does not test connectivity or perform fetch.

## Source-side verification

During the 2026-11-01 cloud test, the complete 22-page / 2,081-product list and
three detail samples did not encounter CAPTCHA or manual robot verification.
Age confirmation and welcome/consent overlays are present; extraction reads the
rendered catalogue and does not submit purchases, logins, or age assertions.
PC network, region and saved profile may still produce a challenge.

The existing visible-browser verification handoff now recognizes both exact
Danish .com/.cn hosts and modern cards. Modern pagination calls the existing
verification recovery before parsing each page. A timeout fails collection
rather than marking an incomplete list as complete. Regression mocks verify
recovery on .cn, but no live CAPTCHA was available to test end-to-end on the PC.

## Follow-up: evaluate moving Danish collection to a server

Owner direction (2026-11-01): if the next complete PC daily run also encounters no
manual verification, evaluate server-hosted collection instead of depending on
the PC. This is a migration candidate, not evidence that all source-side checks
have been removed and not an instruction to disable the PC scheduler now.

Review that run's list integrity, resolved detail queue, publish result and
verification events first. Then run collect-only trials from the intended server
network, including cold browser profiles and repeated scheduled runs. Confirm
headless browser support, timeouts, checkpoints, locking, failure notification,
and the existing delivery/publish interface before switching production.

The present collector still launches local Windows Chrome and the PC wrapper
requires ShadowBot; copying it into a server cron job will not work unchanged.
A server adapter must remove those mandatory Windows/ShadowBot dependencies,
fail safely on challenges, and keep PC fallback until the server trials pass.
Only one production scheduler should be enabled after cutover to avoid duplicate
collection/publication. No server deployment or schedule change was performed
as part of this repair.
