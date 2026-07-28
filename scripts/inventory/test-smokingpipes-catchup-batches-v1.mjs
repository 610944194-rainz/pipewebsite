import assert from "node:assert/strict";
import {
  createSmokingpipesCatchupPlan,
  selectSmokingpipesCatchupBatch,
  stableProductHash,
} from "./smokingpipes-actionable-events-v1.mjs";
import {
  evaluateProgressiveProductionApplyGate,
} from "./smokingpipes-progressive-runner-v1.mjs";

function product(id) {
  return {
    id: `smokingpipes-${id}`,
    source: "smokingpipes",
    sourceProductId: String(id),
    title: `Pipe ${id}`,
    inventoryStatus: "available",
    price: { current: { amount: Number(id) } },
  };
}

function fixturePlan(count = 2400) {
  const productionProducts = Array.from({ length: count }, (_, index) =>
    product(index + 1)
  );
  const items = productionProducts.map((before, index) => {
    const actionType = index < 600
      ? "explicit-out-of-stock"
      : index < 1200
        ? "reappeared"
        : index < 1800
          ? "confirmed-disappeared"
          : "price-change";
    const desired = {
      ...before,
      inventoryStatus:
        actionType === "explicit-out-of-stock" ||
        actionType === "confirmed-disappeared"
          ? "sold"
          : "available",
      price: {
        current: { amount: Number(before.sourceProductId) + 0.5 },
      },
    };
    return {
      event: {
        eventId: `event-${String(index + 1).padStart(4, "0")}`,
        sourceProductId: before.sourceProductId,
        changeType: actionType,
        status: "pending",
        baselineProductHash: stableProductHash(before),
        desiredProductHash: stableProductHash(desired),
      },
      production: before,
      desired,
      candidate: { sourceProductId: before.sourceProductId },
      fields: ["inventoryStatus"],
    };
  });
  return {
    productionProducts,
    actionablePlan: {
      schemaVersion: "smokingpipes-action-event-v1",
      sourceSnapshotHash: "source-snapshot-hash",
      items,
      isolated: [],
      superseded: [],
    },
  };
}

const { productionProducts, actionablePlan } = fixturePlan();
const plan = createSmokingpipesCatchupPlan({
  actionablePlan,
  productionProducts,
  runId: "first-run",
  codeCommitSha: "a".repeat(40),
  createdAt: "2026-07-29T00:00:00.000Z",
});
const repeat = createSmokingpipesCatchupPlan({
  actionablePlan,
  productionProducts,
  runId: "second-run",
  codeCommitSha: "a".repeat(40),
  createdAt: "2026-07-29T00:00:01.000Z",
});

assert.equal(plan.totalEventCount, 2400);
assert.equal(plan.batchLimit, 2000);
assert.equal(plan.batches.length, 2);
assert.equal(plan.batches[0].eventIds.length, 2000);
assert.equal(plan.batches[1].eventIds.length, 400);
assert.equal(plan.batches[0].expectedEffectiveApplyCount, 2000);
assert.equal(plan.batches[1].expectedEffectiveApplyCount, 400);
assert.equal(plan.planId, repeat.planId, "plan identity must not depend on runId");
assert.deepEqual(plan.batches, repeat.batches, "batch ordering must be deterministic");

const selected = selectSmokingpipesCatchupBatch({
  actionablePlan,
  plan,
  batchNumber: 1,
  planId: plan.planId,
  batchHash: plan.batches[0].batchHash,
  codeCommitSha: "a".repeat(40),
  productionProducts,
});
assert.equal(selected.valid, true);
assert.equal(selected.actionablePlan.items.length, 2000);
assert.equal(
  selected.actionablePlan.items.some((item) =>
    plan.batches[1].eventIds.includes(item.event.eventId)
  ),
  false,
  "batch 2 events must not enter batch 1 selection"
);

for (const [label, options] of [
  ["wrong plan", { planId: "wrong" }],
  ["wrong batch hash", { batchHash: "wrong" }],
  ["wrong code", { codeCommitSha: "b".repeat(40) }],
  ["changed production", { productionProducts: [{ ...productionProducts[0], title: "changed" }, ...productionProducts.slice(1)] }],
  ["changed source", { actionablePlan: { ...actionablePlan, sourceSnapshotHash: "changed" } }],
]) {
  const result = selectSmokingpipesCatchupBatch({
    actionablePlan,
    plan,
    batchNumber: 1,
    planId: plan.planId,
    batchHash: plan.batches[0].batchHash,
    codeCommitSha: "a".repeat(40),
    productionProducts,
    ...options,
  });
  assert.equal(result.valid, false, `${label} must fail closed`);
}

const appliedPlan = structuredClone(actionablePlan);
appliedPlan.items[0].event.status = "applied";
assert.equal(
  selectSmokingpipesCatchupBatch({
    actionablePlan: appliedPlan,
    plan,
    batchNumber: 1,
    planId: plan.planId,
    batchHash: plan.batches[0].batchHash,
    codeCommitSha: "a".repeat(40),
    productionProducts,
  }).valid,
  false,
  "already applied events must not re-enter a catch-up batch"
);

function evaluateLimit(count) {
  const ids = Array.from({ length: count }, (_, index) => String(index + 1));
  const products = ids.map((id) => product(id));
  return evaluateProgressiveProductionApplyGate({
    state: { candidates: [] },
    audit: {
      verdict: "PASS",
      blockers: [],
      counts: {},
      candidateCount: count,
      wouldApplyCount: count,
    },
    preview: {
      candidateCount: count,
      wouldApplyCount: count,
      wouldApplyProductIds: ids,
      effectiveApplyCount: count,
      effectiveApplyConsistency: { valid: true, appliedCandidateIds: ids },
      appliedEventIds: ids.map((id) => `event-${id}`),
      status: "preview-ready",
      productionWritten: false,
    },
    candidateProducts: products,
    publicPayloads: {
      catalog: products,
      brands: {},
      details: {},
      lookup: {},
      recentNew: {},
      manifest: {},
    },
    maxAutoApply: 2000,
  });
}

assert.equal(evaluateLimit(2000).largeApplyBlocked, false);
const overLimit = evaluateLimit(2001);
assert.equal(overLimit.largeApplyBlocked, true);
assert.equal(overLimit.failureType, "catchup-required");
assert.equal(overLimit.requiresManualVerification, false);

process.stdout.write("Smokingpipes catch-up batches: PASS\n");
