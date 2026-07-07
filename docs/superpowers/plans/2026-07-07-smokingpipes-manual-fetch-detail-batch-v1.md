# Smokingpipes Manual Full Reconcile FetchDetailBatch V1 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first online phase of Manual Full Reconcile V1: a capped, manual-only detail batch fetch that processes only the current first pending batch and never writes production.

**Architecture:** Keep the Manual Full Reconcile orchestration separate from daily update. The PowerShell wrapper dispatches a new core mode (`fetch-detail-batch`) and the MJS core uses the existing progressive detail chunk state machine with a manual reconcile detail processor, then writes a dedicated batch report.

**Tech Stack:** Node.js ESM scripts, PowerShell wrapper, existing Playwright-based Smokingpipes utilities, existing progressive state schema.

## Global Constraints

- Do not run daily task.
- Do not refresh current-list or scan 107 pages.
- Do not write production or public catalog.
- DetailMax is capped at 30.
- Use Chrome profile sp-chrome for real detail batch.
- Tests must cover no daily task, no snapshot refresh, no production write, cap, deferred/review-only exclusion, verification stop, report fields, and readable mobile report.

---

### Task 1: Add failing tests for Manual FetchDetailBatch

**Files:**
- Modify: `scripts/inventory/test-inventory-runner-v1.mjs`

- [ ] Add tests importing new manual detail batch helpers.
- [ ] Verify pending-only batch selection, DetailMax cap, blocked preservation, report fields, and mobile report wording.
- [ ] Run `node scripts/inventory/test-inventory-runner-v1.mjs` and confirm failure because helpers/mode are missing.

### Task 2: Implement MJS fetch-detail-batch mode

**Files:**
- Modify: `scripts/inventory/smokingpipes-manual-full-reconcile-v1.mjs`

- [ ] Add `fetch-detail-batch` CLI mode.
- [ ] Read existing manual progressive state only; do not read current-list/diff for this mode.
- [ ] Select only `detailStatus=pending` and `queueDisposition=eligible-this-batch` candidates, capped at 30.
- [ ] Use existing progressive detail chunk semantics with a manual detail processor.
- [ ] Write `data/review/smokingpipes-manual-full-reconcile-detail-batch-report.json/md`.
- [ ] Keep `productionWritten=false`.

### Task 3: Enable PowerShell wrapper FetchDetailBatch

**Files:**
- Modify: `scripts/inventory/run-smokingpipes-manual-full-reconcile-v1.ps1`

- [ ] Stop rejecting `-FetchDetailBatch`.
- [ ] Dispatch `--mode=fetch-detail-batch --browser-channel=chrome --browser-profile=sp-chrome --allow-manual-verification=true`.
- [ ] Continue rejecting `RefreshSnapshot`, `ApplySafeSubset`, and `WriteProduction`.
- [ ] Ensure the wrapper does not call daily task.

### Task 4: Update mobile report wording

**Files:**
- Modify: `scripts/inventory/smokingpipes-daily-mobile-report-v1.mjs`

- [ ] For manual detail batch, show detail batch progress and production write = 否.
- [ ] For verification, show object/location/browser/page and rerun instruction.

### Task 5: Verify

**Commands:**
- `node --check scripts/inventory/smokingpipes-manual-full-reconcile-v1.mjs`
- PowerShell syntax check for wrapper
- `node scripts/inventory/test-inventory-runner-v1.mjs`
- `npm.cmd run build`
- `git status --short`
- `git diff --stat`
