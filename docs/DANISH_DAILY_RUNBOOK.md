# Danish 自动日更 V1

统一入口是 `scripts/run-danish-auto-publish.ps1`，核心编排器是
`scripts/inventory/run-danish-daily-v1.mjs`。入口复用从 V17 演进而来的
`scripts/collect-danish-full-v18.mjs`，以及正式转换器
`scripts/convert-danish-full-v18-to-products.mjs`。

采集结果按 RunId 保存在 `data/raw/danish-full-refresh/<RunId>/`。详情输出
`details.json` 同时是续跑输入；采集器每 10 条写一次 `details.partial.json`，
并在 checkpoint 时刷新 `details.json`。Chrome profile 固定为
`data/runtime/danish-browser-profile`。

## 运行模式

不带模式参数时默认执行安全的 DryRun，不会写 Production、build、commit 或 push。

```powershell
& .\scripts\run-danish-auto-publish.ps1 -DryRun `
  -RawRoot '.\data\raw\danish-full-refresh\danish-v18-list-20260715-02'
```

只采集并验收，不转换或发布：

```powershell
& .\scripts\run-danish-auto-publish.ps1 -CollectOnly -RunId 'danish-daily-YYYYMMDD-01'
```

采集、转换、备份 Production、写入、重建 Unified/Public 并 build；不 commit/push：

```powershell
& .\scripts\run-danish-auto-publish.ps1 -Daily -RunId 'danish-daily-YYYYMMDD-01'
```

完成 Daily 全部步骤并在成功后显式 commit/push：

```powershell
& .\scripts\run-danish-auto-publish.ps1 -Publish -RunId 'danish-daily-YYYYMMDD-01'
```

若采集中断，使用相同 RunId 重新运行。采集器会读取已有 `details.json`，跳过已经
完成的详情，并继续写原 RunId 下的 checkpoint。不要删除 raw、checkpoint 或 Chrome
profile。

## 门禁与保留规则

- 采集退出码、List/Detail JSON、非空数量、异常暴跌、稳定 ID 重复和失败详情会被汇总。
- 转换退出码、转换 JSON、数量差异和必需字段缺失会被检查。
- 单个详情失败不会删除 Production 中的旧商品；旧记录会保留并计入摘要。
- 只有 `-Publish` 会进入 Git；验证或 build 失败时不会 commit/push。
- Danish 锁位于 `data/inventory/state/danish-daily.lock`，只记录 PID、开始时间和模式。
- 每次运行日志位于 `data/logs/danish-daily-YYYYMMDD-HHmmss.log`，运行摘要位于
  `data/inventory/danish-daily/<RunId>/run-summary.json`。

本脚本不会创建或启用 Windows 计划任务。第一次真实 Daily 应先人工执行离线 DryRun，
确认摘要后再显式使用 `-Daily`。
