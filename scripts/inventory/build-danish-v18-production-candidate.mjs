import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function option(name, envName, fallback = "") {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);

  if (index >= 0 && process.argv[index + 1]) {
    return text(process.argv[index + 1]);
  }

  return text(process.env[envName]) || fallback;
}

function resolvePath(value) {
  const normalized = text(value);

  return path.isAbsolute(normalized)
    ? normalized
    : path.join(ROOT, normalized);
}

function optionalExpectedCount(name) {
  const value = option(`expect-${name}`, `DANISH_EXPECTED_${name.toUpperCase().replaceAll("-", "_")}`);

  if (!value) {
    return null;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`Expected count for ${name} must be a non-negative integer: ${value}`);
  }

  return Number(value);
}

function text(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function readJson(filePath) {
  return JSON.parse(
    fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")
  );
}

function readPreviewTs(filePath) {
  const source = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");

  const marker =
    "export const danishProducts: DanishPipeProduct[] = ";

  const start = source.indexOf(marker);
  const end = source.lastIndexOf(";");

  if (start < 0 || end <= start) {
    throw new Error(
      `Cannot parse preview TypeScript file: ${filePath}`
    );
  }

  return JSON.parse(
    source.slice(start + marker.length, end).trim()
  );
}

function atomicWriteJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), {
    recursive: true,
  });

  const temporaryPath =
    `${filePath}.${process.pid}.${Date.now()}.tmp`;

  const content =
    `${JSON.stringify(payload, null, 2)}\n`;

  fs.writeFileSync(
    temporaryPath,
    content,
    "utf8"
  );

  const previousPath = `${filePath}.${process.pid}.${Date.now()}.previous`;
  let previousMoved = false;

  try {
    if (fs.existsSync(filePath)) {
      fs.renameSync(filePath, previousPath);
      previousMoved = true;
    }

    fs.renameSync(temporaryPath, filePath);

    if (previousMoved && fs.existsSync(previousPath)) {
      fs.rmSync(previousPath, { force: true });
    }
  } catch (error) {
    if (fs.existsSync(temporaryPath)) {
      fs.rmSync(temporaryPath, { force: true });
    }

    if (previousMoved && fs.existsSync(previousPath) && !fs.existsSync(filePath)) {
      fs.renameSync(previousPath, filePath);
    }

    throw error;
  }
}

function idOf(product) {
  const direct = text(product?.id)
    .replace(/^danish-/i, "");

  if (/^\d+$/.test(direct)) {
    return direct;
  }

  const url = text(
    product?.sourceUrl ||
    product?.href ||
    product?.originalUrl
  );

  return url.match(/-i(\d+)\.html/i)?.[1] || "";
}

function isFalcon(product) {
  const brand = text(product?.brand);
  const name = text(product?.name);

  return (
    /^falcon(?:\b|\s|,|-)/i.test(brand) ||
    /^falcon(?:\b|\s|,|-)/i.test(name)
  );
}

function isExcludedBpk(product) {
  return (
    idOf(product) === "32447" ||
    text(product?.name) ===
      "BPK, Barry, Seven (7) Pipes"
  );
}

