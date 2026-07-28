import assert from "node:assert/strict";
import {
  EFFECTIVE_APPLY_GENERATOR_MODULE,
  EFFECTIVE_APPLY_SCHEMA_VERSION,
  evaluateProgressiveProductionApplyGate,
  validateEffectiveApplyArtifacts,
} from "./smokingpipes-progressive-runner-v1.mjs";

const runId = "runtime-artifact-consistency-fixture";
const codeCommitSha = "fixture-current-head";
const shared = {
  schemaVersion: EFFECTIVE_APPLY_SCHEMA_VERSION,
  codeCommitSha,
  generatorModule: EFFECTIVE_APPLY_GENERATOR_MODULE,
  runId,
  generatedAt: "2026-07-28T14:30:01.000Z",
  effectiveApplyCount: 315,
  effectiveApplyConsistency: { valid: true, appliedCandidateIds: [] },
};
const preview = {
  ...shared,
  status: "preview-ready",
  candidateCount: 4144,
  wouldApplyCount: 3920,
  wouldApplyProductIds: ["fixture-1"],
  appliedCandidateIds: [],
  fieldChanges: [],
  productionWritten: false,
};
const gate = { ...shared, applyReady: true };

assert.deepEqual(
  validateEffectiveApplyArtifacts({
    preview,
    gateReport: gate,
    runId,
    codeCommitSha,
    invocationStartedAt: "2026-07-28T14:30:00.000Z",
  }),
  { valid: true, blockers: [] }
);

for (const artifact of [
  { ...preview, schemaVersion: "legacy-preview-v1" },
  { ...preview, runId: "stale-run" },
  { ...preview, codeCommitSha: "stale-head" },
]) {
  const validation = validateEffectiveApplyArtifacts({
    preview: artifact,
    gateReport: gate,
    runId,
    codeCommitSha,
    invocationStartedAt: "2026-07-28T14:30:00.000Z",
  });
  assert.equal(validation.valid, false);
}

const effectiveGate = evaluateProgressiveProductionApplyGate({
  state: { dailyRunId: "daily-update-fixture", candidates: [] },
  audit: {
    verdict: "PASS",
    candidateCount: 4144,
    wouldApplyCount: 3920,
    blockers: [],
    counts: {
      deletedProducts: 0,
      pendingLeak: 0,
      failedLeak: 0,
      blockedLeak: 0,
      reviewOnlyLeak: 0,
      zeroPriceSellable: 0,
    },
    applyGap: {
      gapCount: 224,
      unknownGapCount: 0,
      readyUnexpectedlyExcludedCount: 0,
      safeToApplyWouldApplySubset: true,
    },
  },
  preview,
  candidateProducts: [{ sourceProductId: "fixture-1" }],
  publicPayloads: {
    catalog: { products: [] },
    filters: {},
    brands: {},
    recentNew: { products: [] },
    lookup: {},
    manifest: {},
    detailShards: [],
  },
  maxAutoApply: 2000,
});
assert.equal(effectiveGate.applyReady, true);
assert.equal(effectiveGate.effectiveApplyCount, 315);
assert.equal(effectiveGate.largeApplyWarning, true);
assert.equal(effectiveGate.largeApplyBlocked, false);
assert.equal(
  effectiveGate.blockers.some((reason) =>
    reason.includes("wouldApplyCount 3920 exceeds")
  ),
  false
);

console.log("Smokingpipes runtime artifact consistency tests passed.");
