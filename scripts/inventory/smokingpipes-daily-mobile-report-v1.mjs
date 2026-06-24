import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sendPushDeerNotification } from "./inventory-pushdeer-notifier-v1.mjs";

const DEFAULT_STATE_PATH = path.join(
  process.cwd(),
  "data",
  "inventory",
  "smokingpipes-progressive-daily-state.json"
);
const DEFAULT_AUDIT_PATH = path.join(
  process.cwd(),
  "data",
  "review",
  "smokingpipes-progressive-partial-audit-report.json"
);
const DEFAULT_REPORT_JSON_PATH = path.join(
  process.cwd(),
  "data",
  "review",
  "smokingpipes-daily-mobile-report.json"
);
const DEFAULT_REPORT_MD_PATH = path.join(
  process.cwd(),
  "data",
  "review",
  "smokingpipes-daily-mobile-report.md"
);
const DEFAULT_ENV_PATH = path.join(process.cwd(), ".env.inventory.local");

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function countBy(items, predicate) {
  return toArray(items).filter(predicate).length;
}

function countNewProducts(items, predicate) {
  return countBy(
    items,
    (item) =>
      toArray(item?.changeTypes).includes("new-product") &&
      predicate(item)
  );
}

function getAuditStatus(audit) {
  return normalizeText(audit?.auditStatus || audit?.verdict || "").toUpperCase();
}

function getAuditCounts(audit) {
  return audit?.counts && typeof audit.counts === "object"
    ? audit.counts
    : {};
}

function deriveStatus({ state, audit }) {
  const auditStatus = getAuditStatus(audit);
  const blockers = toArray(audit?.blockers);
  const blockedReason = normalizeText(state?.blockedReason);
  const blocked =
    state?.listSnapshotStatus === "blocked" ||
    state?.captchaDetected ||
    state?.verificationDetected ||
    /captcha|verification|cloudflare|profile|blocked/i.test(blockedReason);

  if (blocked) {
    return "blocked";
  }

  if (auditStatus === "FAIL" || blockers.length > 0) {
    return "failed";
  }

  if (auditStatus === "PASS" && audit?.productionWritten) {
    return "success";
  }

  return "partial";
}

export function buildSmokingpipesDailyMobileReport({
  state,
  audit,
  runAt = new Date().toISOString(),
  notification = {},
} = {}) {
  const candidates = toArray(state?.candidates);
  const counts = getAuditCounts(audit);
  const blockers = toArray(audit?.blockers);
  const warnings = toArray(audit?.warnings);
  const stateBlockedReason = normalizeText(state?.blockedReason);

  if (stateBlockedReason && blockers.length === 0) {
    blockers.push(stateBlockedReason);
  }

  const candidateCount =
    Number.isFinite(audit?.candidateCount)
      ? audit.candidateCount
      : candidates.length;
  const wouldApplyCount =
    Number.isFinite(audit?.wouldApplyCount) ? audit.wouldApplyCount : 0;

  return {
    source: "smokingpipes",
    status: deriveStatus({ state, audit }),
    runAt,
    candidateCount,
    wouldApplyCount,
    productionWritten: Boolean(audit?.productionWritten),
    newProductReady:
      Number.isFinite(audit?.newProductReady)
        ? audit.newProductReady
        : countNewProducts(
            candidates,
            (item) => item?.publicStatus === "ready"
          ),
    newProductReviewOnly:
      Number.isFinite(audit?.newProductReviewOnly)
        ? audit.newProductReviewOnly
        : countNewProducts(
            candidates,
            (item) => item?.publicStatus === "review-only"
          ),
    newProductNotReady:
      Number.isFinite(audit?.newProductNotReady)
        ? audit.newProductNotReady
        : countNewProducts(
            candidates,
            (item) =>
              item?.publicStatus !== "ready" &&
              item?.publicStatus !== "review-only"
          ),
    detailComplete: countBy(
      candidates,
      (item) => item?.detailStatus === "complete"
    ),
    detailFailed: countBy(
      candidates,
      (item) => item?.detailStatus === "failed"
    ),
    detailPending: countBy(
      candidates,
      (item) => item?.detailStatus === "pending"
    ),
    publicReady: countBy(
      candidates,
      (item) => item?.publicStatus === "ready"
    ),
    publicReviewOnly: countBy(
      candidates,
      (item) => item?.publicStatus === "review-only"
    ),
    publicNotPublic: countBy(
      candidates,
      (item) => item?.publicStatus === "not-public"
    ),
    blockers,
    warnings,
    auditStatus: getAuditStatus(audit) || null,
    auditCounts: {
      deletedProducts: Number(counts.deletedProducts || 0),
      pendingLeak: Number(counts.pendingLeak || 0),
      failedLeak: Number(counts.failedLeak || 0),
      blockedLeak: Number(counts.blockedLeak || 0),
      reviewOnlyLeak: Number(counts.reviewOnlyLeak || 0),
      zeroPriceSellable: Number(counts.zeroPriceSellable || 0),
    },
    notificationSent: Boolean(notification.notificationSent),
    notificationSkipped: Boolean(notification.notificationSkipped),
    notificationReason: notification.notificationReason || "not requested",
  };
}

