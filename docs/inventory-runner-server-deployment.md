# 库存自动化 Runner 服务器部署方案

本文规划如何把烟斗派 / YandouBuy 库存自动化 Runner 从本地 Windows 迁移到长期运行的服务器。本文只描述部署架构和未来演进路线，不代表当前 V1 已开放正式 `apply`、自动 commit 或自动 deploy。

当前 Runner 的安全默认值保持不变：

- 默认 `--mode=dry-run`
- 默认不 apply
- 默认不 commit
- 默认不 deploy
- 正式 `--mode=apply` 在 V1 中仍未实现
- `--commit` 在 V1 中只记录意图，不执行 Git 操作

## 一、总体架构

推荐的最终数据流如下：

```text
服务器库存 Runner
  → 每日抓取库存列表和新增详情
  → 生成 current-list / diff / recent-new / report
  → 执行完整性与安全校验
  → apply 更新生产数据
  → 重新生成 public-products / featured
  → npm run build
  → 检查 Git 变更白名单
  → commit 并 push 到 GitHub
  → Vercel 通过 GitHub 集成自动部署
```

这套架构应把“抓取执行环境”和“网站部署平台”分开：

- 服务器 Runner 负责需要长期浏览器 profile、断点续跑和偶发人工干预的抓取任务。
- GitHub 保存经过校验的数据与代码变更，保留审计记录。
- Vercel 只消费 GitHub 中已经通过安全检查的结果并部署网站。
- GitHub Actions 适合今日精选、汇率、build、validate 和不需要 CAPTCHA 的库存来源。
- Smokingpipes 等可能出现 CAPTCHA 的来源，不适合作为 GitHub Actions 中完全无人值守的抓取源。GitHub Actions 是临时运行环境，难以长期保存可信浏览器 profile，也不适合等待远程人工处理 CAPTCHA。

第一阶段推荐使用 Windows 云服务器。它与当前开发和人工验证环境最接近，可通过远程桌面观察 Edge/Chrome，并保留 `.cache` 下的浏览器 profile。Linux VPS 可作为后续低成本运行环境，优先承载无 CAPTCHA 或风险较低的来源。

## 二、部署方案 A：Windows 云服务器

### 适用性

Windows 云服务器是第一阶段正式化的推荐方案：

- 与当前本地 Windows、PowerShell、Edge 环境接近。
- 可通过远程桌面直接处理 CAPTCHA。
- 可保留浏览器 profile，降低每天被识别为全新设备的概率。
- 可直接使用 Windows Task Scheduler。
- 排障路径与已经验证过的本地流程基本一致。

建议选择有固定系统盘、稳定公网出口和远程桌面的云服务器。不要使用每次任务结束就销毁磁盘的临时实例。

### 需要安装的软件

- Git
- 当前项目兼容的 Node.js 版本，优先使用 Node.js 24
- Microsoft Edge 或 Google Chrome
- VS Code，可选，仅用于远程查看文件和日志

安装后确认以下命令可用：

```powershell
git --version
node --version
npm.cmd --version
```

### 克隆和安装项目

示例部署目录：

```text
C:\services\pipewebsite
```

首次准备：

```powershell
cd C:\services
git clone <repository-url> pipewebsite
cd C:\services\pipewebsite
npm ci
node scripts/inventory/run-inventory-automation-v1.mjs --help
npm.cmd run build
```

服务器仓库应保持工作区可审计。不要在同一目录中混入人工下载文件、截图或其他无关资料。

### 浏览器 profile

Runner 使用持久浏览器 profile 保存已经完成的正常浏览器验证状态。建议保留默认目录：

```text
C:\services\pipewebsite\.cache\smokingpipes-profile
```

要求：

- `.cache/` 必须处于 `.gitignore`。
- 不要把 profile 放进 OneDrive、Git 仓库、构建产物或备份压缩包。
- 不要复制 profile 到不受信任的设备。
- 不要在报告中输出 cookie、token 或浏览器存储内容。
- 服务器磁盘备份如包含 profile，应按敏感数据处理并限制访问。

如果需要自定义目录，可在任务运行账户的环境中设置 `SMOKINGPIPES_USER_DATA_DIR`，但路径仍应位于受保护、不会提交的服务器本地目录。

### Git 身份与 push 凭证

未来启用自动 commit 前，为专用运行账户配置 Git 身份：

```powershell
git config --global user.name "YandouBuy Inventory Bot"
git config --global user.email "inventory-bot@example.invalid"
```

push 凭证可选择：

