import crypto from "node:crypto";
import {
  evaluateSmokingpipesPublicReadiness,
} from "../lib/smokingpipes-public-readiness-v1.mjs";

export const SMOKINGPIPES_ACTION_EVENT_SCHEMA_VERSION =
  "smokingpipes-action-event-v1";
export const SMOKINGPIPES_CATCHUP_BATCH_LIMIT = 2000;

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sourceProductId(item) {
  return text(item?.sourceProductId);
}

function parsePrice(value) {
  const amount = Number.parseFloat(text(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function clone(value) {
  return structuredClone(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

export function stableProductHash(product) {
  if (!product) return null;
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(product)))
    .digest("hex");
}

function updateExplicitPrice(product, candidate) {
  const amount = parsePrice(candidate.listPrice);
  if (!amount) return product;
  const next = clone(product);
  next.price ||= {};
  next.price.current = {
    ...(next.price.current || {}),
    rawText: candidate.listPrice,
    currency: next.price.current?.currency || "USD",
    amount,
    parseStatus: "parsed",
  };
  if (next.price.listPrice) {
    next.price.listPrice = {
      ...next.price.listPrice,
      rawText: candidate.listPrice,
      currency: next.price.listPrice.currency || "USD",
      amount,
      parseStatus: "parsed",
    };
  }
  return next;
}

function updateInventory(product, actionType) {
  const next = clone(product);
  if (actionType === "explicit-out-of-stock") {
    next.inventoryStatus = "sold";
    next.inventoryConfidence = "high";
    next.includedInActiveListRange = true;
    next.rawListStatus = "OUT OF STOCK";
    next.inventoryEvidence = {
      ...(next.inventoryEvidence || {}),
      includedInActiveListRange: true,
      rawListStatus: "OUT OF STOCK",
      reasons: [...new Set([
        ...(next.inventoryEvidence?.reasons || []),
        "Explicit OUT OF STOCK observed in progressive list scan.",
      ])],
    };
  } else if (actionType === "reappeared") {
    next.inventoryStatus = "available";
    next.inventoryConfidence = "high";
    next.includedInActiveListRange = true;
    next.rawListStatus = "";
    next.inventoryEvidence = {
      ...(next.inventoryEvidence || {}),
      includedInActiveListRange: true,
      rawListStatus: "",
      reasons: [...new Set([
        ...(next.inventoryEvidence?.reasons || []),
        "Product reappeared in progressive list scan.",
      ])],
    };
  } else if (actionType === "confirmed-disappeared") {
    next.inventoryStatus = "sold";
    next.inventoryConfidence = "medium";
    next.includedInActiveListRange = false;
    next.rawListStatus = "";
    next.inventoryEvidence = {
      ...(next.inventoryEvidence || {}),
      includedInActiveListRange: false,
      rawListStatus: "",
      reasons: [...new Set([
        ...(next.inventoryEvidence?.reasons || []),
        "Product was absent from two consecutive trusted complete list scans.",
      ])],
    };
  }
  return next;
}

function isNewProductEligible(candidate) {
  const product = candidate?.convertedProduct;
  const readiness = product
    ? evaluateSmokingpipesPublicReadiness(product)
    : null;
  return (
    candidate?.detailStatus === "complete" &&
    candidate?.publicStatus === "ready" &&
    product &&
    readiness?.publicIndexEligible === true &&
    Boolean(
      text(product.mainImageUrl || product.imageUrl) ||
        product.galleryImages?.some((item) => text(item))
    ) &&
    parsePrice(product.price?.current?.amount) !== null
  );
}

function itemIsExplicitOutOfStock(item) {
  return /out\s*of\s*stock/i.test(text(item?.rawListStatus));
}

function currentItemPrice(item) {
  return parsePrice(item?.price ?? item?.listPrice);
}

function productionPrice(product) {
  return Number(product?.price?.current?.amount) || null;
}

function isSold(product) {
  return text(product?.inventoryStatus).toLowerCase() === "sold";
}

function uniqueSorted(values) {
  return [...new Set(values.map(String).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "en", { numeric: true })
  );
}

function snapshotHash(currentPayload, diffPayload) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize({
      currentGeneratedAt: currentPayload?.generatedAt || null,
      currentCompletedAt: currentPayload?.completedAt || null,
      currentSummary: currentPayload?.summary || null,
      currentProducts: currentPayload?.products || [],
      diffGeneratedAt: diffPayload?.generatedAt || null,
      diffCounts: diffPayload?.counts || null,
      newIds: diffPayload?.newIds || [],
      reappearedIds: diffPayload?.reappearedIds || [],
      disappearedIds: diffPayload?.disappearedIds || [],
      duplicateStats: diffPayload?.duplicateStats || null,
    })))
    .digest("hex");
}

