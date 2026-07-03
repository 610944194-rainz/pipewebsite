import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  writeJsonAtomic,
  writeTextAtomic,
} from "./inventory-runner-core-v1.mjs";
import {
  buildProgressivePartialProducts,
  diagnoseProgressiveApplyGap,
} from "./smokingpipes-progressive-candidate-v1.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

function readJson(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Required input is missing: ${relativePath}`);
  }
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function items(payload) {
  return Array.isArray(payload) ? payload : payload?.products || [];
}

function markdown(report) {
  const classifications = report.gapClassifications;
  const rows = report.gapCandidates.length
    ? report.gapCandidates
        .map(
          (item) =>
            `| ${item.sourceProductId} | ${item.changeType} | ${item.publicStatus} | ${item.detailStatus} | ${item.reason} |`
        )
        .join("\n")
    : "| — | — | — | — | none |";
  return `# Smokingpipes Apply Gap Diagnosis

- candidateCount: ${report.candidateCount}
- wouldApplyCount: ${report.wouldApplyCount}
- gapCount: ${report.gapCount}
- safeToApplyWouldApplySubset: ${report.safeToApplyWouldApplySubset}
- unknownGapCount: ${report.unknownGapCount}
- readyUnexpectedlyExcludedCount: ${report.readyUnexpectedlyExcludedCount}

## Classifications

- disappearedApplyDisabled: ${classifications.disappearedApplyDisabled}
- soldByAbsenceDisabled: ${classifications.soldByAbsenceDisabled}
- reviewOnly: ${classifications.reviewOnly}
- notPublic: ${classifications.notPublic}
- noOpAlreadyCurrent: ${classifications.noOpAlreadyCurrent}
- readyUnexpectedlyExcluded: ${classifications.readyUnexpectedlyExcluded}
- other: ${classifications.other}

## Gap Candidates

| sourceProductId | changeType | publicStatus | detailStatus | reason |
| --- | --- | --- | --- | --- |
${rows}
`;
}

async function main() {
  const state = readJson(
    "data/inventory/smokingpipes-progressive-daily-state.json"
  );
  const productionProducts = items(
    readJson("data/products/smokingpipes-products.json")
  );
  const existingPreview = readJson(
    "data/review/smokingpipes-progressive-partial-apply-preview.json"
  );
  const candidate = buildProgressivePartialProducts({
    productionProducts,
    state,
  });
  const report = diagnoseProgressiveApplyGap({
    state,
    productionProducts,
    candidateProducts: candidate.products,
    candidateIds: candidate.attemptedCandidateIds,
    wouldApplyProductIds:
      existingPreview.wouldApplyProductIds || [],
  });
  const jsonPath = path.join(
    ROOT,
    "data/review/smokingpipes-apply-gap-diagnosis-report.json"
  );
  const markdownPath = path.join(
    ROOT,
    "data/review/smokingpipes-apply-gap-diagnosis-report.md"
  );
  await writeJsonAtomic(jsonPath, report);
  await writeTextAtomic(markdownPath, markdown(report));
  console.log(
    JSON.stringify(
      {
        candidateCount: report.candidateCount,
        wouldApplyCount: report.wouldApplyCount,
        gapCount: report.gapCount,
        gapClassifications: report.gapClassifications,
        safeToApplyWouldApplySubset:
          report.safeToApplyWouldApplySubset,
        jsonPath: path.relative(ROOT, jsonPath),
        markdownPath: path.relative(ROOT, markdownPath),
        productionWritten: false,
      },
      null,
      2
    )
  );
}

await main();