- GitHub fine-grained personal access token，只授予目标仓库最小的 Contents 写权限。
- 专用 GitHub App 安装令牌。
- 仓库 deploy key；如需 push，必须明确允许写入。

安全要求：

- 不要把 token 写入仓库、脚本参数、Markdown 报告或普通日志。
- 优先使用 Windows Credential Manager、Git Credential Manager 或服务器密钥存储。
- 不要把个人高权限 GitHub token 直接用于自动化。
- 定期轮换凭证，并保留撤销方式。
- V1 尚未执行自动 commit；配置凭证不等于立即开放写入。

### Windows Task Scheduler

第一阶段只配置 dry-run：

```text
程序：
C:\Program Files\nodejs\node.exe

参数：
scripts/inventory/run-inventory-automation-v1.mjs --source=smokingpipes --mode=dry-run --max-pages=107 --allow-manual-verification=true --max-new-details-per-run=100 --no-commit --no-deploy

起始目录：
C:\services\pipewebsite
```

建议设置：

- 每天在业务低峰时间运行。
- 选择“仅在用户登录时运行”，确保 CAPTCHA 出现时浏览器窗口可见。
- 不要隐藏任务。
- 设置“如果任务已在运行，则不要启动新实例”。
- 错过计划时间后可尽快补跑。
- 失败重试间隔建议至少 30 分钟，避免连续触发站点风控。
- 使用独立、低权限的 Windows 运行账户。
- 不要立即配置 `--mode=apply` 或 `--commit`。

### 状态、队列与报告

日常检查位置：

- 状态：`data/inventory/state/smokingpipes-inventory-state.json`
- 运行锁：`data/inventory/state/smokingpipes.lock`
- 新增详情队列：`data/inventory/smokingpipes-new-details-queue.json`
- 最新报告：`data/review/smokingpipes-inventory-latest-report.md`
- 历史报告：`data/review/inventory-runs/`

服务器监控可以读取状态文件中的：

- `status`
- `lastRunAt`
- `lastSuccessfulFetchAt`
- `lastSuccessfulApplyAt`
- `lastStep`
- `lastError`
- `manualActionRequired`
- `captchaRequired`

### CAPTCHA 处理流程

1. Runner 检测到 CAPTCHA 后进入 `blocked`，状态文件标记需要人工操作。
2. Runner 不更新生产数据、不 commit、不 deploy。
3. 管理员通过远程桌面连接服务器。
4. 在 Runner 打开的 Edge/Chrome 窗口中手动完成验证。
5. 不使用自动绕过方式或第三方 CAPTCHA solver。
6. 验证恢复后，Runner 继续当前任务；如果已超时，重新运行同一 dry-run 命令。
7. 检查 latest report 和详情队列，确认断点进度正常。

抓取失败、校验失败或 CAPTCHA 超时只会更新状态、队列和报告。只要没有显式进入未来的正式 apply 流程，就不会覆盖 `data/products/smokingpipes-products.json` 或 `data/generated/public-products/*`。

## 三、部署方案 B：Linux VPS

### 适用性

Linux VPS 的长期成本通常较低，服务管理、日志收集和故障恢复更标准，适合：

- 无 CAPTCHA 的库存来源。
- API、公开数据源或稳定 HTML 来源。
- build、validate、汇率、今日精选等后台任务。
- 已经验证在固定 Linux 出口和持久 profile 下运行稳定的浏览器抓取。

对 Smokingpipes 应谨慎使用：

- 数据中心 IP 可能更容易触发风控。
- 无桌面的 Chromium 指纹与当前人工验证环境不同。
- CAPTCHA 出现后，纯 SSH 环境不便人工处理。
- Xvfb、远程桌面或 VNC 会增加维护复杂度。

因此 Linux VPS 不应作为 Smokingpipes 第一阶段的默认生产环境。只有在连续 dry-run 证明验证码风险可控、且已建立安全的远程图形访问后，才考虑迁移。

### 安装 Node.js、Git 和浏览器依赖

以下为 Debian/Ubuntu 类系统示意，具体包名以服务器发行版为准：

```bash
sudo apt-get update
sudo apt-get install -y git ca-certificates curl
```

安装项目要求的 Node.js 版本后：

```bash
git clone <repository-url> /opt/yandoubuy/pipewebsite
cd /opt/yandoubuy/pipewebsite
npm ci
npx playwright install --with-deps chromium
node scripts/inventory/run-inventory-automation-v1.mjs --help
npm run build
```

生产运行账户不应使用 root。示例目录归属：

```bash
sudo chown -R inventory:inventory /opt/yandoubuy/pipewebsite
```

浏览器 profile 可保存在：

