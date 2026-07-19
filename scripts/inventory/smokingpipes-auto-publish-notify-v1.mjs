import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { sendPushDeerNotification } from "./inventory-pushdeer-notifier-v1.mjs";

function parseArgs(argv = process.argv.slice(2)) {
  return new Map(
    argv
      .filter((value) => value.startsWith("--"))
      .map((value) => {
        const [key, ...parts] = value.slice(2).split("=");
        return [key, parts.join("=") || true];
      })
  );
}

function text(value) {
  return String(value || "").trim();
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validTimestamp(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function validateAutoPublishNotificationReport({
  report,
  expectedRunId,
  invocationStartedAt,
  taskState,
} = {}) {
  const expectedStart = validTimestamp(invocationStartedAt);
  const reportStart = validTimestamp(report?.startedAt);
  const reportCompleted = validTimestamp(report?.completedAt);

  if (!text(expectedRunId) || text(report?.runId) !== text(expectedRunId)) {
    return { allowed: false, reason: "stale-report-blocked: runId mismatch" };
  }
  if (!expectedStart || !reportStart || !reportCompleted || reportStart < expectedStart || reportCompleted < reportStart) {
    return { allowed: false, reason: "stale-report-blocked: invocation timestamp mismatch" };
  }
  if (text(taskState?.lastNotificationRunId) === text(expectedRunId)) {
    return { allowed: false, reason: "notification-already-sent-for-run" };
  }
  return { allowed: true, reason: "current-invocation" };
}

function markNotificationSent(taskStatePath, taskState, runId) {
  if (!taskStatePath || !taskState || !text(runId)) return;
  const nextState = { ...taskState, lastNotificationRunId: text(runId) };
  fs.writeFileSync(taskStatePath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
}

export function buildAutoPublishNotification(report = {}) {
  const status = text(report.status) || "unknown";
  const title = "烟斗派库存发布｜Smokingpipes";
  if (status === "no-production-change") {
    return {
      title: "烟斗派库存日更｜Smokingpipes",
      body: [
        "状态：今日检查完成，无库存变化",
        "Production：未写入",
        "提交：无",
        "推送：无",
        "阻断：无",
      ].join("\n"),
    };
  }
  const body = [
    `状态：${status}`,
    `候选：${Number(report.candidateCount || 0)}`,
    `拟应用：${Number(report.wouldApplyCount || 0)}`,
    `实际应用：${Number(report.appliedCount || 0)}`,
    `production 写入：${report.productionWritten === true ? "是" : "否"}`,
    `提交：${report.commitPerformed === true ? "是" : "否"}`,
    `推送：${report.pushPerformed === true ? "是" : "否"}`,
    `部署状态：${text(report.deploymentStatus) || "未验证"}`,
    `阻断：${text(report.failureReason) || "无"}`,
  ].join("\n");
  return { title, body };
}

export async function notifyAutoPublishReport({
  reportPath,
  dryRun = false,
  expectedRunId = "",
  invocationStartedAt = "",
  taskStatePath = "",
} = {}) {
  const resolvedPath = path.resolve(String(reportPath || ""));
  const report = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  const resolvedTaskStatePath = taskStatePath
    ? path.resolve(String(taskStatePath))
    : "";
  const taskState = readJsonIfExists(resolvedTaskStatePath);
  const validation = validateAutoPublishNotificationReport({
    report,
    expectedRunId,
    invocationStartedAt,
    taskState,
  });
  if (!validation.allowed) {
    return {
      notificationSent: false,
      notificationSkipped: true,
      notificationReason: validation.reason,
      reportPath: resolvedPath,
    };
  }
  const message = buildAutoPublishNotification(report);
  const notification = await sendPushDeerNotification({
    title: message.title,
    body: message.body,
    dryRun,
  });
  if (notification.notificationSent) {
    markNotificationSent(resolvedTaskStatePath, taskState, expectedRunId);
  }
  return {
    ...notification,
    reportPath: resolvedPath,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs();
  if (!args.has("report")) {
    throw new Error("--report=PATH is required");
  }
  const result = await notifyAutoPublishReport({
    reportPath: args.get("report"),
    dryRun: args.has("dry-run"),
    expectedRunId: args.get("expected-run-id") || "",
    invocationStartedAt: args.get("invocation-started-at") || "",
    taskStatePath: args.get("task-state") || "",
  });
  console.log(JSON.stringify(result, null, 2));
}
