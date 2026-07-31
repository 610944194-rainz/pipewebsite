# Smokingpipes 自动日更架构 V2 设计稿

**项目：** 烟斗派 / YandouBuy
**设计目标：** 合理、清晰、可恢复、不重复抓取、不丢失进度、不漏算变更、失败可重试、运行目录始终干净。
**适用范围：** Smokingpipes 新斗库存自动日更。
**设计基线：** `origin/main` 当前 V1 自动发布链路。

---

## 1. 结论先行

V2 不再把“采集、详情补全、候选生成、Production 写入、全局开发测试、网站构建、Git 提交推送”绑在同一个可回滚事务里。

新的链路只保留三个明确边界：

1. **采集事务**：保存可信列表、详情结果和进度。成功数据永不因发布失败而回滚。
2. **候选事务**：从已持久化的采集状态与最新 Production 基线生成一个不可变发布包。
3. **发布事务**：在独立 release clone 中应用发布包、验证、构建、提交和推送。失败只清理 release clone，发布包与采集进度保留。

核心流程：

```text
计划任务触发
  → 同步只读运行代码
  → 恢复或创建当日 cycle
  → 获取可信完整列表
  → 分批补齐必要详情并立即持久化
  → 所有必要详情完成或隔离
  → 基于最新 origin/main 生成不可变 release bundle
  → 独立 release clone 应用 bundle
  → 数据专用校验 + Public 校验 + 必要 build
  → 精确 commit / push
  → 标记 cycle published 或 no-change
```

失败后：

```text
采集失败      → 保留旧状态，下一窗口继续采集
详情失败      → 单商品重试/隔离，不回滚其他详情
候选生成失败  → 保留采集成果，修复后重新生成
发布验证失败  → 保留 bundle，release clone 恢复干净，下次直接重试 bundle
远端发生变化  → 不重新抓取，基于相同采集状态和新 main 重建 bundle
```

---

## 2. 当前链路的结构性问题

### 2.1 事务边界过大

当前一个运行同时承担：

- 列表抓取
- 详情抓取
- progressive state 更新
- Production 写入
- Unified/Public 重建
- validator
- `inventory-runner-test`
- Next.js build
- Git commit/push

任何后半段环境性失败都会使前半段有效采集成果被回滚。

### 2.2 生产发布门禁混入开发回归测试

`test-inventory-runner-v1.mjs` 覆盖浏览器、分页、锁、缓存、源码静态断言、转换器和大量 fixture。它适合代码提交 CI，不适合成为每次库存数据发布的运行时门禁。

### 2.3 mutable state 与 Git worktree 混放

progressive state、运行报告和 Production 文件在同一工作树内变化，导致：

- 失败后容易留下 tracked dirty files；
- preflight 被下一轮阻断；
- `git reset/restore` 可能误伤有效详情和进度；
- 运行状态与代码版本耦合。

### 2.4 发布失败后无法原样重试

当前没有稳定的不可变候选包。发布失败后往往需要重新计算甚至重新抓取，产生重复工作和输入漂移。

### 2.5 统计口径容易混淆

必须严格区分：

- observed candidates：原始观察到的候选；
- ready changes：满足规则、可生成发布包的变化；
- pending details：等待详情的商品；
- bundle changes：发布包内的商品变化；
- published changes：实际提交推送的商品变化。

不得用回滚后的 `0` 覆盖“本次准备发布 292 条但发布失败”的事实。

---

## 3. V2 设计原则

1. **采集成果只前进，不因发布失败回滚。**
2. **Production 只由不可变 bundle 写入。**
3. **运行目录不保存 mutable state。**
4. **发布失败不重新访问源站。**
5. **同一 bundle 可以幂等重试。**
6. **商品变化数由 before/after 实际差异计算，不信任过程计数。**
7. **自然任务只运行生产数据校验；开发回归测试进入 CI。**
8. **只有真实变化才执行 build、commit、push。**
9. **异常商品单独隔离，不阻断整个日更。**
10. **V2 切换后不长期双写，不保留两条正式发布链。**