```text
/opt/yandoubuy/pipewebsite/.cache/smokingpipes-profile
```

该目录不能提交到 Git，也应限制为运行账户可读写。

### systemd service 示例

文件建议路径：

```text
/etc/systemd/system/yandoubuy-inventory.service
```

示例：

```ini
[Unit]
Description=YandouBuy Smokingpipes Inventory Dry-Run
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=inventory
Group=inventory
WorkingDirectory=/opt/yandoubuy/pipewebsite
Environment=NODE_ENV=production
Environment=SMOKINGPIPES_HEADLESS=true
ExecStart=/usr/bin/node scripts/inventory/run-inventory-automation-v1.mjs --source=smokingpipes --mode=dry-run --max-pages=107 --max-new-details-per-run=100 --no-commit --no-deploy
StandardOutput=append:/var/log/yandoubuy/inventory-runner.log
StandardError=append:/var/log/yandoubuy/inventory-runner-error.log
TimeoutStartSec=4h

[Install]
WantedBy=multi-user.target
```

日志目录需要预先创建并授予运行账户写权限：

```bash
sudo install -d -o inventory -g inventory /var/log/yandoubuy
```

对于可能需要人工 CAPTCHA 的 Smokingpipes，不要把 `SMOKINGPIPES_HEADLESS=true` 的 service 当作最终无人值守方案。出现 CAPTCHA 时，该任务应安全 blocked，由管理员改用具备远程图形界面的受控运行方式处理。

### systemd timer 示例

文件建议路径：

```text
/etc/systemd/system/yandoubuy-inventory.timer
```

示例：

```ini
[Unit]
Description=Run YandouBuy inventory automation daily

[Timer]
OnCalendar=*-*-* 06:30:00
Persistent=true
RandomizedDelaySec=10m
Unit=yandoubuy-inventory.service

[Install]
WantedBy=timers.target
```

服务器时区会影响 `OnCalendar`。部署时必须使用 `timedatectl` 确认时区，或在 timer 中显式使用 systemd 支持的时区表达方式。

