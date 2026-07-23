function text(value) {
  return String(value || "").trim();
}

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getActualAppliedCount(report = {}) {
  const summary = report.changeSummary && typeof report.changeSummary === "object"
    ? report.changeSummary
    : {};
  if (summary.actualAppliedCount !== undefined && summary.actualAppliedCount !== null) {
    return count(summary.actualAppliedCount);
  }
  if (report.actualAppliedCount !== undefined && report.actualAppliedCount !== null) {
    return count(report.actualAppliedCount);
  }
  return count(report.appliedCount);
}

export function deriveSmokingpipesDailyStatus(report = {}) {
  const pending = count(report.detailPendingCount ?? report.detailPending);
  const status = text(report.status);
  const actualAppliedCount = getActualAppliedCount(report);

  if (pending > 0 || status === "detail-progress" || status === "detail-in-progress") {
    return "detail-in-progress";
  }
  if (status === "no-production-change") return "no-production-change";
  if (status === "failed" || status.endsWith("-failed") || status === "terminal-failed") {
    return "failed";
  }
  if (!report.productionWritten) {
    if (status === "detail-complete") return "detail-complete";
    return "ready-to-apply";
  }
  if (actualAppliedCount <= 0 || actualAppliedCount !== count(report.appliedCount)) {
    return "failed";
  }
  if (!report.commitPerformed) return "applied";
  if (!text(report.commitSha)) return "failed";
  if (!report.pushPerformed) return "committed";
  if (!text(report.deploymentStatus) || report.deploymentStatus === "not-started") return "pushed";
  if (report.deploymentStatus === "deployment-verified") return "deployment-verified";
  return "deployment-pending-verification";
}