---

## 4. 物理目录与职责

### 4.1 运行代码目录：只读、始终 clean

```text
C:\Users\NING MEI\Desktop\pipewebsite-smokingpipes-run
```

职责：

- 计划任务入口；
- 读取代码；
- 执行采集、详情、bundle 生成与发布编排；
- 不直接写 tracked Production；
- 正常结束和失败结束后 `git status --short` 均无输出。

### 4.2 外部状态目录：所有 mutable runtime data

```text
C:\Users\NING MEI\Desktop\pipewebsite-smokingpipes-state
```

建议结构：

```text
pipewebsite-smokingpipes-state/
├─ cycles/
│  └─ 2026-07-31/
│     ├─ cycle.json
│     ├─ list/
│     │  ├─ snapshot.json
│     │  └─ manifest.json
│     ├─ queues/
│     │  └─ details.json
│     ├─ bundles/
│     │  └─ <bundleId>/
│     └─ logs/
├─ details/
│  └─ <sourceProductId>.json
├─ absence/
│  └─ counters.json
├─ ledger/
│  ├─ published-bundles.json
│  └─ quarantined-products.json
├─ locks/
│  └─ daily.lock
└─ latest.json
```

该目录不属于 Git，不受 `reset/restore` 影响。

### 4.3 发布目录：独立 standalone clone

```text
C:\Users\NING MEI\Desktop\pipewebsite-smokingpipes-release
```

职责：

- 有自己的 `.git`，不得使用共享 worktree metadata；
- 每次发布前 fetch + reset 到 `origin/main`；
- 只应用 bundle 拥有的 tracked 文件；
- 运行生产数据校验和 build；
- 精确 commit/push；
- 失败后恢复 clean，但不删除 bundle。

---

## 5. 数据所有权矩阵

| 数据 | 唯一写入者 | 是否 Git tracked | 失败后处理 |
|---|---|---:|---|
| 当日列表 snapshot | Collector | 否 | 保留 |
| Detail cache | Detail Enricher | 否 | 保留 |
| absence counters | Collector/Reconciler | 否 | 原子保存 |
| detail queue | Cycle Orchestrator | 否 | 保留并继续 |
| quarantine ledger | Reconciler | 否 | 保留 |
| release bundle | Bundle Builder | 否 | 不可变、保留 |
| `smokingpipes-products.json` | Bundle Publisher | 是 | release clone 恢复 |
| `unified-products-staging.json` | Bundle Publisher | 是 | release clone 恢复 |
| Public generated files | Bundle Publisher | 是 | release clone 恢复 |
| `featured.json` | 现有精选任务 | 是 | Smokingpipes bundle 不覆盖 |
| 源码与测试 | 开发/CI | 是 | 不由自然任务修改 |

**硬规则：同一个文件只能有一个正式写入者。**

---

## 6. Cycle 状态机

每个本地日期最多一个活跃 cycle。

```text
new
 → collecting-list
 → list-ready
 → enriching-details
 → ready-to-bundle
 → bundle-ready
 → validating-release
 → published | no-change
```

失败状态：

```text
collection-retryable
release-retryable
manual-review-required
```

状态含义：

- `collection-retryable`：输入不可信，下一窗口重新抓列表；
- `release-retryable`：bundle 已保留，下一窗口直接重试发布，不访问源站；
- `manual-review-required`：只有全局契约异常或超过隔离阈值时使用。

同日触发优先级：

1. 有 `bundle-ready/release-retryable`：先重试发布；
2. 有 `enriching-details`：继续详情；
3. 有 `collection-retryable`：重试列表；
4. 已 `published/no-change`：快速退出；
5. 无 cycle：创建新 cycle。

---

## 7. 完整执行链路

### 7.1 Stage 0：入口与锁

1. 获取外部 owner-token lock；
2. 若另一个合法实例运行，返回 `already-running`；
3. 检查 runtime tracked worktree clean；
4. fetch `origin/main`；
5. 仅当没有活动发布时 fast-forward runtime；
6. 读取或创建当日 cycle。

锁最多一个：