启用步骤属于人工服务器配置，本项目文档不会自动执行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now yandoubuy-inventory.timer
systemctl list-timers yandoubuy-inventory.timer
```

也可使用 cron，但 systemd timer 更适合记录退出状态、限制运行账户和集中查看日志。

## 四、自动 commit 与 deploy 的未来设计

自动 commit/deploy 必须建立在正式 apply 已实现并完成独立审查之后。未来推荐流程：

1. Runner 完成完整库存列表和新增详情抓取。
2. 校验 `allowApply=true`。
3. 正式 apply 以原子方式更新生产商品数据。
4. 重新生成 `data/generated/public-products/*`。
5. 重新生成 `recent-new`。
6. 重新生成 `featured`。
7. 运行所有数据 validate 和 `npm run build`。
8. 使用 Git 白名单检查变更范围。
9. 只暂存预期的数据和报告文件。
10. 创建自动化 commit。
11. push 到 `origin main`。
12. Vercel 通过 GitHub 集成自动构建和部署。

示意命令仅代表未来接口目标：

```text
node scripts/inventory/run-inventory-automation-v1.mjs --source=smokingpipes --mode=apply --max-pages=107 --max-new-details-per-run=100 --commit --no-deploy
```

当前 V1 执行这条命令会拒绝正式 apply，这是预期安全行为。

未来开放 commit 前必须同时满足：

- 用户显式传入 `--mode=apply --commit`。
- 完整扫描预期的 107 页。
- current list 通过最低数量和覆盖率门禁。
- disappeared 数量和比例未超过安全阈值。
- suspicious 记录未触发阻断。
- 所有新增商品详情已完成，无详情缺口。
- diff、数据 validate 和 build 全部通过。
- apply 后重新读取生产数据并验证成功。
- Git 变更仅限白名单路径。
- 不包含 `.cache`、profile、cookie、token、临时锁和 session。

任何一项失败都必须：

- 不 commit。
- 不 push。
- 不触发 Vercel 部署。
- 状态标记为 `blocked` 或 `failed`。
- 生成包含原因和建议处理方式的报告。

不建议让 Runner 直接调用 Vercel Deploy Hook。更清晰的方式是让 Runner 在安全通过后 push GitHub，由 Vercel 的 GitHub 集成负责部署。这样 commit、构建和部署记录可以互相追溯。

## 五、安全策略

### CAPTCHA

- 不自动绕过 CAPTCHA。
- 不使用第三方 CAPTCHA solver。
- CAPTCHA 出现时自动进入 `blocked`。
- 在人工验证完成前不更新生产数据。
- 超时后安全退出并保留可恢复的队列进度。

### 敏感数据

- 不提交 cookie、token、浏览器 profile。
- `.cache/` 必须加入 `.gitignore`。
- 临时 session 必须放在被忽略的目录。
- GitHub 凭证使用系统凭证管理器或密钥存储。
- 报告和日志不得打印凭证或浏览器存储内容。

### 数据完整性

- lock 防止两个 Runner 同时运行。
- 完整页数不足时禁止 apply。
- validate 失败时禁止 apply 和 commit。
- 新增详情未完成时禁止 apply。
- disappeared 异常过高时禁止 apply。
- 每次运行都必须生成独立历史报告并更新 latest report。
- 正式 apply 应使用临时文件、校验和原子替换，并保留可回滚版本。

### 人工审批

即使状态达到 `apply-ready`，也只表示安全门禁通过，不等于已经 apply。自动化成熟前，应由人工检查：

- current-list 数量和页数
- new / stillAvailable / disappeared / suspicious
- 详情队列完成度
- warnings 和 errors
- 预计变更文件
- apply-dry-run 生成的 next 数据

确认无误后再单独批准正式 apply。

## 六、推荐落地路线

### 阶段 1：本地 Windows dry-run

- 使用 Windows Task Scheduler 每日 dry-run。
- 验证浏览器 profile、CAPTCHA、断点续跑、锁和报告。
- 不 apply、不 commit、不 deploy。

### 阶段 2：Windows 云服务器 dry-run 运行 1–2 周

- 使用固定服务器和固定运行账户。
- 每天审阅状态和 latest report。
- 记录 CAPTCHA 出现频率、运行时长、失败原因和网络稳定性。
- 确认服务器重启后任务、profile 和队列仍可恢复。

### 阶段 3：启用 apply-dry-run

- 只生成 `smokingpipes-products-next-dry-run.json` 和 `public-products-next`。
- 与现有生产数据做结构、数量、价格和品牌差异审阅。
- 不覆盖生产路径。

### 阶段 4：人工确认后手动 apply

- 先实现并审查正式 apply。
- 每次由人工读取报告并显式执行。
- apply 后运行全套 validate 和 build。
- 保留备份和回滚步骤。

### 阶段 5：自动 apply、commit 和 Vercel deploy

- 仅在连续稳定运行并通过审计后开放。
- 使用显式 `--mode=apply --commit`。
- 限制 Git 变更白名单。
- 由 Vercel GitHub 集成部署。
- 增加失败通知和部署后检查。

### 阶段 6：拆分不同来源的运行平台

- 无 CAPTCHA 来源迁移到 GitHub Actions 或 Linux runner。
- 今日精选、汇率、build validate 保留在 GitHub Actions。
- Smokingpipes 继续由可保留 profile、可远程人工验证的服务器 Runner 承担，直到确认 Linux 环境同样稳定。

## 七、需要人工配置的内容

以下工作不会由仓库代码自动完成：

- 购买和续费 Windows 云服务器或 Linux VPS。
- 配置防火墙、系统更新、磁盘备份和远程访问。
- 安装 Node.js、Git、Edge/Chrome 或 Playwright/Chromium 依赖。
- 克隆仓库并执行 `npm ci`。
- 创建专用低权限运行账户。
- 配置 Git 用户身份。
- 创建并安全保存 GitHub token、GitHub App 凭证或 deploy key。
- 配置 Windows Task Scheduler、systemd timer 或 cron。
- 配置日志目录和日志轮转。
- 配置 Vercel GitHub 集成及生产分支。
- 配置远程桌面、VNC 或其他受控图形访问方式。
- 首次启动浏览器 profile并完成人工 CAPTCHA 验证。
- 定期审阅状态、报告、安全阈值和失败告警。
- 在未来首次正式 apply、自动 commit 和自动 deploy 前给予明确批准。

## 八、上线前验收清单

- 服务器连续 dry-run 至少 1–2 周。
- 服务器重启后任务可恢复。
- lock 能阻止重复运行。
- CAPTCHA 会进入 `blocked`，且生产文件保持不变。
- current list 不完整时 `allowApply=false`。
- 详情队列未完成时不能进入 apply-ready。
- apply-dry-run 只写 next 路径。
- `.cache`、session、锁和凭证不会出现在 Git 变更中。
- 每次运行都有独立报告和 latest report。
- build 和数据 validate 稳定通过。
- Git 凭证权限最小化且可撤销。
- Vercel 只从预期 GitHub 仓库和生产分支部署。
- 正式 apply、commit 和 deploy 仍有独立显式开关与人工批准记录。
