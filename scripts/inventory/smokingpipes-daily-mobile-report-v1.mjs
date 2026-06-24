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
const DEFAULT_TASK_LOG_PATH = path.join(
  process.cwd(),
  "data",
  "review",
  "smokingpipes-daily-task-latest.log"
);

const VERIFICATION_PATTERN =
  /strong verification detected|captcha\/currentlistverificationdetected|current-list verification was detected|verification detected|captcha\s+(?:detected|required|blocked|challenge)|cloudflare|manual verification|profile blocked|\bblocked\b/i;
const BENIGN_VERIFICATION_PATTERN =
  /"?(?:captchaDetected|verificationDetected|verificationDetectedAt|manualVerificationRecovered|weakVerificationDetected)"?\s*:\s*(?:false|null)/i;

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readTextIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return "";
  }

  const buffer = fs.readFileSync(filePath);
  const utf8Text = buffer.toString("utf8").replace(/\u0000/g, "");
  const utf16Text =
    buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff
      ? Buffer.from(buffer).swap16().toString("utf16le")
      : buffer.toString("utf16le");

  return `${utf8Text}\n${utf16Text}`.replace(/\ufeff/g, "");
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

function findVerificationBlocker({ state, audit, taskLogText }) {
  const blockers = toArray(audit?.blockers).map(normalizeText).filter(Boolean);
  const candidates = [
    taskLogText,
    state?.blockedReason,
    state?.status,
    ...blockers,
  ]
    .map((candidate) => String(candidate || "").replace(/\u0000/g, ""))
    .filter(Boolean);

  for (const candidate of candidates) {
    const match = candidate.match(VERIFICATION_PATTERN);

    if (match) {
      const failedLine = candidate
        .split(/\r?\n/)
        .map(normalizeText)
        .find(
          (line) =>
            VERIFICATION_PATTERN.test(line) &&
            !BENIGN_VERIFICATION_PATTERN.test(line)
        );

      return failedLine || normalizeText(match[0]);
    }
  }

  if (
    state?.listSnapshotStatus === "blocked" ||
    state?.captchaDetected ||
    state?.verificationDetected ||
    state?.verificationDetectedAt
  ) {
    return normalizeText(state?.blockedReason) || "Smokingpipes verification detected";
  }

  return "";
}

function deriveStatus({ state, audit, taskLogText }) {
  const auditStatus = getAuditStatus(audit);
  const blockers = toArray(audit?.blockers);
  const verificationBlocker = findVerificationBlocker({
    state,
    audit,
    taskLogText,
  });

  if (verificationBlocker || blockers.length > 0) {
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
  taskLogText = "",
  runAt = new Date().toISOString(),
  notification = {},
} = {}) {
  const candidates = toArray(state?.candidates);
  const counts = getAuditCounts(audit);
  const blockers = [...toArray(audit?.blockers)];
  const warnings = toArray(audit?.warnings);
  const stateBlockedReason = normalizeText(state?.blockedReason);
  const verificationBlocker = findVerificationBlocker({
    state,
    audit,
    taskLogText,
  });

  if (verificationBlocker && !blockers.includes(verificationBlocker)) {
    blockers.unshift(verificationBlocker);
  }
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
    status: deriveStatus({ state, audit, taskLogText }),
    runAt,
    pagesScanned: Number(state?.pagesScanned || 0),
    expectedPages: Number(state?.expectedPages || 0),
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
  if (status === "success") return "已更新";
  if (status === "partial") return "安全预览";
  if (status === "blocked") return "需要人工验证";
  if (status === "failed") return "失败";
  return status || "未知";
}

export function buildPushDeerDailyMessage(report) {
  const blockedText =
    report.blockers?.length > 0 ? report.blockers.join("; ") : "无";
  const scanText =
    report.pagesScanned && report.expectedPages
      ? `${report.pagesScanned}/${report.expectedPages} 页`
      : "未知";
  const unfinished =
    Number(report.detailPending || 0) +
    Math.max(
      0,
      Number(report.publicNotPublic || 0) - Number(report.detailFailed || 0)
    );
  const nextStep =
    report.status === "blocked"
      ? [
          "",
          "下一步：",
          "请在电脑上完成 Smokingpipes 验证，之后任务会继续。",
        ]
      : [];

  return {
    title: "烟斗派库存日报｜Smokingpipes",
    body: [
      "烟斗派库存日报｜Smokingpipes",
      "",
      `状态：${statusLabel(report.status)}`,
      `扫描：${scanText}`,
      `候选：${report.candidateCount}`,
      `已应用：${report.productionWritten ? report.wouldApplyCount : 0}`,
      `新增可公开：${report.newProductReady}`,
      `人工复核：${report.newProductReviewOnly}`,
      `失败保留：${report.detailFailed}`,
      `未完成：${unfinished}`,
      `阻断：${blockedText}`,
      ...nextStep,
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
- 扫描：${
    report.pagesScanned && report.expectedPages
      ? `${report.pagesScanned}/${report.expectedPages} 页`
      : "未知"
  }
- 候选：${report.candidateCount}
- 已应用：${report.productionWritten ? report.wouldApplyCount : 0}
- 已写入 production：${report.productionWritten ? "是" : "否"}
- 新增可公开：${report.newProductReady}
- 人工复核：${report.newProductReviewOnly}
- 未完成：${report.detailPending}
- 详情完成：${report.detailComplete}
- 失败保留：${report.detailFailed}
- 可公开库存：${report.publicReady}
- 需人工复核：${report.publicReviewOnly}
- 安全排除：${report.publicNotPublic}
- 通知已发送：${report.notificationSent ? "是" : "否"}
- 通知已跳过：${report.notificationSkipped ? "是" : "否"}
- 通知原因：${report.notificationReason}
- PowerShell 推荐查看命令：Get-Content "data\\review\\smokingpipes-daily-mobile-report.md" -Encoding utf8

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
  taskLogPath = DEFAULT_TASK_LOG_PATH,
  reportJsonPath = DEFAULT_REPORT_JSON_PATH,
  reportMarkdownPath = DEFAULT_REPORT_MD_PATH,
} = {}) {
  const options = parseArgs(argv);
  loadInventoryEnv();

  const missingInputs = [];
  const state = readJsonIfExists(statePath);
  const audit = readJsonIfExists(auditPath);
  const taskLogText = readTextIfExists(taskLogPath);

  if (!state) missingInputs.push(statePath);
  if (!audit) missingInputs.push(auditPath);

  const initialReport = buildSmokingpipesDailyMobileReport({
    runAt: now,
    taskLogText,
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
  fs.writeFileSync(reportMarkdownPath, `\ufeff${buildMarkdownReport(report)}`, "utf8");

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