function uniqueTextValues(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const result = [];
  const seen = new Set();

  for (const value of values) {
    const normalized = text(value);

    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function backfillCurrent(current, old, listRecord) {
  const listImage = text(listRecord?.imageUrl);
  const oldGallery = uniqueTextValues(old?.galleryImages);
  const currentGallery = uniqueTextValues(current.galleryImages);
  const galleryImages =
    currentGallery.length > 0
      ? currentGallery
      : listImage
        ? [listImage]
        : oldGallery;

  const specsText =
    Array.isArray(current.specsText) &&
    current.specsText.length > 0
      ? current.specsText
      : Array.isArray(old?.specsText)
        ? old.specsText
        : [];
  const currentDimensions = current.dimensions || {};
  const oldDimensions = old?.dimensions || {};
  const dimension = (key) =>
    Number.isFinite(currentDimensions[key])
      ? currentDimensions[key]
      : Number.isFinite(oldDimensions[key])
        ? oldDimensions[key]
        : null;

  return {
    ...current,

    imageUrl:
      text(current.imageUrl) ||
      listImage ||
      text(old?.imageUrl),

    detailImageUrl:
      text(current.detailImageUrl) ||
      listImage ||
      text(old?.detailImageUrl),

    galleryImages,
    galleryCount: galleryImages.length,

    productCode:
      text(current.productCode) ||
      text(old?.productCode),

    specsText,

    brand:
      text(current.brand) ||
      text(old?.brand),

    sourceUrl:
      text(current.sourceUrl) ||
      text(old?.sourceUrl),

    originalUrl:
      text(current.originalUrl) ||
      text(old?.originalUrl),

    shape: text(current.shape) || text(old?.shape),
    shapeZh: text(current.shapeZh) || text(old?.shapeZh),
    finish: text(current.finish) || text(old?.finish),
    finishZh: text(current.finishZh) || text(old?.finishZh),
    material: text(current.material) || text(old?.material),
    materialZh: text(current.materialZh) || text(old?.materialZh),
    stemMaterial: text(current.stemMaterial) || text(old?.stemMaterial),
    stemMaterialZh: text(current.stemMaterialZh) || text(old?.stemMaterialZh),
    filter: text(current.filter) || text(old?.filter) || null,
    filterSpec: text(current.filterSpec) || text(old?.filterSpec) || null,
    filterSizeMm: Number.isFinite(current.filterSizeMm)
      ? current.filterSizeMm
      : Number.isFinite(old?.filterSizeMm)
        ? old.filterSizeMm
        : null,
    country: text(current.country) || text(old?.country),
    weightGrams: Number.isFinite(current.weightGrams)
      ? current.weightGrams
      : Number.isFinite(old?.weightGrams)
        ? old.weightGrams
        : null,
    dimensions: {
      bowlOuterDiameterMm: dimension("bowlOuterDiameterMm"),
      chamberDiameterMm: dimension("chamberDiameterMm"),
      chamberDepthMm: dimension("chamberDepthMm"),
      heightMm: dimension("heightMm"),
      lengthMm: dimension("lengthMm"),
      buttonWidthMm: dimension("buttonWidthMm"),
      bitThicknessMm: dimension("bitThicknessMm"),
    },
  };
}

function retainMissingAsSold(old) {
  const tags = uniqueTextValues(old.tags)
    .filter(tag => tag !== "可购买")
    .filter(tag => tag !== "需人工确认");

  if (!tags.includes("已售")) {
    tags.push("已售");
  }

  return {
    ...old,

    status: "已售",
    tags,

    audience:
      "已售参考 / 款式比较",

    comment:
      "该商品已不在本次完整库存列表中，暂按已售参考保留。",
  };
}

function countBy(values) {
  return values.reduce((result, value) => {
    const key = text(value) || "未标记";

    result[key] =
      (result[key] || 0) + 1;

    return result;
  }, {});
}

const runId = option("run-id", "DANISH_RUN_ID", "danish-v18-list-20260715-02");
const previewPath = resolvePath(
  option("preview", "DANISH_PREVIEW_PATH", "data/danish-products-v18-preview.ts")
);
const baselinePathValue = option("baseline", "DANISH_BASELINE_PATH");

if (!baselinePathValue) {
  throw new Error(
    "A pre-refresh baseline is required. Set DANISH_BASELINE_PATH or pass --baseline <file>."
  );
}

const baselinePath = resolvePath(baselinePathValue);
const listPath = resolvePath(
  option(
    "list",
    "DANISH_LIST_PATH",
    `data/raw/danish-full-refresh/${runId}/list.json`
  )
);
const candidatePath = resolvePath(
  option(
    "candidate",
    "DANISH_CANDIDATE_PATH",
    `data/review/danish-full-refresh/${runId}/danish-products-v18-production-candidate.json`
  )
);
const reportPath = resolvePath(
  option(
    "report",
    "DANISH_REPORT_PATH",
    `data/review/danish-full-refresh/${runId}/danish-products-v18-production-candidate-report.json`
  )
);
const expected = {
  preview: optionalExpectedCount("preview"),
  baseline: optionalExpectedCount("baseline"),
  final: optionalExpectedCount("final"),
  retained: optionalExpectedCount("retained"),
  excluded: optionalExpectedCount("excluded"),
  available: optionalExpectedCount("available"),
  sold: optionalExpectedCount("sold"),
};

for (const [name, filePath] of Object.entries({
  previewPath,
  baselinePath,
  listPath,
})) {
  if (
    !filePath ||
    !fs.existsSync(filePath)
  ) {
    throw new Error(
      `Required ${name} not found: ${filePath}`
    );
  }
}

const preview =
  readPreviewTs(previewPath);

const baselinePayload =
  readJson(baselinePath);

const baseline =
  Array.isArray(baselinePayload)
    ? baselinePayload
    : Array.isArray(baselinePayload?.products)
      ? baselinePayload.products
      : [];
const listPayload = readJson(listPath);
const listProducts = Array.isArray(listPayload)
  ? listPayload
  : Array.isArray(listPayload?.products)
    ? listPayload.products
    : [];

if (expected.preview !== null && preview.length !== expected.preview) {
  throw new Error(`Unexpected preview count: ${preview.length}; expected ${expected.preview}`);
}

if (expected.baseline !== null && baseline.length !== expected.baseline) {
  throw new Error(`Unexpected baseline count: ${baseline.length}; expected ${expected.baseline}`);
}

const baselineById = new Map(
  baseline.map(product => [
    idOf(product),
    product,
  ])
);
const listById = new Map(
  listProducts.map(product => [
    idOf(product),
    product,
  ])
);

const previewById = new Map(
  preview.map(product => [
    idOf(product),
    product,
  ])
);

const currentProducts = preview.map(product =>
  backfillCurrent(
    product,
    baselineById.get(idOf(product)),
    listById.get(idOf(product))
  )
);

const excludedOld = [];
const retainedMissing = [];

for (const old of baseline) {
  const id = idOf(old);

  if (previewById.has(id)) {
    continue;
  }

  if (isFalcon(old)) {
    excludedOld.push({
      id,
      reason: "excludedFalcon",
      brand: text(old.brand),
      name: text(old.name),
    });

    continue;
  }

  if (isExcludedBpk(old)) {
    excludedOld.push({
      id,
      reason: "excludedBpkBarrySeven",
      brand: text(old.brand),
      name: text(old.name),
    });

    continue;
  }

  retainedMissing.push(
    retainMissingAsSold(old)
  );
}

const candidate = [
  ...currentProducts,
  ...retainedMissing,
].sort(
  (left, right) =>
    Number(idOf(left)) -
    Number(idOf(right))
);

const ids = candidate.map(idOf);
const uniqueIds = new Set(ids);

const invalidIds = ids.filter(
  id => !/^\d+$/.test(id)
);

const duplicateIds = [
  ...new Set(
    ids.filter(
      (id, index) =>
        ids.indexOf(id) !== index
    )
  ),
];

const falconRemaining =
  candidate.filter(isFalcon);

const excludedBpkRemaining =
  candidate.filter(isExcludedBpk);

const retainedWithWrongStatus =
  retainedMissing.filter(
    product => product.status !== "已售"
  );

const retainedWithCorruptText =
  retainedMissing.filter(product => {
    const fields = [
      product.status,
      product.audience,
      product.comment,
      ...(Array.isArray(product.tags)
        ? product.tags
        : []),
    ];

    return fields.some(
      value =>
        text(value).includes("??") ||
        text(value).includes("�")
    );
  });

const candidateWithCorruptText =
  candidate.filter(product => {
    const fields = [
      product.status,
      product.audience,
      product.comment,
      ...(Array.isArray(product.tags)
        ? product.tags
        : []),
    ];

    return fields.some(
      value =>
        text(value).includes("??") ||
        text(value).includes("�")
    );
  });

const allowedStatuses = new Set([
  "可购买",
  "已售",
  "需人工确认",
]);

const invalidStatusProducts =
  candidate.filter(
    product =>
      !allowedStatuses.has(
        text(product.status)
      )
  );

const missingImages =
  candidate.filter(
    product =>
      !text(product.imageUrl) ||
      !text(product.detailImageUrl) ||
      !Array.isArray(product.galleryImages) ||
      product.galleryImages.length === 0
  );

const missingProductCodes =
  candidate.filter(
    product => !text(product.productCode)
  );

const statusCounts = countBy(
  candidate.map(product => product.status)
);

const report = {
  source: "danish",
  runId,
  generatedAt: new Date().toISOString(),

  counts: {
    baseline:
      baseline.length,

    convertedPreview:
      preview.length,

    listProducts:
      listProducts.length,

    currentProducts:
      currentProducts.length,

    retainedMissingAsSold:
      retainedMissing.length,

    excludedOld:
      excludedOld.length,

    excludedOldReasons:
      countBy(
        excludedOld.map(item => item.reason)
      ),

    finalCandidate:
      candidate.length,

    uniqueIds:
      uniqueIds.size,

    invalidIds:
      invalidIds.length,

    duplicateIds:
      duplicateIds.length,

    falconRemaining:
      falconRemaining.length,

    excludedBpkRemaining:
      excludedBpkRemaining.length,

    retainedWithWrongStatus:
      retainedWithWrongStatus.length,

    retainedWithCorruptText:
      retainedWithCorruptText.length,

    candidateWithCorruptText:
      candidateWithCorruptText.length,

    invalidStatusProducts:
      invalidStatusProducts.length,

    missingImagesAfterBackfill:
      missingImages.length,

    missingProductCodesAfterBackfill:
      missingProductCodes.length,

    listImageBackfills:
      currentProducts.filter(product => {
        const previewProduct = previewById.get(idOf(product));
        const listProduct = listById.get(idOf(product));

        return !text(previewProduct?.imageUrl) && text(listProduct?.imageUrl) && text(product.imageUrl) === text(listProduct.imageUrl);
      }).length,

    statusCounts,
  },

  samples: {
    excludedOld:
      excludedOld.slice(0, 20),

    retainedMissingAsSold:
      retainedMissing.slice(0, 20).map(
        product => ({
          id: idOf(product),
          brand: text(product.brand),
          name: text(product.name),
          status: text(product.status),
          tags: product.tags,
          sourceUrl: text(product.sourceUrl),
        })
      ),

    invalidStatus:
      invalidStatusProducts.slice(0, 20).map(
        product => ({
          id: idOf(product),
          name: text(product.name),
          status: text(product.status),
        })
      ),

    corruptText:
      candidateWithCorruptText.slice(0, 20).map(
        product => ({
          id: idOf(product),
          name: text(product.name),
          status: text(product.status),
          audience: text(product.audience),
          comment: text(product.comment),
          tags: product.tags,
        })
      ),

    missingImages:
      missingImages.slice(0, 20).map(
        product => ({
          id: idOf(product),
          brand: text(product.brand),
          name: text(product.name),
          sourceUrl: text(product.sourceUrl),
        })
      ),

    missingProductCodes:
      missingProductCodes.slice(0, 20).map(
        product => ({
          id: idOf(product),
          brand: text(product.brand),
          name: text(product.name),
          sourceUrl: text(product.sourceUrl),
        })
      ),
  },

  allowApply: false,
  productionWritten: false,
  publicWritten: false,
};

const expectedCountsPassed =
  (expected.final === null || candidate.length === expected.final) &&
  (expected.retained === null || retainedMissing.length === expected.retained) &&
  (expected.excluded === null || excludedOld.length === expected.excluded) &&
  (expected.available === null || statusCounts["可购买"] === expected.available) &&
  (expected.sold === null || statusCounts["已售"] === expected.sold);

const hardGatePassed =
  expectedCountsPassed &&
  invalidIds.length === 0 &&
  duplicateIds.length === 0 &&
  uniqueIds.size === candidate.length &&
  falconRemaining.length === 0 &&
  excludedBpkRemaining.length === 0 &&
  retainedWithWrongStatus.length === 0 &&
  retainedWithCorruptText.length === 0 &&
  candidateWithCorruptText.length === 0 &&
  invalidStatusProducts.length === 0 &&
  true;

report.hardGatePassed =
  hardGatePassed;
report.expected = expected;

if (!hardGatePassed) {
  console.dir(report, {
    depth: 8,
    maxArrayLength: 20,
  });

  throw new Error(
    "Danish UTF-8 production candidate hard gate failed."
  );
}

atomicWriteJson(
  candidatePath,
  candidate
);

atomicWriteJson(
  reportPath,
  report
);

console.dir(
  {
    candidateCount:
      report.counts.finalCandidate,

    retainedMissingAsSold:
      report.counts.retainedMissingAsSold,

    excludedOld:
      report.counts.excludedOld,

    excludedOldReasons:
      report.counts.excludedOldReasons,

    statusCounts:
      report.counts.statusCounts,

    invalidStatusProducts:
      report.counts.invalidStatusProducts,

    candidateWithCorruptText:
      report.counts.candidateWithCorruptText,

    missingImagesAfterBackfill:
      report.counts.missingImagesAfterBackfill,

    missingProductCodesAfterBackfill:
      report.counts
        .missingProductCodesAfterBackfill,

    invalidIds:
      report.counts.invalidIds,

    duplicateIds:
      report.counts.duplicateIds,

    falconRemaining:
      report.counts.falconRemaining,

    candidatePath,
    reportPath,
    expected,

    productionWritten: false,
    publicWritten: false,
  },
  {
    depth: 6,
  }
);

console.log(
  "\n[PASS] Danish UTF-8 production candidate generated."
);
