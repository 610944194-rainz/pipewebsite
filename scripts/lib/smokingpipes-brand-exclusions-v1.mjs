export const SMOKINGPIPES_EXCLUDED_BRANDS = Object.freeze([
  "falcon",
]);

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizedBrand(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sourceBrandSlug(item) {
  const sourceUrl = text(
    item?.sourceUrl || item?.url || item?.href
  );
  const match = sourceUrl.match(
    /\/pipes\/(?:new|estate)\/([^/?#]+)\//i
  );
  return normalizedBrand(match?.[1]);
}

function explicitBrand(item) {
  for (const value of [
    item?.brandSlug,
    item?.brand,
    item?.brandName,
    item?.canonicalBrand,
  ]) {
    const brand = normalizedBrand(
      typeof value === "object"
        ? value?.slug || value?.name
        : value
    );
    if (brand) return brand;
  }
  return "";
}

function productNameBrand(item) {
  const productName = text(
    item?.productName ||
      item?.listTitle ||
      item?.title ||
      item?.rawTitle ||
      item?.fullTitle ||
      item?.displayNameEn
  );
  for (const brand of SMOKINGPIPES_EXCLUDED_BRANDS) {
    if (
      new RegExp(
        `^(?:the\\s+)?${brand}(?:\\b|[\\s,:/\\-])`,
        "i"
      ).test(productName)
    ) {
      return brand;
    }
  }
  return "";
}

export function classifySmokingpipesBrandExclusion(item = {}) {
  const urlBrand = sourceBrandSlug(item);
  if (SMOKINGPIPES_EXCLUDED_BRANDS.includes(urlBrand)) {
    return {
      excluded: true,
      brand: urlBrand,
      reason: `excluded-brand:${urlBrand}`,
      evidence: "source-url-brand-slug",
    };
  }

  const brand = explicitBrand(item);
  if (SMOKINGPIPES_EXCLUDED_BRANDS.includes(brand)) {
    return {
      excluded: true,
      brand,
      reason: `excluded-brand:${brand}`,
      evidence: "explicit-brand",
    };
  }

  const nameBrand = productNameBrand(item);
  if (SMOKINGPIPES_EXCLUDED_BRANDS.includes(nameBrand)) {
    return {
      excluded: true,
      brand: nameBrand,
      reason: `excluded-brand:${nameBrand}`,
      evidence: "product-name-prefix",
    };
  }

  return {
    excluded: false,
    brand: null,
    reason: null,
    evidence: null,
  };
}

export function isSmokingpipesExcludedBrand(item = {}) {
  return classifySmokingpipesBrandExclusion(item).excluded;
}

function sourceIsSmokingpipes(item) {
  const source = text(item?.source).toLowerCase();
  return !source || source === "smokingpipes";
}

export function applySmokingpipesBrandExclusions({
  state,
  productionProducts = [],
  publicProducts = [],
  now = new Date().toISOString(),
} = {}) {
  const next = structuredClone(state);
  const candidates = Array.isArray(next?.candidates)
    ? next.candidates
    : [];
  const pendingBefore = candidates.filter(
    (item) => item.detailStatus === "pending"
  ).length;
  const excludedBrandBreakdown = {};
  const excludedCandidateIds = [];

  for (const candidate of candidates) {
    const exclusion =
      classifySmokingpipesBrandExclusion(candidate);
    if (!exclusion.excluded) continue;

    excludedBrandBreakdown[exclusion.brand] =
      Number(excludedBrandBreakdown[exclusion.brand] || 0) + 1;
    excludedCandidateIds.push(
      String(candidate.sourceProductId)
    );
    candidate.detailStatus = "excluded";
    candidate.publicStatus = "not-public";
    candidate.excludedBrand = exclusion.brand;
    candidate.exclusionReason = exclusion.reason;
    candidate.exclusionEvidence = exclusion.evidence;
    candidate.excludedAt ||= now;
    candidate.readyReason = null;
    candidate.reviewReason = exclusion.reason;
    candidate.lastError = exclusion.reason;
    candidate.nextEligibleAt = null;
  }

  const productionFalconIds = productionProducts
    .filter(
      (item) =>
        sourceIsSmokingpipes(item) &&
        classifySmokingpipesBrandExclusion(item).excluded
    )
    .map((item) =>
      String(item.sourceProductId || item.id || "")
    )
    .filter(Boolean);
  const publicFalconIds = publicProducts
    .filter(
      (item) =>
        text(item?.source).toLowerCase() === "smokingpipes" &&
        classifySmokingpipesBrandExclusion(item).excluded
    )
    .map((item) =>
      String(item.sourceProductId || item.id || "")
    )
    .filter(Boolean);

  next.updatedAt = now;
  return {
    state: next,
    report: {
      version: "smokingpipes-brand-exclusion-report-v1",
      generatedAt: now,
      excludedBrands: [...SMOKINGPIPES_EXCLUDED_BRANDS],
      excludedBrandCount: excludedCandidateIds.length,
      excludedBrandBreakdown,
      excludedCandidateIds,
      pendingBefore,
      pendingAfterBrandExclusion: candidates.filter(
        (item) => item.detailStatus === "pending"
      ).length,
      plannedHideProductionCount: productionFalconIds.length,
      plannedHideProductionIds: productionFalconIds,
      plannedHidePublicCount: publicFalconIds.length,
      plannedHidePublicIds: publicFalconIds,
      smokingpipesAccessed: false,
      productionWritten: false,
    },
  };
}

export function smokingpipesBrandExclusionMarkdown(report) {
  return `# Smokingpipes Brand Exclusion Review

- excludedBrands: ${report.excludedBrands.join(", ")}
- excludedBrandCount: ${report.excludedBrandCount}
- excludedBrandBreakdown: ${JSON.stringify(report.excludedBrandBreakdown)}
- pendingBefore: ${report.pendingBefore}
- pendingAfterBrandExclusion: ${report.pendingAfterBrandExclusion}
- plannedHideProductionCount: ${report.plannedHideProductionCount}
- plannedHidePublicCount: ${report.plannedHidePublicCount}
- smokingpipesAccessed: false
- productionWritten: false

## Excluded candidate IDs

${
  report.excludedCandidateIds.length
    ? report.excludedCandidateIds
        .map((id) => `- ${id}`)
        .join("\n")
    : "- none"
}

## Planned production hide IDs

${
  report.plannedHideProductionIds.length
    ? report.plannedHideProductionIds
        .map((id) => `- ${id}`)
        .join("\n")
    : "- none"
}

## Planned public hide IDs

${
  report.plannedHidePublicIds.length
    ? report.plannedHidePublicIds
        .map((id) => `- ${id}`)
        .join("\n")
    : "- none"
}
`;
}
