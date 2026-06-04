import { parsePipeCondition } from "./collect-danish-details-v16.mjs";

const normalPipesCategory = "https://www.danishpipeshop.com/l/-zh/Pipes1";

const cases = [
  {
    name: "Estate + Unsmoked",
    input: ["Estate", "Unsmoked"],
    expected: {
      conditionType: "estate",
      smokedStatus: "unsmoked",
      conditionLabel: "Estate 未使用",
      conditionSource: "explicit",
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
      conditionSource: "explicit",
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
      conditionSource: "explicit",
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
      conditionSource: "explicit",
      estateStatus: "unknown",
      estateRatingStars: null,
    },
  },
  {
    name: "Explicit New pipe",
    input: ["New pipe"],
    expected: {
      conditionType: "new",
      smokedStatus: "unsmoked",
      conditionLabel: "新斗",
      conditionSource: "explicit",
      estateStatus: null,
      estateRatingStars: null,
    },
  },
  {
    name: "Normal Pipes category without estate evidence",
    input: [{ source: "listPageUrl", text: normalPipesCategory }],
    expected: {
      conditionType: "new",
      smokedStatus: "unsmoked",
      conditionLabel: "新斗",
      conditionSource: "category",
      estateStatus: null,
      estateRatingStars: null,
    },
    notesIncludes: "按 Danish 普通 Pipes 栏目判断",
  },
  {
    name: "Normal Pipes category with filter text",
    input: [
      { source: "listPageUrl", text: normalPipesCategory },
      { source: "specsText", text: "滤芯: 无滤芯\nFilter: without filter\nMouthpiece: unfiltered" },
    ],
    expected: {
      conditionType: "new",
      smokedStatus: "unsmoked",
      conditionLabel: "新斗",
      conditionSource: "category",
      estateStatus: null,
      estateRatingStars: null,
    },
    notesIncludes: "按 Danish 普通 Pipes 栏目判断",
    rawTextNotIncludes: ["unsmoked"],
  },
  {
    name: "Estate wins over Normal Pipes category",
    input: [
      { source: "listPageUrl", text: normalPipesCategory },
      { source: "title", text: "Estate Stanwell Bamboo Presmoked" },
    ],
    expected: {
      conditionType: "estate",
      smokedStatus: "preSmoked",
      conditionLabel: "Estate 已使用",
      conditionSource: "explicit",
      estateStatus: "presmoked",
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
      conditionSource: "explicit",
      estateStatus: "unsmoked",
      estateRatingStars: null,
    },
  },
  {
    name: "New inner coating without category",
    input: ["New inner coating"],
    expected: {
      conditionType: "unknown",
      smokedStatus: "unknown",
      conditionLabel: "状态待确认",
      conditionSource: "unknown",
      estateStatus: null,
      estateRatingStars: null,
    },
  },
  {
    name: "New inner coating with Normal Pipes category",
    input: [
      { source: "listPageUrl", text: normalPipesCategory },
      { source: "description", text: "New inner coating" },
    ],
    expected: {
      conditionType: "new",
      smokedStatus: "unsmoked",
      conditionLabel: "新斗",
      conditionSource: "category",
      estateStatus: null,
      estateRatingStars: null,
    },
    notesIncludes: "按 Danish 普通 Pipes 栏目判断",
  },
  {
    name: "As new without category",
    input: ["As new"],
    expected: {
      conditionType: "unknown",
      smokedStatus: "unknown",
      conditionLabel: "状态待确认",
      conditionSource: "explicit",
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
      conditionSource: "explicit",
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
      conditionSource: "explicit",
      estateStatus: "unknown",
      estateRatingStars: 4,
      estateRatingLabel: "4 星非常好成色",
    },
  },
  {
    name: "No category and no evidence",
    input: [],
    expected: {
      conditionType: "unknown",
      smokedStatus: "unknown",
      conditionLabel: "状态待确认",
      conditionSource: "unknown",
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
    conditionSource: result.conditionSource,
    conditionRawText: result.conditionRawText,
    conditionNotes: result.conditionNotes,
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

  if (testCase.notesIncludes && !result.conditionNotes.includes(testCase.notesIncludes)) {
    mismatches.push(`conditionNotes: expected to include ${testCase.notesIncludes}`);
  }

  for (const value of testCase.rawTextNotIncludes || []) {
    if (result.conditionRawText.includes(value)) {
      mismatches.push(`conditionRawText: expected not to include ${value}`);
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