```text
<StateRoot>/locks/daily.lock
```

Windows Task Scheduler 的 `MultipleInstances=IgnoreNew` 作为第二层保护，不再维护多套重叠 lock。

### 7.2 Stage 1：可信完整列表

正常日更只在 cycle 第一次成功列表采集时访问完整列表。

可信标准必须同时满足：

- page 1 非空；
- 页码连续；
- 无 Cloudflare/Verify/CAPTCHA/Access denied 等阻断特征；
- 可信分页上限；
- 正常空尾页判定；
- 商品 ID 唯一性满足阈值；
- 总量变化处于可解释范围；
- snapshot 内容与 manifest hash 一致。

不可信列表：

- 不更新 absence counters；
- 不生成下架；
- 不覆盖上一可信 snapshot；
- cycle 标记 `collection-retryable`。

可信列表成功后原子写入外部状态。

### 7.3 Stage 2：候选识别与详情队列

候选类型及规则：

#### A. 新增上架

- 列表出现、Production 不存在；
- 必须有可信详情、有效主图和有效价格；
- 缺详情进入队列；
- Falcon 在列表摄入时直接排除，不入详情队列。

#### B. 原站涨价 / 降价

- 同一商品在可信列表中的 USD 当前价变化；
- 价格可直接由列表确认时无需重新抓详情；
- 同时重算人民币参考价；
- USD 原价仅保留后台，不在前端展示。

#### C. 明确下架

- 可信列表明确 `Out of Stock`；
- 可立即下架；
- 不需要详情。

#### D. 连续消失确认下架

- 仅基于可信完整列表；
- 连续两个独立可信 snapshot 缺失后确认；
- 第一次缺失只更新 absence counter，不发布下架。

#### E. 重新上架

- 之前 sold/out-of-stock 的商品重新出现在可信列表；
- 有可复用详情和有效价格时直接恢复；
- 缺必要字段才进入详情队列。

#### F. 隔离

- 单商品解析失败、品牌冲突、价格异常、详情长期失败；
- 写入 quarantine ledger；
- 不进入 bundle；
- 不阻断其他商品。

### 7.4 Stage 3：详情补全

- 每个成功 Detail 立即原子写入 `<StateRoot>/details/<id>.json`；
- queue item 独立记录 attempts、lastError、nextRetryAt；
- 失败只影响该 ID；
- 达到重试阈值后隔离；
- 详情成功后不会因 validator/build/push 失败而删除；
- 后续触发只补 pending IDs，不重新抓已完成详情。

只有“发布所需详情全部完成或隔离”后，cycle 才进入 `ready-to-bundle`。

### 7.5 Stage 4：生成不可变 Release Bundle

Bundle Builder 读取：

- 最新 `origin/main` Production 基线；
- 当日可信列表 snapshot；
- 外部 Detail store；
- absence counters；
- quarantine rules；
- 品牌与价格规则。

Bundle ID：

```text
sha256(
  baseMainSha
  + sourceSnapshotHash
  + selectedInputHashes
  + generatorCommitSha
  + schemaVersion
)
```

建议内容：

```text
<bundleId>/
├─ manifest.json
├─ changes.json
├─ summary.json
├─ inputs/
│  ├─ list-manifest.json
│  └─ selected-detail-hashes.json
├─ outputs/
│  ├─ data/products/smokingpipes-products.json
│  ├─ data/products/unified-products-staging.json
│  └─ data/generated/public-products/...
└─ validation/
```

`manifest.json` 至少包含：

- bundleId
- cycleId
- baseMainSha
- generatorCommitSha
- sourceSnapshotHash
- selected product IDs
- change type counts
- before/after record hashes
- output file hashes
- maxAutoApply
- createdAt

Bundle 一旦生成不得原地修改。基线变化时创建新 bundle，旧 bundle 标记 `stale-base`。

### 7.6 不漏算与不重算约束

必须同时满足：

```text
selectedIds 唯一数量
= 新增 + 涨价 + 降价 + 明确下架 + 确认消失 + 重新上架 + 其他允许变化
= before/after 实际变化商品数量
= manifest.actualAppliedCount
```

