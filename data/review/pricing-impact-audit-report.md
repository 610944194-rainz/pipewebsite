# Pricing Impact Audit Report

- 状态：PASSED
- 生成时间：2026-06-27T17:46:54.492Z
- 项目 USD/CNY 汇率：6.8397

## 结论

- Danish 调用 `reference-price.mjs`：true
- Danish 使用独立 `calculateDanishPipeShopReferencePrice`：true
- Danish 保留 `taxFactor=1.2`：true
- Danish 受本次 SP 公式修复影响：false
- Danish 需要因本次修复重算 public catalog：false
- Smokingpipes 问题：The previous hotfix omitted the configured 1.2 import/tax cost factor from Smokingpipes taxable product cost.
- Smokingpipes public catalog 公式不一致：0
- Danish public catalog 相对 hotfix 基线变化：0

## Peterson 716017

- 原站列表价：$94
- Peterson 折扣后实际购买价：$89.3
- 国际运费：$6
- import/tax factor：1.2
- 服务费：¥200.00
- 国内邮费：¥30
- 当前项目汇率结果：¥1003.98
- 页面向上取整显示：约 ¥1004
- 汇率 7.2 校验：约 ¥1045

## Smokingpipes 抽样 10 条

| ID | 品牌 | 原站价 USD | 实际购买价 USD | 运费 USD | 进口系数 | 旧公式 CNY | 修复后 CNY |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 716017 | Peterson | 94 | 89.3 | 6 | 1.2 | 881.82 | 1003.98 |
| 109736 | Missouri Meerschaum | 8.63 | 8.63 | 6 | 1.2 | 330.06 | 341.87 |
| 109737 | Missouri Meerschaum | 8.63 | 8.63 | 6 | 1.2 | 330.06 | 341.87 |
| 109738 | Missouri Meerschaum | 10.8 | 10.8 | 6 | 1.2 | 344.91 | 359.68 |
| 109739 | Missouri Meerschaum | 10.8 | 10.8 | 6 | 1.2 | 344.91 | 359.68 |
| 109740 | Missouri Meerschaum | 13.43 | 13.43 | 6 | 1.2 | 362.90 | 381.27 |
| 109743 | Missouri Meerschaum | 8.63 | 8.63 | 6 | 1.2 | 330.06 | 341.87 |
| 109744 | Missouri Meerschaum | 11.32 | 11.32 | 6 | 1.2 | 348.46 | 363.95 |
| 109745 | Missouri Meerschaum | 11.32 | 11.32 | 6 | 1.2 | 348.46 | 363.95 |
| 116687 | Missouri Meerschaum | 4.56 | 4.56 | 6 | 1.2 | 302.23 | 308.47 |

## Danish 抽样 10 条

| ID | 品牌 | 原站价 USD | 净出口价 USD | 运费 USD | 税费系数 | 展示价 CNY |
| --- | --- | --- | --- | --- | --- | --- |
| 33109 | Anne Julie | 12090 | 9672.00 | 0 | 1.2 | 91321.94 |
| 33108 | Anne Julie | 12090 | 9672.00 | 0 | 1.2 | 91321.94 |
| 36851 | Bay Denmark | 1410.5 | 1128.40 | 0 | 1.2 | 10680.73 |
| 36858 | Bay Denmark | 765.7 | 612.56 | 0 | 1.2 | 5811.82 |
| 36857 | Bay Denmark | 806 | 644.80 | 0 | 1.2 | 6116.13 |
| 36850 | Bay Denmark | 1410.5 | 1128.40 | 0 | 1.2 | 10680.73 |
| 36675 | Berggreen Pipes | 1096.16 | 876.93 | 0 | 1.2 | 8307.14 |
| 36674 | Berggreen Pipes | 1096.16 | 876.93 | 0 | 1.2 | 8307.14 |
| 36677 | Berggreen Pipes | 1047.8 | 838.24 | 0 | 1.2 | 7941.97 |
| 276 | BPK | 63.67 | 50.94 | 21 | 1.2 | 791.70 |

## 校验

- PASS：项目 USD 汇率有效
- PASS：SP 配置 taxFactor 为 1.2
- PASS：Danish 配置 taxFactor 保持 1.2
- PASS：SP 运费边界 $89.3 => $6
- PASS：SP 运费边界 $149.99 => $6
- PASS：SP 运费边界 $150 => $19
- PASS：SP 运费边界 $399.99 => $19
- PASS：SP 运费边界 $400 => $60
- PASS：Peterson 716017 使用折后实际购买价 $89.30
- PASS：Peterson 716017 使用 $6 运费
- PASS：Peterson 716017 恢复 1.2 import/tax factor
- PASS：Peterson 716017 当前汇率公式正确
- PASS：Peterson 716017 在汇率 7.2 时约 ¥1045
- PASS：低金额服务费使用最低 ¥200
- PASS：国内邮费固定 ¥30
- PASS：高金额服务费使用 baseCost 的 15%
- PASS：缺价不输出 ¥0
- PASS：importCostFactor 优先于兼容 taxFactor
- PASS：Danish 使用独立 VAT/运费/税费公式
- PASS：Danish 不套用 SP 运费档
- PASS：服务费文案为 15%、最低 200、国内邮费 30
- PASS：Danish 前端调用独立价格函数
- PASS：前端缺价显示价格待确认且不回退美元价
- PASS：public catalog 结构有效且 ID 唯一
- PASS：manifest catalog/detail 数量与 public catalog 一致
- PASS：全部 SP public catalog 价格符合修复公式
- PASS：SP public catalog 无 0 元可售价格
- PASS：Danish public catalog 未被 SP hotfix 改动
- PASS：全部 SP detail shard 价格符合修复公式
- PASS：detail shard 记录数与 manifest 一致
- PASS：recent-new 中 SP 价格符合修复公式
- PASS：manifest 文件哈希全部匹配

## Errors

- 无
