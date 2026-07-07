import fs from "node:fs";
import {
  writeJsonAtomic,
} from "./inventory-runner-core-v1.mjs";

export const PROGRESSIVE_STATE_VERSION =
  "smokingpipes-progressive-daily-state-v1";

const LIST_STATUSES = new Set([
  "complete",
  "partial",
  "blocked",
]);
const DETAIL_STATUSES = new Set([
  "pending",
  "deferred",
  "complete",
  "failed",
  "blocked",
  "review-only",
]);
const QUEUE_DISPOSITIONS = new Set([
  "eligible-this-batch",
  "queued-later",
  "review-only",
  "no-detail-required",
]);
const PUBLIC_STATUSES = new Set([
  "not-public",
  "ready",
  "published",
  "review-only",
]);
const CHANGE_TYPES = new Set([
  "new-product",
  "price-change",
  "explicit-out-of-stock",
  "reappeared",
]);

function isIsoOrNull(value) {
  return (
    value === null ||
    (typeof value === "string" &&
      Number.isFinite(Date.parse(value)))
  );
}

function candidateErrors(candidate, index) {
  const errors = [];
  const prefix = `candidates[${index}]`;
  if (!String(candidate?.sourceProductId || "").trim()) {
    errors.push(`${prefix}.sourceProductId is required`);
  }
  if (!isIsoOrNull(candidate?.lastSeenAt ?? null)) {
    errors.push(`${prefix}.lastSeenAt is invalid`);
  }
  for (const field of ["firstSeenRunId", "lastSeenRunId"]) {
    if (!String(candidate?.[field] || "").trim()) {
      errors.push(`${prefix}.${field} is required`);
    }
  }
  if (!DETAIL_STATUSES.has(candidate?.detailStatus)) {
    errors.push(`${prefix}.detailStatus is invalid`);
  }
  if (
    candidate?.queueDisposition !== undefined &&
    !QUEUE_DISPOSITIONS.has(candidate.queueDisposition)
  ) {
    errors.push(`${prefix}.queueDisposition is invalid`);
  }
  if (!PUBLIC_STATUSES.has(candidate?.publicStatus)) {
    errors.push(`${prefix}.publicStatus is invalid`);
  }
  if (
    !Array.isArray(candidate?.changeTypes) ||
    candidate.changeTypes.some((item) => !CHANGE_TYPES.has(item))
  ) {
    errors.push(`${prefix}.changeTypes is invalid`);
  }
  for (const field of [
    "detailAttempts",
    "retryCount",
    "blockedCount",
  ]) {
    if (
      !Number.isInteger(candidate?.[field]) ||
      candidate[field] < 0
    ) {
      errors.push(`${prefix}.${field} is invalid`);
    }
  }
  if (
    !Number.isFinite(Number(candidate?.priority)) ||
    Number(candidate.priority) < 0
  ) {
    errors.push(`${prefix}.priority is invalid`);
  }
  for (const field of [
    "discoveredAt",
    "lastAttemptAt",
    "lastBlockedAt",
    "nextEligibleAt",
    "lastAppliedAt",
  ]) {
    if (!isIsoOrNull(candidate?.[field] ?? null)) {
      errors.push(`${prefix}.${field} is invalid`);
    }
  }
  return errors;
}

export function createProgressiveDailyState({
  dailyRunId,
  expectedPages = 107,
  now = new Date().toISOString(),
} = {}) {
  return {
    version: PROGRESSIVE_STATE_VERSION,
    schema: PROGRESSIVE_STATE_VERSION,
    source: "smokingpipes",
    dailyRunId:
      String(dailyRunId || "").trim() ||
      `progressive-${Date.now()}`,
    createdAt: now,
    updatedAt: now,
    listSnapshotStatus: "partial",
    pagesScanned: 0,
    expectedPages,
    fullExpectedRangeScanned: false,
    captchaDetected: false,
    verificationDetected: false,
    blockedAt: null,
    blockedPage: null,
    blockedReason: null,
    currentListPath: null,
    diffPath: null,
    globalReconcile: {
      allowed: false,
      applyAllowed: false,
      disappearedIds: [],
    },
    candidates: [],
    summary: {
      totalCandidates: 0,
      newProductCandidates: 0,
      priceChangeCandidates: 0,
      explicitOutOfStockCandidates: 0,
      reappearedCandidates: 0,
      disappearedCandidatesRecorded: 0,
      disappearedCandidatesApplyAllowed: false,
      pending: 0,
      deferred: 0,
      complete: 0,
      failed: 0,
      blocked: 0,
      readyForDetailChunk: 0,
    },
    latestRun: null,
    candidateBuild: null,
    partialApplyPreview: null,
    productionWritten: false,
  };
}