同时要求：

- `selectedIds` 排序并去重；
- 每个 ID 只允许一个最终 change type；
- 首次消失不计入发布数；
- 隔离商品不计入发布数；
- Public 文件变化数量不等于商品变化数量，不得混算；
- no-op 只能由 Production 商品 before/after diff 为空得出。

### 7.7 Stage 5：独立发布

Publisher：

1. 检查 release clone clean；
2. fetch `origin/main`；
3. 若 `origin/main != bundle.baseMainSha`：
   - 不访问源站；
   - 使用相同采集状态基于新 main 重建 bundle；
4. reset release clone 到 base；
5. 校验 bundle 文件 hash；
6. 精确复制 bundle outputs；
7. 运行生产门禁；
8. 精确 stage 白名单文件；
9. commit；
10. push `HEAD:main`；
11. 写入 published ledger。

Commit message：

```text
chore(inventory): publish Smokingpipes cycle YYYY-MM-DD

Smokingpipes-Bundle-Id: <bundleId>
Smokingpipes-Applied-Count: <count>
```

幂等检查：

- ledger 已有 bundleId；或
- remote commit 中已存在同一 bundle trailer；

则不得重复提交，直接标记 published。

---

## 8. 生产门禁与 CI 分层

### 8.1 自然任务中的生产门禁

只保留与本次数据直接相关、可重复、确定性的检查：

1. `validate-smokingpipes-release-bundle-v2.mjs`
   - manifest schema；
   - hashes；
   - ID 唯一；
   - change counts；
   - before/after 一致；
   - base SHA；
   - Falcon 排除；
   - 价格、库存和公开状态规则。

2. `validate-public-product-indexes-v1.mjs`

3. `test-public-products-inventory-default-v1.mjs`

4. `git diff --check`

5. `npm.cmd run build`
   - 仅在 bundle 有真实变化时；
   - 仅在独立 release clone 中；
   - no-op、详情进度和采集失败均不运行。

### 8.2 只在代码 CI 中运行

- `test-inventory-runner-v1.mjs`
- Playwright parser tests
- 抓取分页 fixture
- 锁和缓存开发测试
- 源码静态断言
- converter/runner 全量回归

代码未变化时，不在每日 Production 发布中重复执行。

---

## 9. 失败与恢复矩阵

| 失败点 | 保留内容 | 回滚内容 | 下一窗口动作 |
|---|---|---|---|
| 列表阻断/不可信 | 上一可信状态 | 本轮临时列表 | 重新抓列表 |
| 单条 Detail 失败 | 已成功详情、队列 | 该条临时结果 | 重试该 ID |
| Detail 达阈值 | 其他全部成果 | 无 | 隔离该 ID，继续 |
| Bundle 构建失败 | 列表、详情、cycle | 临时 bundle | 修复后重新构建 |
| Bundle validator 失败 | 完整 bundle、日志 | release clone | 重试同 bundle |
| Build 失败 | 完整 bundle、日志 | release clone | 重试同 bundle |
| remote main 变化 | 采集状态、旧 bundle | release clone | 新 base 重建 bundle |
| commit 前失败 | bundle、采集状态 | release clone | 重试发布 |
| commit 后 push 失败 | 本地 commit、bundle | 不删除 commit | 仅重试 push |
| push 成功、部署失败 | Git commit、ledger | 不回滚 Git | 标记 deploy pending/failed |

**任何发布失败都不重新抓取已成功的 Detail。**

---

## 10. 计划任务行为

保留每日七个窗口：

```text
10:30 / 12:30 / 14:30 / 16:30 / 18:30 / 20:30 / 22:30
```

这些窗口是“恢复窗口”，不是七次完整日更。

行为：

- 10:30 创建 cycle 并抓列表；
- 详情未完成时，后续窗口只继续详情；
- bundle 已生成但发布失败时，后续窗口只重试 bundle；
- published/no-change 后，同日后续窗口快速跳过；
- 不重复完整列表、不重复已完成 Detail、不重复发布。