function actionPriority(actionType) {
  return {
    "explicit-out-of-stock": 0,
    reappeared: 1,
    "confirmed-disappeared": 2,
    "price-change": 3,
    "new-product": 4,
  }[actionType] ?? 99;
}

function observedActionType({
  id,
  candidate,
  currentById,
  diffPayload,
  disappearanceTracking,
  production,
}) {
  if (
    candidate?.detailStatus !== "complete" ||
    candidate?.publicStatus !== "ready"
  ) {
    return null;
  }
  const current = currentById.get(id);
  const newIds = new Set((diffPayload?.newIds || []).map(String));
  const reappearedIds = new Set(
    (diffPayload?.reappearedIds || []).map(String)
  );
  const tracking = disappearanceTracking?.items?.[id];
  if (
    tracking?.disappearanceStatus === "confirmed-disappeared" &&
    candidate?.changeTypes?.includes("confirmed-disappeared") &&
    !candidate?.changeTypes?.includes("reappeared") &&
    !isSold(production)
  ) {
    return "confirmed-disappeared";
  }
  if (!current) return null;
  if (newIds.has(id) && isNewProductEligible(candidate)) {
    return "new-product";
  }
  if (reappearedIds.has(id) && isSold(production)) return "reappeared";
  if (itemIsExplicitOutOfStock(current) && !isSold(production)) {
    return "explicit-out-of-stock";
  }
  const currentPrice = currentItemPrice(current);
  const beforePrice = productionPrice(production);
  if (
    production &&
    currentPrice &&
    beforePrice &&
    Math.abs(currentPrice - beforePrice) > 0.0001
  ) {
    return "price-change";
  }
  return null;
}

function desiredForAction({ candidate, production, actionType }) {
  if (actionType === "new-product") {
    return isNewProductEligible(candidate)
      ? clone(candidate.convertedProduct)
      : null;
  }
  if (!production) return null;
  if (actionType === "price-change") {
    return updateExplicitPrice(production, candidate);
  }
  let desired = updateInventory(production, actionType);
  if (
    actionType === "reappeared" &&
    parsePrice(candidate.listPrice) &&
    Math.abs(
      parsePrice(candidate.listPrice) - (productionPrice(production) || 0)
    ) > 0.0001
  ) {
    desired = updateExplicitPrice(desired, candidate);
  }
  return desired;
}

function fieldsChanged(before, after, prefix = "") {
  const keys = new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ]);
  const changes = [];
  for (const key of [...keys].sort()) {
    const path = prefix ? `${prefix}.${key}` : key;
    const left = before?.[key];
    const right = after?.[key];
    if (
      left && right &&
      typeof left === "object" &&
      typeof right === "object" &&
      !Array.isArray(left) && !Array.isArray(right)
    ) {
      changes.push(...fieldsChanged(left, right, path));
    } else if (JSON.stringify(left) !== JSON.stringify(right)) {
      changes.push(path);
    }
  }
  return changes;
}

function makeEventId({ id, actionType, sourceSnapshotHash: hash }) {
  return crypto
    .createHash("sha256")
    .update(`${id}|${actionType}|${hash}`)
    .digest("hex");
}

