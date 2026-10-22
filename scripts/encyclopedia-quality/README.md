# 斗草百科质量修复与发布校验

本目录保存 2026-10-15 审核确认的产品身份合并、原文溯源和字段更正规则。data.js 保留全部 2,342 条原记录及 UID，目录通过 catalogHidden 隐藏重复，旧详情仍可访问。禁止根据名称相似度自动合并。

## 发布校验

服务器执行：

    python3 scripts/encyclopedia-quality/release_gate.py /srv/yandoubuy/app

服务器已安装 scripts/server/encyclopedia-quality.conf 对应的 systemd 启动前校验。现有会员服务 WorkingDirectory、ExecStart 和环境文件保持原配置；所有通过 yandoubuy.service 的启动与重启都会校验共享 public 下的百科。库存发布不修改百科时正常通过。直接覆盖静态文件不会触发 systemd，任何百科数据生成任务都必须先在暂存目录运行修复和校验，通过后再替换公开文件。

## 后续数据生成

先保留原有 ID 与 UID；使用 repair_encyclopedia.py --help 查看输入输出参数，生成到独立暂存目录，再以 release_gate.py 校验准备发布的目录。首次历史基线使用 --strict-baseline；后续数据源有变化时，复核决策中的前置字段与原文校验和，不能强行覆盖新的权威数据。变更决策与输出应在同一提交内审查。

## 尚未补齐

53 条产品已恢复完整英文原文，但中文仍为简述；192 条缺成分，423 条缺切型，463 条未分类，313 条缺包装，10 条缺描述。缺失与冲突保留未知，不根据名称猜测。完整逐条清单保存在本次审计包。


## Danish 2026-10-19 source update
After generating encyclopedia data, apply apply_danish_overlay.py INPUT OUTPUT before release_gate.py. The overlay retains reviewed blend_unit_key ownership, local package images and complete descriptions. Updated source records may add stronger evidence; do not drop the reviewed Danish identities or original checksums. Full collection and exclusion decisions are recorded in the import report.

## 2026-10-20 品牌国家 / 地区补全
品牌国家规则保存在brand-countries.json。175条确认规则保留来源与说明，4条保留核验记录。repair_encyclopedia.py已自动应用规则；每次服务启动的release_gate.py会校验国家与证据，避免生成后丢失。
单独应用：python3 scripts/encyclopedia-quality/apply_brand_countries.py INPUT_DATA.js OUTPUT_DATA.js
后续新增品牌必须加入有证据的确认记录或明确的review记录，不得按名称、销售市场、代工厂或烟叶产区猜填国家。
Danish证据恢复仍使用apply_danish_overlay.py；完整生成的顺序是repair_encyclopedia.py→apply_danish_overlay.py→apply_brand_countries.py→release_gate.py。

## 2026-10-20 TobaccoReviews Dunhill
67个原站独立条目，58个新增、9个补充；45张来源图片、54份实质简介。生成流程在国家规则之后执行 python3 scripts/encyclopedia-quality/apply_tr_overlay.py public/tobacco-encyclopedia/data.js，再运行release_gate.py。保留同名独立来源条目；不得将Peterson、Charatan后继产品作为Dunhill原版。纯品牌名搜索仅匹配该品牌，历史别名仍保留溯源。

## 2026-10-20 前台展示修订
用户确认：前台不展示原站参数模块、查看依据和资料来源入口；保留整理后的百科参数、中文介绍及必要的完整原文。证据仅保存在数据维护记录内。Dark Flake主图已从误配Peterson包装改为经罐面核验的Dunhill原版，fieldCorrections强制保留正确主图。

## PipeUncle Dunhill 2026-10-20
基于2026-09-22完整快照恢复6款Dunhill历史品牌记录，补充6款已有Dunhill记录，7条旧来源从Peterson条目拆出（UID和留言入口保持）。当前实时目录访问403，不将快照称为当日新采。12份完整中英文源描述均存sourceRawArchive；Royal Yacht成分/调味与Nightcap切型等冲突经核对后不用错误字段。
生成顺序：repair_encyclopedia.py→apply_danish_overlay.py→apply_brand_countries.py→apply_tr_overlay.py→apply_pipeuncle_overlay.py→release_gate.py。PU脚本接受DATA.js原地应用，支持重复执行。前台不得恢复来源或依据模块。