---

## 11. 通知口径

### Progress

```text
状态：enriching-details
可信列表：成功
观察候选：340
待详情：48
已完成详情：292
隔离：0
下一动作：12:30 继续详情
```

### Release failed

```text
状态：release-retryable
Bundle：abc123
计划发布：292
已发布：0
失败阶段：build / validator / push
采集成果：已保留
Bundle：已保留，将在下一窗口直接重试
```

### Published

```text
状态：published
Bundle：abc123
实际发布：292
新增：x
涨价：x
降价：x
下架：x
重新上架：x
Commit：...
Push：成功
```

不得再把“回滚后的实际 0”描述成“本轮没有变化”。

---

## 12. 状态写入与保留策略

- JSON 全部使用 temp + atomic rename；
- state schema 带版本；
- Detail cache 长期保留；
- cycle/bundle/log 默认保留 14 天；
- published bundle 至少保留最近 10 个；
- 失败 bundle 在成功发布或人工作废前不得删除；
- 审计日志不得写入 Git worktree。

---

## 13. V1 → V2 迁移方案

### Phase 1：冻结设计与建立测试

1. 将本文写入：
   `docs/SMOKINGPIPES_AUTOMATION_ARCHITECTURE_V2.md`
2. 建立 V2 状态、bundle 和 publisher E2E fixture；
3. 不改 Production，不访问源站。

### Phase 2：外部状态迁移

1. 创建 StateRoot；
2. 从现有 progressive state、可信列表和 detail cache 迁移；
3. 生成迁移报告：
   - Product IDs；
   - pending details；
   - absence counters；
   - failed/quarantine；
   - hashes；
4. Falcon 队列全部清除；
5. 不保留陈旧 action event 作为发布事实。

### Phase 3：采集与发布拆分

1. 现有 progressive runner 增加 collect-only/external-state 模式；
2. scheduled path 禁止写 Production；
3. 新增 bundle builder；
4. 新增 standalone release publisher；
5. 原 auto-publish 成为轻量 orchestrator。

### Phase 4：离线对账

使用同一份 snapshot/state：

- V2 生成候选；
- 与 Production before/after 实际差异核对；
- 验证所有类别和计数；
- 生成但不发布 bundle；
- E2E 模拟 no-op、真实发布、validator 失败、build 失败、push 失败、main 变化。

### Phase 5：一次性切换

1. 确认计划任务不在 Running；
2. 同步 runtime；
3. 创建/更新 release clone；
4. 修改计划任务入口仍指向现有 `run-smokingpipes-auto-publish.ps1`；
5. 该入口内部切到 V2 orchestrator；
6. 禁用 V1 scheduled production-write path；
7. 不长期双写；
8. 等待下一次自然触发。

---

## 14. 必须新增/调整的模块

### 保留入口

```text
scripts/inventory/run-smokingpipes-auto-publish.ps1
```

职责缩减为 orchestrator。

### 建议新增

```text
scripts/inventory/smokingpipes-cycle-store-v2.mjs
scripts/inventory/smokingpipes-build-release-bundle-v2.mjs
scripts/inventory/validate-smokingpipes-release-bundle-v2.mjs
scripts/inventory/publish-smokingpipes-release-bundle-v2.ps1
scripts/inventory/migrate-smokingpipes-runtime-state-v2.mjs
scripts/inventory/test-smokingpipes-pipeline-v2-e2e.mjs
```

### 复用但调整

```text
run-smokingpipes-progressive-daily.ps1
smokingpipes-progressive-runner-v1.mjs
```

仅负责采集/详情/外部 state，不再在 scheduled path 写 Production。

### 移出自然发布门禁

```text
test-inventory-runner-v1.mjs
```

仍保留并由代码 CI 执行。

---

## 15. 验收标准

V2 只有同时满足以下条件才算完成：

