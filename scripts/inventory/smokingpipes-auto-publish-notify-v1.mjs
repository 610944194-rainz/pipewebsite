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

export function buildAutoPublishNotification(report = {}) {
  const status = text(report.status) || "unknown";
  const title = "烟斗派库存发布｜Smokingpipes";
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

export async function notifyAutoPublishReport({ reportPath, dryRun = false } = {}) {
  const resolvedPath = path.resolve(String(reportPath || ""));
  const report = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  const message = buildAutoPublishNotification(report);
  return {
    ...(await sendPushDeerNotification({
      title: message.title,
      body: message.body,
      dryRun,
    })),
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
  });
  console.log(JSON.stringify(result, null, 2));
}
