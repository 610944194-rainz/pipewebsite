# Smokingpipes Manual Full Reconcile V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an offline-first, manually controlled Smokingpipes reconciliation planner and progressive-state rebuilder that never fetches or writes production by default.

**Architecture:** A pure ESM core reads an existing complete current-list snapshot, authoritative diff, production products, and progressive state; it produces an action plan and a rebuilt state without network access. A standalone PowerShell wrapper exposes `PlanOnly` and `RebuildState`, reserves explicit switches for later network/apply phases, and blocks those reserved phases in this offline release.

**Tech Stack:** Node.js ESM, PowerShell, existing inventory atomic-write/state helpers, existing inventory runner test harness.

---

### Task 1: Add failing planner and rebuild tests

**Files:**
- Modify: `scripts/inventory/test-inventory-runner-v1.mjs`

- [ ] Add an import for `buildSmokingpipesManualFullReconcilePlan` and `rebuildSmokingpipesProgressiveState`.
- [ ] Add a synthetic complete snapshot with more than 30 valid new products, review-only new products, a sitewide 15% promotion, explicit out-of-stock, reappeared, disappeared, and no-op products.
- [ ] Assert the first batch contains at most 30 IDs, remaining valid products are deferred/queued-later, review-only products are isolated, promotion changes do not request detail, and disappeared apply remains disabled.
- [ ] Assert rebuilding preserves existing complete detail/convertedProduct values and regenerates summary counts.
- [ ] Run `node scripts/inventory/test-inventory-runner-v1.mjs` and verify it fails because the core module does not exist.

### Task 2: Implement the pure manual-reconcile core

**Files:**
- Create: `scripts/inventory/smokingpipes-manual-full-reconcile-v1.mjs`

- [ ] Implement strict local JSON reads and snapshot trust validation: 107/107, complete range, no CAPTCHA/verification, unique IDs.
- [ ] Build authoritative classifications for new-product, price-change, explicit-out-of-stock, reappeared, disappeared, no-op, and unknown.
- [ ] Triage new products into eligibleForDetail, lowPriority, missingPrice, missingImage, brandNeedsReview, suspectedDuplicate, and reviewOnly.
- [ ] Detect a broad promotion only when a dominant rounded price ratio has at least 100 products and at least 50% of price changes; promotion rows never enter the detail queue.
- [ ] Build a maximum-30 first detail batch and mark the remainder queued-later.
- [ ] Rebuild progressive state while preserving valid complete detail/convertedProduct data, setting only the first batch pending, setting later valid products deferred, and setting invalid products review-only.
- [ ] Record disappeared IDs with `applyAllowed=false`.
- [ ] Write UTF-8 JSON and BOM Markdown plan/rebuild reports. Do not write production.
- [ ] Run the test and verify the new planner/rebuilder assertions pass.

### Task 3: Extend progressive state schema safely

**Files:**
- Modify: `scripts/inventory/smokingpipes-progressive-state-v1.mjs`
- Modify: `scripts/inventory/smokingpipes-progressive-daily-v1.mjs`
- Test: `scripts/inventory/test-inventory-runner-v1.mjs`

- [ ] Add a failing assertion that a rebuilt candidate with `detailStatus=deferred` and `queueDisposition=queued-later` validates.
- [ ] Add `deferred` to allowed detail statuses and validate optional queue disposition values.
- [ ] Add deferred counts to progressive summaries; ensure detail selection still chooses only pending candidates.
- [ ] Run the inventory test and verify it passes.

### Task 4: Add the standalone PowerShell entry

**Files:**
- Create: `scripts/inventory/run-smokingpipes-manual-full-reconcile-v1.ps1`
- Test: `scripts/inventory/test-inventory-runner-v1.mjs`

- [ ] Add static failing assertions for default PlanOnly, explicit RebuildState, `DetailMax` capped at 30, and reserved network/apply switches.
- [ ] Implement default PlanOnly using only local snapshot/diff/production/state paths.
- [ ] Implement RebuildState by copying the current state to a timestamped backup before invoking the offline rebuild.
- [ ] Accept `RefreshSnapshot`, `FetchDetailBatch`, `ApplySafeSubset`, and `WriteProduction` only as explicit parameters; reject them in this offline release before launching Node/browser/network work.
- [ ] Reject `WriteProduction` unless `ApplySafeSubset` is also present, then reject the offline release regardless.
- [ ] Run PowerShell syntax validation and inventory tests.

### Task 5: Distinguish manual reconcile in mobile reporting

**Files:**
- Modify: `scripts/inventory/smokingpipes-daily-mobile-report-v1.mjs`
- Test: `scripts/inventory/test-inventory-runner-v1.mjs`

- [ ] Add a failing mobile-report test for `runMode=manual-full-reconcile`.
- [ ] Render “人工全量对齐进行中”, snapshot pages, current batch/total details, applied count, and the explanation that this is not daily automation.
- [ ] Preserve existing verification instructions for computer, Chrome `sp-chrome`, and list/detail page.
- [ ] Run inventory tests.

### Task 6: Generate real offline plan and rebuild state

**Files generated locally:**
- `data/review/smokingpipes-manual-full-reconcile-plan.json`
- `data/review/smokingpipes-manual-full-reconcile-plan.md`
- `data/review/smokingpipes-progressive-state-rebuild-report.json`
- `data/review/smokingpipes-progressive-state-rebuild-report.md`
- `data/backups/<timestamp>-smokingpipes-manual-full-reconcile-state/`
- `data/inventory/smokingpipes-progressive-daily-state.json`

- [ ] Run the wrapper with its default PlanOnly mode.
- [ ] Inspect counts and confirm allowDetailFetch/apply/dailyResume gates.
- [ ] Run the wrapper with `-RebuildState`.
- [ ] Confirm a state backup exists before the rebuilt state write.
- [ ] Confirm no production/public catalog hash changed.

### Task 7: Final verification

- [ ] Run `node --check scripts/inventory/smokingpipes-manual-full-reconcile-v1.mjs`.
- [ ] Run PowerShell syntax validation for the wrapper.
- [ ] Run `node scripts/inventory/test-inventory-runner-v1.mjs`.
- [ ] Run `npm.cmd run build`.
- [ ] Run protected-path Git checks, `git diff --stat`, and `git status --short`.
- [ ] Do not stage, commit, push, access Smokingpipes, fetch details, run the daily task, or write production.
