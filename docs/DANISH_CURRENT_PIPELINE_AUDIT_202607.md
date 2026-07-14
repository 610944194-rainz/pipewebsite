# DanishPipeShop 当前数据链路审计（2026-07）

本文件只依据本 worktree (`feat/danish-full-refresh-prep` at `dbe5f57e22ad817e229ce45184fc6306803e020a`) 中的文件与离线数据编写。本轮没有访问 DanishPipeShop，也没有执行任何真实 List/Detail 抓取。

## 结论摘要

- Danish Production 是 `data/products/danish-products.json`，目前 2,165 条：`可购买` 1,843，`已售` 322；文件内 `updatedAt` 为 `2026-06-09 22:49`。
- Danish Public 是 `data/generated/public-products/catalog.json` 的 `source=danish` 行，目前 2,121 条：`available` 1,810，`sold` 311。其 manifest 的 `generatedAt` 为 `2026-07-13T18:50:37.815Z`。
- Production 与 Public 相差 44 条。`data/products/unified-products-staging.json` 虽包含 2,165 条 Danish，但按其现有字段读出的 `inventoryStatus` 都是 `unknown`；这是历史转换状态不一致，不能据此做线上库存结论。
- Phase 0A 新入口只写独立 `RunId` 下的 raw/audit/review 文件，绝不写 Production、Public、统一 staging，绝不包含 Apply/Commit/Push/计划任务操作。

## 当前文件、数据与字段

| 审计项 | 当前实证 |
| --- | --- |
| Production 路径 | `data/products/danish-products.json`；旧 TypeScript 导出为 `data/danish-products.ts` |
| Public 路径 | `data/generated/public-products/catalog.json`、`detail-lookup.json`、`details/*.json`；总 manifest 为 `data/generated/public-products/manifest.json` |
| 原始 List | `data/danish-list-full.json`，2,170 去重链接，开始 `2026-06-08T20:16:28.251Z`，完成 `2026-06-08T20:17:25.398Z` |
| 原始 Detail | `data/danish-details-full.json`，2,170 发现、2,167 成功、3 失败，开始 `2026-06-09T13:43:13.601Z`，完成 `2026-06-09T14:49:50.700Z` |
| 唯一 ID | 商品 URL 的 `-i(\d+).html`；统一层将其写为 `danish-<sourceProductId>`，见 `getDanishSourceProductId` / `getDanishId` |
| 状态 | Production 仍为中文 `可购买`/`已售`；`mapDanishInventory` 映射为 `available`/`sold`，未知状态不具备公开资格 |
| 价格/币种 | Production 使用 `originalPrice`、`originalCurrency`、`originalPriceValue`，同时存 `estimatedCnyValue`；旧 collector 从卡片文本提取 USD/EUR/DKK |
| 图片/多图 | `imageUrl`、`detailImageUrl`、`galleryImages`、`galleryCount`；v17 通过详情页/enlargemedia 提取并进行 URL slug 图片匹配 |

## 现有 collector、parser 与分页

1. **历史全量 collector**：`scripts/collect-danish-full-v17.mjs`。它用 Playwright，List 主选择器为 `#list-container-inner .list-item`，商品链接为 `/d/-zh/...-i<id>.html`。
2. **历史详情 collector**：`scripts/collect-danish-details-v2.mjs`，以及 v15/v16 历史版本；v17 也内置详情、图片、字段与品相处理。
3. **转换器**：`scripts/convert-danish-full-v17-to-products.mjs` 将成功 Detail 转为 Danish 产品；它会跳过 `detailError`、图片 `missing/mismatch` 及固定 BPK 异常项。
4. **日常离线链路**：`scripts/inventory/danish-fetch-current-list-v1.mjs` 仅从本地 JSON fixture 归一化当前列表；`danish-diff-inventory-v1.mjs` 和 `danish-sanity-audit-v1.mjs` 只做 dry-run，不写 Production。
5. **分页机制**：v17 先在第一页面点击 `#show-more-button`（默认最多 20 次），再以 `a[rel=next]`、`link[rel=next]` 或 Next 文案作 fallback；历史实现的 `DANISH_MAX_LIST_PAGES` 默认是 20。它没有把“预期页数、空页位置、阻断页”持久化为可审计完整性门。
6. **库存判断**：旧 collector 的证据为 `sold/out of stock` 与 `available/in stock/add to basket` 文案；日常 dry-run 的 `normalizeDanishInventoryStatus` 也接受 `not available` 等文本，但会将其归进 `sold`，不适合 Phase 0A 的细分审计。

## Danish 如何进入统一 Public Index

`scripts/build-unified-products-staging-v1.mjs` 的 `mapDanishProduct` 读取 Production：ID 变为 `danish-<id>`，来源为 `danish`，并用 `mapDanishInventory` 生成标准库存与公开资格。`scripts/build-public-product-indexes-v1.mjs` 再从 staging 中筛选 `publicIndexEligible`，生成 catalog、lookup、64 个 detail shards、brands 与 filters。Public catalog 同时保留可售与已售参考品；前端以库存筛选决定可见性。

`build-public-product-indexes-v1.mjs` 中的 Falcon/AKB 排除 ID 是 Smokingpipes 专用（6 个 `sourceProductId`），不能直接当作 Danish 规则。Phase 0A 因用户要求增加了**列表阶段** `Falcon` 品牌/标题隔离：被隔离项进入 Preview 报告且不会进入 Detail 队列，不会被删除或写入任何正式数据。

## 可复用与风险

可复用：URL ID 提取、状态/价格基础归一化、v17 的 Playwright 选择器与图片采集策略、已有 Danish daily dry-run 的 diff/sanity 概念、统一层/Public Index 的 ID 合约。

高风险或已不满足本次目标：

- `collect-danish-full-v17.mjs` 会直接覆盖 `data/danish-list-full.json`、`data/danish-details-full.json` 等历史基线，且不提供 RunId 隔离、可复现 diff 或完整性门；不能作为人工全量入口直接运行。
- v17 在遇到验证页时含有人工验证逻辑；Phase 0A 将 Cloudflare/Verify/CAPTCHA/Access denied/Just a moment/软 404 判为阻断，绝不当作空页。
- 日常 `danish-fetch-current-list-v1.mjs` 是本地 fixture dry-run，不是线上 List collector；其 `not available -> sold` 合并规则不足以支撑全量刷新。
- 旧详情快照有 3 条明确失败，转换后还有 5 条比原列表少，Production/Public 又有 44 条差异；因此“列表缺失”只能在完整性门通过后作为候选，绝不能直接变 sold 或写 Production。
- 当前真实 HTML 样本只覆盖历史 List 结构；线上仍需人工核实 Show more、Next、正常末页空、每种阻断页与详情图片/字段结构是否仍然有效。

## Phase 0A 新合同

`scripts/inventory/run-danish-full-refresh-preview-v1.ps1` 调用 `danish-full-refresh-preview-v1.mjs`。其唯一输出根为：

```text
data/raw/danish-full-refresh/<RunId>/
data/audits/danish-full-refresh/<RunId>/
data/review/danish-full-refresh/<RunId>/
```

输出包括 `list.json`、`details.json`、`checkpoint.json`、`manifest.json`、`page-audit.json`、`detail-audit.json`、`diff-preview.json`、`diff-preview.md`、`diff-candidates.csv`。Manifest 含抓取时段、URL/分页/状态/重复/详情统计、文件 SHA256 与脚本提交 SHA。只有完整性门通过，才会让 `missing-from-current-list` 出现在候选 diff；无论结果如何，本阶段 `allowApply=false`。