function makeEvent({
  id,
  candidate,
  actionType,
  production,
  desired,
  sourceSnapshotId,
  sourceSnapshotHash: hash,
  now,
}) {
  return {
    schemaVersion: SMOKINGPIPES_ACTION_EVENT_SCHEMA_VERSION,
    eventId: makeEventId({ id, actionType, sourceSnapshotHash: hash }),
    sourceProductId: id,
    detectedRunId: candidate.lastSeenRunId || candidate.firstSeenRunId || null,
    sourceSnapshotId,
    sourceSnapshotHash: hash,
    changeType: actionType,
    baselineProductHash: stableProductHash(production),
    desiredProductHash: stableProductHash(desired),
    status: "pending",
    appliedAt: null,
    appliedRunId: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function buildSmokingpipesActionableApplyPlan({
  productionProducts = [],
  state,
  currentPayload,
  diffPayload,
  now = new Date().toISOString(),
}) {
  const currentProducts = currentPayload?.products || [];
  const currentById = new Map(
    currentProducts.map((item) => [sourceProductId(item), item])
  );
  const productionById = new Map(
    productionProducts.map((item) => [sourceProductId(item), clone(item)])
  );
  const sourceSnapshotId =
    currentPayload?.completedAt || currentPayload?.generatedAt || null;
  const sourceSnapshotHash = currentPayload && diffPayload
    ? snapshotHash(currentPayload, diffPayload)
    : null;
  const eventsById = structuredClone(state?.actionEvents || {});
  const items = [];
  const isolated = [];
  const superseded = [];

  for (const event of Object.values(eventsById)) {
    if (!event || event.status !== "pending") continue;
    const currentProduction =
      productionById.get(sourceProductId(event)) || null;
    const currentHash = stableProductHash(currentProduction);
    if (event.desiredProductHash && event.desiredProductHash === currentHash) {
      event.status = "superseded";
      event.supersededReason = "desired product already matches production";
      event.updatedAt = now;
      superseded.push({
        id: sourceProductId(event),
        reason: event.supersededReason,
      });
    } else if (
      event.baselineProductHash &&
      event.baselineProductHash !== currentHash
    ) {
      event.status = "isolated";
      event.isolationReason =
        "production baseline changed; event must be recalculated";
      event.updatedAt = now;
      isolated.push({
        id: sourceProductId(event),
        reason: event.isolationReason,
      });
    }
  }

  for (const candidate of state?.candidates || []) {
    const id = sourceProductId(candidate);
    if (!id) continue;
    const production = productionById.get(id) || null;
    const actionType = sourceSnapshotHash
      ? observedActionType({
          id,
          candidate,
          currentById,
          diffPayload,
          disappearanceTracking:
            state?.globalReconcile?.disappearanceTracking,
          production,
        })
      : null;
    if (!actionType) continue;
    const desired = desiredForAction({ candidate, production, actionType });
    if (!desired) {
      isolated.push({ id, reason: "actionable event has no valid desired product" });
      continue;
    }
    const event = makeEvent({
      id,
      candidate,
      actionType,
      production,
      desired,
      sourceSnapshotId,
      sourceSnapshotHash,
      now,
    });
    const prior = eventsById[event.eventId];
    if (prior?.status === "applied") {
      eventsById[event.eventId] = { ...prior, updatedAt: now };
      continue;
    }
    if (prior?.status === "superseded" || prior?.status === "isolated") {
      eventsById[event.eventId] = { ...prior, updatedAt: now };
      if (prior.status === "superseded") {
        superseded.push({ id, reason: prior.supersededReason || "previously superseded" });
      } else {
        isolated.push({ id, reason: prior.isolationReason || "previously isolated" });
      }
      continue;
    }
    if (event.baselineProductHash === event.desiredProductHash) {
      event.status = "superseded";
      event.supersededReason = "desired product already matches production";
      superseded.push({ id, reason: event.supersededReason });
    } else if (
      prior?.baselineProductHash &&
      prior.baselineProductHash !== event.baselineProductHash
    ) {
      event.status = "isolated";
      event.isolationReason = "production baseline changed; event must be recalculated";
      isolated.push({ id, reason: event.isolationReason });
    }
    eventsById[event.eventId] = { ...prior, ...event };
    if (eventsById[event.eventId].status !== "pending") continue;
    items.push({
      event: eventsById[event.eventId],
      candidate,
      production,
      desired,
      fields: actionType === "new-product"
        ? ["*new-product"]
        : fieldsChanged(production, desired),
    });
  }

  items.sort((left, right) =>
    actionPriority(left.event.changeType) - actionPriority(right.event.changeType) ||
    left.event.sourceProductId.localeCompare(
      right.event.sourceProductId,
      "en",
      { numeric: true }
    )
  );
  const batches = [];
  for (let index = 0; index < items.length; index += SMOKINGPIPES_CATCHUP_BATCH_LIMIT) {
    batches.push({
      batchNumber: batches.length + 1,
      requiresManualApproval: true,
      eventIds: items.slice(index, index + SMOKINGPIPES_CATCHUP_BATCH_LIMIT)
        .map((item) => item.event.eventId),
      sourceProductIds: items.slice(index, index + SMOKINGPIPES_CATCHUP_BATCH_LIMIT)
        .map((item) => item.event.sourceProductId),
    });
  }
  return {
    schemaVersion: SMOKINGPIPES_ACTION_EVENT_SCHEMA_VERSION,
    sourceSnapshotId,
    sourceSnapshotHash,
    eventsById,
    items,
    isolated,
    superseded,
    catchupBatches: batches,
  };
}

export function markSmokingpipesActionEventsApplied({
  state,
  eventIds = [],
  appliedRunId,
  appliedAt = new Date().toISOString(),
}) {
  const next = structuredClone(state);
  next.actionEvents ||= {};
  for (const eventId of uniqueSorted(eventIds)) {
    const event = next.actionEvents[eventId];
    if (!event || event.status !== "pending") continue;
    event.status = "applied";
    event.appliedAt = appliedAt;
    event.appliedRunId = appliedRunId || null;
    event.updatedAt = appliedAt;
  }
  return next;
}