function statusLabel(status) {
  if (status === "success") return "成功";
  if (status === "partial") return "部分完成";
  if (status === "blocked") return "需要人工处理";
  if (status === "failed") return "失败";
  return status || "未知";
}

export function buildPushDeerDailyMessage(report) {
  const blockedText =
    report.blockers?.length > 0 ? report.blockers.join("; ") : "无";

  return {
    title: "烟斗派库存日报｜Smokingpipes",
    body: [
      `状态：${statusLabel(report.status)}`,
      `候选：${report.candidateCount}`,
      `已应用：${report.productionWritten ? report.wouldApplyCount : 0}`,
      `新增可公开：${report.newProductReady}`,
      `人工复核：${report.newProductReviewOnly}`,
      `失败保留：${report.detailFailed}`,
      `未完成：${report.detailPending}`,
      `阻断：${blockedText}`,
      "详情：data/review/smokingpipes-daily-mobile-report.md",
    ].join("\n"),
  };
}

function buildMarkdownReport(report) {
  const blockers = report.blockers.length
    ? report.blockers.map((item) => `- ${item}`).join("\n")
    : "- 无";
  const warnings = report.warnings.length
    ? report.warnings.map((item) => `- ${item}`).join("\n")
    : "- 无";

  return `# Smokingpipes 每日库存手机报告

- 状态：${statusLabel(report.status)}
- 运行时间：${report.runAt}
- 候选：${report.candidateCount}
- 可应用：${report.wouldApplyCount}
- 已写入 production：${report.productionWritten ? "是" : "否"}
- 新增可公开：${report.newProductReady}
- 人工复核：${report.newProductReviewOnly}
- 新品未就绪：${report.newProductNotReady}
- 详情完成：${report.detailComplete}
- 详情失败：${report.detailFailed}
- 详情待处理：${report.detailPending}
- public ready：${report.publicReady}
- public review-only：${report.publicReviewOnly}
- public not-public：${report.publicNotPublic}
- 通知已发送：${report.notificationSent ? "是" : "否"}
- 通知已跳过：${report.notificationSkipped ? "是" : "否"}
- 通知原因：${report.notificationReason}

## 阻断

${blockers}

## Warning

${warnings}
`;
}

function parseArgs(argv) {
  return {
    send: argv.includes("--send"),
    dryRunNotify: argv.includes("--dry-run-notify"),
  };
}

function loadInventoryEnv(filePath = DEFAULT_ENV_PATH) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");

    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

export async function runSmokingpipesDailyMobileReport({
  argv = process.argv.slice(2),
  now = new Date().toISOString(),
  statePath = DEFAULT_STATE_PATH,
  auditPath = DEFAULT_AUDIT_PATH,
  reportJsonPath = DEFAULT_REPORT_JSON_PATH,
  reportMarkdownPath = DEFAULT_REPORT_MD_PATH,
} = {}) {
  const options = parseArgs(argv);
  loadInventoryEnv();

  const missingInputs = [];
  const state = readJsonIfExists(statePath);
  const audit = readJsonIfExists(auditPath);

  if (!state) missingInputs.push(statePath);
  if (!audit) missingInputs.push(auditPath);

  const initialReport = buildSmokingpipesDailyMobileReport({
    runAt: now,
    state: state || {
      source: "smokingpipes",
      listSnapshotStatus: "blocked",
      blockedReason: `missing input: ${missingInputs.join(", ")}`,
      candidates: [],
    },
    audit: audit || {
      auditStatus: "FAIL",
      blockers: missingInputs.map((item) => `missing input: ${item}`),
      warnings: [],
      productionWritten: false,
    },
  });
  const message = buildPushDeerDailyMessage(initialReport);
  const notification =
    options.send || options.dryRunNotify
      ? await sendPushDeerNotification({
          title: message.title,
          body: message.body,
          dryRun: options.dryRunNotify,
        })
      : {
          notificationSent: false,
          notificationSkipped: true,
          notificationReason: "not requested",
        };
  const report = {
    ...initialReport,
    notificationSent: Boolean(notification.notificationSent),
    notificationSkipped: Boolean(notification.notificationSkipped),
    notificationReason: notification.notificationReason || "not requested",
  };

  fs.mkdirSync(path.dirname(reportJsonPath), { recursive: true });
  fs.writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(reportMarkdownPath, buildMarkdownReport(report), "utf8");

  return {
    report,
    message,
    notification,
    paths: {
      reportJsonPath,
      reportMarkdownPath,
    },
  };
}

export function isDirectCliInvocation({
  importMetaUrl = import.meta.url,
  argv1 = process.argv[1],
} = {}) {
  return Boolean(argv1) && importMetaUrl === pathToFileURL(argv1).href;
}

if (isDirectCliInvocation()) {
  runSmokingpipesDailyMobileReport()
    .then((result) => {
      console.log(JSON.stringify(result.report, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