1. runtime 任何结束路径 tracked worktree clean；
2. release clone 任何失败路径 tracked worktree clean；
3. 发布失败后已完成 Detail 仍存在；
4. 发布失败后下一窗口不访问源站，直接重试 bundle；
5. no-op 不运行 validator/build/commit/push；
6. 真实变化才运行生产门禁与 build；
7. `test-inventory-runner-v1.mjs` 不在自然任务中执行；
8. bundle IDs、类别计数、实际 before/after diff 完全一致；
9. remote main 变化时不丢采集成果；
10. Falcon 不抓详情、不进入 bundle、不公开；
11. 连续消失必须来自两个可信完整 snapshot；
12. 单商品异常可隔离，不阻断其他商品；
13. commit/push 幂等，不重复发布同一 bundle；
14. PushDeer 能区分计划发布数与实际发布数；
15. V1 正式写入路径在切换后关闭，不长期双写。

---

## 16. 非目标

本次不做：

- 改写 Smokingpipes 抓取页面解析逻辑；
- 改变价格公式；
- 改变前端 UI；
- 合并 Danish 自动化；
- 引入数据库、Redis、消息队列或云服务；
- 新增多层 adapter 或重复 schema；
- 为单条异常重构整套商品模型。

V2 仍采用本地文件 + Git 的现有技术方向，只重新划清事务边界和责任边界。
## Implementation Notes

### V1 审计映射（冻结时）

- 原计划入口为 scripts/inventory/run-smokingpipes-auto-publish.ps1。它先同步 runtime，再启动 run-smokingpipes-progressive-daily.ps1；原入口还把 public validator、build 和 test-inventory-runner-v1.mjs 作为一次自然任务的连续门禁。
- V1 的可变状态位于 data/inventory/smokingpipes-progressive-daily-state.json、current-list/diff、data/review 下的 preview/audit/gate/report，以及多套 data/inventory 锁文件；Production 写入点在 data/products/smokingpipes-products.json、data/products/unified-products-staging.json 和 data/generated/public-products。
- V1 runner 的可复用纯函数为列表摄入、详情队列、品牌排除、候选构建、实际 before/after 差异统计、统一产品构建和公开索引构建。V2 复用这些函数，但不再让 scheduled path 调用 V1 progressive-partial-apply。
- 原 post-apply rollback 会 restore Production/Public 并回写 progressive state；V2 不再把发布失败当作采集事务失败。详情、snapshot、queue 和 bundle 留在 StateRoot，release clone 只清理自己的工作区。
- featured.json 仍由既有精选任务拥有，Smokingpipes bundle 的输出白名单明确排除它。

### V2 运维入口

StateRoot 必须在 Git 工作树之外。正式入口保持为 scripts/inventory/run-smokingpipes-auto-publish.ps1；它只调度 V2 orchestrator。正常计划任务不再调用 test-inventory-runner-v1.mjs，后者保留给代码 CI。

~~~text
node scripts/inventory/smokingpipes-cycle-store-v2.mjs --state-root=<StateRoot> --status
node scripts/inventory/migrate-smokingpipes-runtime-state-v2.mjs --state-root=<StateRoot> --runtime-root=<RuntimeRoot>
node scripts/inventory/migrate-smokingpipes-runtime-state-v2.mjs --state-root=<StateRoot> --runtime-root=<RuntimeRoot> --apply
node scripts/inventory/validate-smokingpipes-release-bundle-v2.mjs --bundle-root=<bundle directory> --runtime-root=<RuntimeRoot>
~~~

- migration 默认 dry-run；apply 前会在 StateRoot 同级目录创建备份，并用 source hash 保证同一输入的幂等重跑。
- collection-retryable 只允许重新抓取可信列表；enriching-details 只补 pending detail；bundle-ready 或 release-retryable 必须直接重试同一 bundle，禁止访问源站。
- release clone 失败（validator/build/commit 前）会回到干净的 origin/main；commit 后 push 失败保留 commit，只重试 push。任何发布失败都不会删除 StateRoot 中的 detail 或 bundle。
- 如需回退，先确认计划任务未运行并保留 StateRoot/bundle，然后恢复已验证的 V1 代码和计划任务参数；不得让 V1 与 V2 同时写入 Production。
