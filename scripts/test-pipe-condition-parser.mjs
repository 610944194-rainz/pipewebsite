import { parsePipeCondition } from "./collect-danish-details-v16.mjs";

const cases = [
  {
    name: "Estate + Unsmoked",
    input: ["Estate", "Unsmoked"],
    expected: {
      conditionType: "estate",
      smokedStatus: "unsmoked",
      conditionLabel: "Estate 未使用",
      estateStatus: "unsmoked",
      estateRatingStars: null,
    },
  },
  {
    name: "Estate + Presmoked",
    input: ["Estate", "Presmoked"],
    expected: {
      conditionType: "estate",
      smokedStatus: "preSmoked",
      conditionLabel: "Estate 已使用",
      estateStatus: "presmoked",
      estateRatingStars: null,
    },
  },
  {
    name: "Estate + Pre-smoked",
    input: ["Estate", "Pre-smoked"],
    expected: {
      conditionType: "estate",
      smokedStatus: "preSmoked",
      conditionLabel: "Estate 已使用",
      estateStatus: "presmoked",
      estateRatingStars: null,
    },
  },
  {
    name: "Estate only",
    input: ["Estate"],
    expected: {
      conditionType: "estate",
      smokedStatus: "unknown",
      conditionLabel: "Estate 二手斗",
      estateStatus: "unknown",
      estateRatingStars: null,
    },
  },
  {
    name: "New pipe",
    input: ["New pipe"],
    expected: {
      conditionType: "new",
      smokedStatus: "unsmoked",
      conditionLabel: "新斗",
      estateStatus: null,
      estateRatingStars: null,
    },
  },
  {
    name: "Brand new estate pipes",
    input: ["Brand new estate pipes"],
    expected: {
      conditionType: "estate",
      smokedStatus: "unsmoked",
      conditionLabel: "Estate 未使用",
      estateStatus: "unsmoked",
      estateRatingStars: null,
    },
  },
  {
    name: "New inner coating",
    input: ["New inner coating"],
    expected: {
      conditionType: "unknown",
      smokedStatus: "unknown",
      conditionLabel: "状态待确认",
      estateStatus: null,
      estateRatingStars: null,
    },
  },
  {
    name: "As new",
    input: ["As new"],
    expected: {
      conditionType: "unknown",
      smokedStatus: "unknown",
      conditionLabel: "状态待确认",
      estateStatus: null,
      estateRatingStars: 5,
      estateRatingLabel: "5 星近似全新",
    },
  },
  {
    name: "Estate + As new",
    input: ["Estate", "As new"],
    expected: {
      conditionType: "estate",
      smokedStatus: "unknown",
      conditionLabel: "Estate 二手斗",
      estateStatus: "unknown",
      estateRatingStars: 5,
      estateRatingLabel: "5 星近似全新",
    },
  },
  {
    name: "Estate + 4 stars / Very good condition",
    input: ["Estate", "4 stars", "Very good condition"],
    expected: {
      conditionType: "estate",
      smokedStatus: "unknown",
      conditionLabel: "Estate 二手斗",
      estateStatus: "unknown",
      estateRatingStars: 4,
      estateRatingLabel: "4 星非常好成色",
    },
  },
  {
    name: "Unsmoked only",
    input: ["Unsmoked"],
    expected: {
      conditionType: "unknown",
      smokedStatus: "unsmoked",
      conditionLabel: "未使用，来源待确认",
      estateStatus: null,
      estateRatingStars: null,
    },
  },
  {
    name: "No evidence",
    input: [],
    expected: {
      conditionType: "unknown",
      smokedStatus: "unknown",
      conditionLabel: "状态待确认",
      estateStatus: null,
      estateRatingStars: null,
    },
  },
];

function formatResult(result) {
  return {
    conditionType: result.conditionType,
    smokedStatus: result.smokedStatus,
    conditionLabel: result.conditionLabel,
    conditionRawText: result.conditionRawText,
    estateStatus: result.estateStatus,
    estateRatingStars: result.estateRatingStars,
    estateRatingLabel: result.estateRatingLabel,
  };
}

function assertExpected(testCase, result) {
  const mismatches = [];

  for (const [field, expectedValue] of Object.entries(testCase.expected)) {
    if (result[field] !== expectedValue) {
      mismatches.push(`${field}: expected ${expectedValue}, got ${result[field]}`);
    }
  }

  return mismatches;
}

let failedCount = 0;

for (const testCase of cases) {
  const result = parsePipeCondition(testCase.input);
  const mismatches = assertExpected(testCase, result);
  const passed = mismatches.length === 0;

  console.log("");
  console.log(`${passed ? "PASS" : "FAIL"} ${testCase.name}`);
  console.log(formatResult(result));

  if (!passed) {
    failedCount += 1;
    console.log("Mismatches:");
    console.log(mismatches);
  }
}

console.log("");
console.log(`Pipe condition parser tests: ${cases.length - failedCount}/${cases.length} passed`);

if (failedCount > 0) {
  process.exit(1);
}
