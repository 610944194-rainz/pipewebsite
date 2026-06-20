# Smokingpipes 每日库存自动化 V1

这套工具在本机运行，不依赖 Codex 长期代跑。默认只生成 dry-run、状态、队列和报告，不覆盖生产商品数据，不提交，也不部署。

## 每日运行命令

```powershell
node scripts/inventory/run-inventory-automation-v1.mjs --source=smokingpipes --mode=dry-run --max-pages=107 --allow-manual-verification=true --max-new-details-per-run=100 --no-commit --no-deploy
```

Runner 每次最多处理 100 条新增商品详情。未完成的项目保留在队列中，下一次运行会从未完成或失败项继续；已成功项目不会重复抓取。

正式生产 `apply` 在 V1 中尚未实现。即使库存安全阈值通过，只要新增详情仍未完成，状态也会是 `details-pending`，不会进入 `apply-ready`。

## 在 Windows Task Scheduler 中创建每日任务

1. 打开“任务计划程序”，选择“创建任务”。
2. “常规”：
   - 名称：`YandouBuy Smokingpipes Inventory V1`
   - 选择仅在用户登录时运行。这样遇到 CAPTCHA 时可看到 Edge 窗口并人工处理。
   - 不要勾选隐藏任务。
3. “触发器”：
   - 新建每日触发器，选择业务低峰时间。
   - 可启用“如果错过计划时间，尽快运行”。
4. “操作”：
   - 程序或脚本：Node.js 的完整路径，例如 `C:\Program Files\nodejs\node.exe`
   - 添加参数：

```text
scripts/inventory/run-inventory-automation-v1.mjs --source=smokingpipes --mode=dry-run --max-pages=107 --allow-manual-verification=true --max-new-details-per-run=100 --no-commit --no-deploy
```

   - 起始于：

```text
C:\Users\NING MEI\Desktop\pipewebsite
```

5. “设置”：
   - 启用“如果任务已在运行，则不要启动新实例”。
   - 可设置失败后重试，但不要设置过短间隔。
6. 保存后先用“运行”做一次人工观察。首次运行或站点风控变化时，可能需要在可见 Edge 窗口中完成人工验证。

Runner 自身也使用 `data/inventory/state/smokingpipes.lock` 防止重复运行。进程正常结束会删除锁；异常断电可能留下旧锁。确认没有 Runner 进程后，才可使用 `--force-unlock`。

## 查看状态与报告

- 状态：`data/inventory/state/smokingpipes-inventory-state.json`
- 新增详情队列：`data/inventory/smokingpipes-new-details-queue.json`
- 最新报告：`data/review/smokingpipes-inventory-latest-report.md`
- 历史运行报告：`data/review/inventory-runs/`

常见状态：

- `running`：任务正在运行。
- `blocked`：CAPTCHA、安全阈值或其他可恢复条件阻止继续。
- `failed`：网络、解析或文件错误导致失败。
- `details-pending`：库存列表已通过，但新增详情仍需分批抓取。
- `dry-run-ready`：dry-run 已完成，但尚未满足 apply 条件。
- `apply-ready`：列表、验证和详情队列全部通过；仍不代表已经 apply。

## 遇到 CAPTCHA

当报告或状态显示 `manualActionRequired: true`、`captchaRequired: true`：

1. 保持 Runner 和它打开的 Edge 窗口运行。
2. 在该窗口中手动完成验证。
3. Runner 会轮询页面并继续。
4. 不要使用第三方打码服务，也不要复制、上传或提交浏览器 profile、cookie、token。
5. 如果验证超时，Runner 会安全退出并保留队列进度，不覆盖生产数据。稍后重新运行同一每日命令即可。

浏览器 profile 位于项目 `.cache/` 下，并已由 Git 忽略。

## apply-dry-run

当完整 107 页、库存校验和所有新增详情都完成后，可以单独运行：

```powershell
node scripts/inventory/run-inventory-automation-v1.mjs --source=smokingpipes --mode=apply-dry-run --max-pages=107 --allow-manual-verification=true --max-new-details-per-run=100 --no-commit --no-deploy
```

只有所有安全门都通过时，才会生成隔离候选：

- `data/products/smokingpipes-products-next-dry-run.json`
- `data/generated/public-products-next/`
- `data/review/smokingpipes-apply-dry-run-report-v1.md`

这些文件不是生产数据。V1 的 `--mode=apply` 会直接拒绝执行。

## 为什么不直接用 GitHub Actions 抓 Smokingpipes

Smokingpipes 可能要求 CAPTCHA，并依赖长期存在的本机浏览器 profile 和偶发人工操作。GitHub Actions 的临时、无人值守运行环境无法可靠处理这两点，也不应保存敏感浏览器状态。

适合放在 GitHub Actions 的任务包括：

- 今日精选生成与验证
- 汇率更新
- build 与数据 validate
- 不需要 CAPTCHA 的库存来源

## 后续扩展 commit 与 deploy

Runner 已接受 `--commit` 意图参数，但 V1 会记录 warning，不执行 Git 操作；deploy 同样保持关闭。后续必须在以下条件具备后单独实现和审批：

1. 正式 apply 的数据映射、原子替换和回滚方案经过审查。
2. apply 前后生产数据校验通过。
3. commit 只包含明确白名单文件。
4. deploy 有独立开关、失败回滚和通知机制。
5. 用户明确批准首次正式 apply、commit 和 deploy。
