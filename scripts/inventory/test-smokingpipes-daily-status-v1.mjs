import assert from "node:assert/strict";
import { deriveSmokingpipesDailyStatus } from "./smokingpipes-daily-status-v1.mjs";
import { buildAutoPublishNotification } from "./smokingpipes-auto-publish-notify-v1.mjs";

const base = {
  productionWritten: false,
  candidateCount: 1760,
  wouldApplyCount: 315,
  appliedCount: 0,
  detailPendingCount: 0,
};

assert.equal(deriveSmokingpipesDailyStatus({ ...base, detailPendingCount: 28 }), "detail-in-progress");
assert.equal(deriveSmokingpipesDailyStatus(base), "ready-to-apply");
assert.equal(
  deriveSmokingpipesDailyStatus({
    ...base,
    status: "no-production-change",
    wouldApplyCount: 3920,
    changeSummary: { actualAppliedCount: 0 },
  }),
  "no-production-change"
);
assert.equal(deriveSmokingpipesDailyStatus({ ...base, productionWritten: true }), "failed");
assert.equal(deriveSmokingpipesDailyStatus({ ...base, productionWritten: true, appliedCount: 315, changeSummary: { actualAppliedCount: 315 } }), "applied");
assert.equal(deriveSmokingpipesDailyStatus({ ...base, productionWritten: true, appliedCount: 315, changeSummary: { actualAppliedCount: 315 }, commitPerformed: true, commitSha: "abc123" }), "committed");
assert.equal(deriveSmokingpipesDailyStatus({ ...base, productionWritten: true, appliedCount: 315, changeSummary: { actualAppliedCount: 315 }, commitPerformed: true, commitSha: "abc123", pushPerformed: true }), "pushed");
assert.equal(deriveSmokingpipesDailyStatus({ ...base, productionWritten: true, appliedCount: 315, changeSummary: { actualAppliedCount: 315 }, commitPerformed: true, commitSha: "abc123", pushPerformed: true, deploymentStatus: "push-complete-deployment-pending-verification" }), "deployment-pending-verification");
assert.equal(deriveSmokingpipesDailyStatus({ ...base, productionWritten: true, appliedCount: 315, changeSummary: { actualAppliedCount: 315 }, commitPerformed: true, commitSha: "abc123", pushPerformed: true, deploymentStatus: "deployment-verified" }), "deployment-verified");

const maxAutoApplyNotification = buildAutoPublishNotification({
  status: "failed",
  candidateCount: 4144,
  wouldApplyCount: 3920,
  maxAutoApply: 2000,
  productionWritten: false,
  failureReason: "effectiveApplyCount 2001 exceeds max auto apply 2000",
  changeSummary: { actualAppliedCount: 2001 },
});
assert.match(maxAutoApplyNotification.body, /实际变更：2001/);
assert.match(maxAutoApplyNotification.body, /自动应用上限：2000/);
assert.doesNotMatch(maxAutoApplyNotification.body, /需要人工验证/);

console.log("smokingpipes daily status tests passed");
