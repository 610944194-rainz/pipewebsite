import assert from "node:assert/strict";
import { deriveSmokingpipesDailyStatus } from "./smokingpipes-daily-status-v1.mjs";

const base = {
  productionWritten: false,
  candidateCount: 1760,
  wouldApplyCount: 315,
  appliedCount: 0,
  detailPendingCount: 0,
};

assert.equal(deriveSmokingpipesDailyStatus({ ...base, detailPendingCount: 28 }), "detail-in-progress");
assert.equal(deriveSmokingpipesDailyStatus(base), "ready-to-apply");
assert.equal(deriveSmokingpipesDailyStatus({ ...base, productionWritten: true }), "failed");
assert.equal(deriveSmokingpipesDailyStatus({ ...base, productionWritten: true, appliedCount: 315, changeSummary: { actualAppliedCount: 315 } }), "applied");
assert.equal(deriveSmokingpipesDailyStatus({ ...base, productionWritten: true, appliedCount: 315, changeSummary: { actualAppliedCount: 315 }, commitPerformed: true, commitSha: "abc123" }), "committed");
assert.equal(deriveSmokingpipesDailyStatus({ ...base, productionWritten: true, appliedCount: 315, changeSummary: { actualAppliedCount: 315 }, commitPerformed: true, commitSha: "abc123", pushPerformed: true }), "pushed");
assert.equal(deriveSmokingpipesDailyStatus({ ...base, productionWritten: true, appliedCount: 315, changeSummary: { actualAppliedCount: 315 }, commitPerformed: true, commitSha: "abc123", pushPerformed: true, deploymentStatus: "push-complete-deployment-pending-verification" }), "deployment-pending-verification");
assert.equal(deriveSmokingpipesDailyStatus({ ...base, productionWritten: true, appliedCount: 315, changeSummary: { actualAppliedCount: 315 }, commitPerformed: true, commitSha: "abc123", pushPerformed: true, deploymentStatus: "deployment-verified" }), "deployment-verified");

console.log("smokingpipes daily status tests passed");
