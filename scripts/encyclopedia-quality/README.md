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