export function validateProgressiveDailyState(state) {
  const errors = [];
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    errors.push("state must be an object");
  } else {
    if (state.version !== PROGRESSIVE_STATE_VERSION) {
      errors.push(`unsupported schema version: ${state.version}`);
    }
    if (state.schema !== PROGRESSIVE_STATE_VERSION) {
      errors.push(`unsupported schema: ${state.schema}`);
    }
    if (state.source !== "smokingpipes") {
      errors.push("source must be smokingpipes");
    }
    if (!String(state.dailyRunId || "").trim()) {
      errors.push("dailyRunId is required");
    }
    if (!isIsoOrNull(state.createdAt)) {
      errors.push("createdAt is invalid");
    }
    if (!isIsoOrNull(state.updatedAt)) {
      errors.push("updatedAt is invalid");
    }
    if (!LIST_STATUSES.has(state.listSnapshotStatus)) {
      errors.push("listSnapshotStatus is invalid");
    }
    if (
      !Number.isInteger(state.pagesScanned) ||
      state.pagesScanned < 0
    ) {
      errors.push("pagesScanned is invalid");
    }
    if (
      !Number.isInteger(state.expectedPages) ||
      state.expectedPages <= 0
    ) {
      errors.push("expectedPages is invalid");
    }
    if (typeof state.fullExpectedRangeScanned !== "boolean") {
      errors.push("fullExpectedRangeScanned is invalid");
    }
    if (typeof state.captchaDetected !== "boolean") {
      errors.push("captchaDetected is invalid");
    }
    if (typeof state.verificationDetected !== "boolean") {
      errors.push("verificationDetected is invalid");
    }
    if (!Array.isArray(state.candidates)) {
      errors.push("candidates must be an array");
    } else {
      const seen = new Set();
      state.candidates.forEach((candidate, index) => {
        errors.push(...candidateErrors(candidate, index));
        const id = String(candidate?.sourceProductId || "");
        if (id && seen.has(id)) {
          errors.push(`duplicate candidate sourceProductId: ${id}`);
        }
        seen.add(id);
      });
    }
    if (
      !state.globalReconcile ||
      typeof state.globalReconcile.allowed !== "boolean" ||
      state.globalReconcile.applyAllowed !== false ||
      !Array.isArray(state.globalReconcile.disappearedIds)
    ) {
      errors.push("globalReconcile is invalid");
    }
    if (!state.summary || typeof state.summary !== "object") {
      errors.push("summary is invalid");
    }
    if (state.productionWritten !== false) {
      errors.push("productionWritten must remain false");
    }
  }
  return {
    valid: errors.length === 0,
    status: errors.length === 0 ? "passed" : "blocked",
    errors,
  };
}

export function readProgressiveDailyState(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      status: "missing",
      state: null,
      errors: [],
    };
  }
  let state;
  try {
    state = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return {
      status: "blocked",
      state: null,
      errors: [`state JSON parse failed: ${error.message}`],
    };
  }
  const validation = validateProgressiveDailyState(state);
  return {
    status: validation.status,
    state: validation.valid ? state : null,
    errors: validation.errors,
  };
}

export async function writeProgressiveDailyState(
  filePath,
  state,
  options = {}
) {
  const validation = validateProgressiveDailyState(state);
  if (!validation.valid) {
    throw Object.assign(
      new Error(
        `Progressive state validation blocked: ${validation.errors.join("; ")}`
      ),
      {
        code: "PROGRESSIVE_STATE_INVALID",
        errors: validation.errors,
      }
    );
  }
  return writeJsonAtomic(filePath, state, options);
}
