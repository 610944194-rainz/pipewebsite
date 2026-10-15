# 烟斗派斗草百科审计与上线结果（2026-10-15）

状态：已上线。修复提交 0776b56ad3527fad5b8da18669ae6d5104350405；启动校验配置收尾提交 081ab09。服务 yandoubuy.service 正常运行，原会员版本、账号配置和环境文件保持原部署。正式入口：https://yandoubuy.cn/tobacco-encyclopedia/index.html

## 排查结论

1. 重复展示来自不同目录身份同时可见，以及同一品牌的别名被作为独立品牌。已用人工确认的 36 组身份规则收敛 41 条重复展示，另移除 1 条误收录的保湿罐。展示数从 2,130 变为 2,088，品牌从 182 变为 178。
2. 详情缩短不只是样式截断：部分中文字段实际存的是简述，原文虽然能用 original_sha256 对应到较长的来源文本，但原页面没有展示这些完整原文。已按哈希恢复 125 条原始记录的长原文，对应 123 条当前展示产品；增加“查看完整原文（English）”展开区。8 条重点产品已补完整中文；53 条仍为中文简述，但完整英文已可查阅。
3. 发现并修复包装规格漏取、切型同义词未映射、明确的成分和名称错误、外部卡图依赖等问题。修复包含 162 条规格补齐、21 种原始切型映射、3 条明确成分字段补齐、6 条有证据的字段更正，以及 10 条外链卡图改用现存本地同产品图片。
4. 同号异系列及不同味型不能仅因同名、同介绍而合并。彼得亨利与亨利庄园的 35 号已区分系列；其余 7 组相似候选保留独立身份，详见下文。

## 身份与发布保护

全部 2,342 条原始记录、UID、旧数字编号的归属都保持不变。重复记录通过 catalogHidden 退出目录，旧详情仍可访问原身份；不迁移留言或收藏归属。原有隐藏记录未重新展示。

scripts/encyclopedia-quality 保存明确的决策、译文和质量检查。服务器已安装 scripts/server/encyclopedia-quality.conf 对应的 systemd 启动前校验，实际重启时已成功执行。它检查已审定身份规则、原文哈希、已修正字段与完整译文，发现回退则阻止启动。直接覆盖静态文件不会触发服务校验，后续百科生成任务仍须在暂存目录先运行修复和校验再发布。

## 验证范围与结果

- npm run build 成功，包含编译、TypeScript 和页面生成。
- 全量结构检查覆盖原始 2,342 条记录及目前展示的 2,088 条；所有展示卡图均为存在的本地文件，未发现断开的本地图片路径。
- 线上 data.js、app.js 均返回 200，字节与已安装文件一致。
- 线上浏览器验收通过：Sillem Blue 搜索只有一条、旧稳定链接与旧数字编号可打开、旧链接留言读取正常、完整中文和原文展开、石楠狐狸切型、两个不同系列 35 号独立保留。
- 1280×900 与 390×844 视口均检查了目录或详情，无横向溢出；未发现浏览器脚本异常。账号页面保持原有登录跳转，留言读取接口正常。没有创建测试账号或写入真实留言、收藏。
- 这是全量结构与一致性审计，并对有明确证据的问题做了内容复核；没有把所有产品逐条与最新厂商资料重新认证，也没有逐张人工鉴定包装图。

## 仍需补充的资料

下列数量可以重叠，不能相加当作问题产品总数。字段缺失表示资料不足，不代表配方错误；品牌国家属于品牌元数据，也不能直接当作烟草产地。

| 项目 | 展示记录数 | 处理原则 |
| --- | ---: | --- |
| 缺少描述 | 10 | 需要可靠原始介绍或包装资料 |
| 来源参数冲突 | 42 | 需核对具体版本及权威来源，不合并互相矛盾的成分 |
| 中文仍为简述 | 53 | 完整英文已恢复，中文全文尚待完成 |
| 缺少成分 | 192 | 不根据名称猜配方 |
| 缺少切型 | 423 | 需补可靠字段或清晰包装资料 |
| 配方类型未分类 | 463 | 保留未分类，避免猜测 |
| 缺少包装规格 | 313 | 需明确重量与规格对应关系 |
| 品牌国家未知 | 1,793 | 品牌级补充后可批量修正 |

最有帮助的补充材料是：以下 10 条无描述产品的原始文案；42 条参数冲突产品的包装正反面或厂家资料；相似候选中可证明“同款”或“不同版本”的资料。来源 URL、包装版本或年份应同时保留。其余通用缺失与中文译文均已列入清单，不应通过缩写介绍或猜测参数填满。

## 缺少描述的 10 条产品

| ID | 品牌 | 产品 |
| --- | --- | --- |
| blendv3:4735ed110a9a46bb | Kopp | 焦糖切片 / Karamell Flake |
| blendv3:89f8360c81c2340b | Kopp | 李子 / Plum |
| blendv3:6235ad88706c66c5 | Stanwell | 阿里斯顿 / Ariston |
| blendv3:231251729d403364 | Synjeco | 塞尚砖草 / 1941 Art Series Cezanne Plug |
| blendv3:1687ed9c1a717cb9 | Synjeco | 摇摆砖草 / 1941 Art Series Swing Plug |
| blendv3:a320c503dff5a31e | Synjeco | 摇摆切片 / 1941 Art Serries Swing Flake |
| blendv3:b50f0f71d9686e6c | Synjeco | 霍尔克砖草 / 1941 Holker Plug |
| blendv3:81c0efb7572a07e4 | Synjeco | 弗吉尼亚草2号切片 / 1941 Virginia 2 Flake |
| blendv3:065c919f98505250 | Synjeco | 弗吉尼亚草2号砖草 / 1941 Virginia 2 Plug |
| blendv3:992e6d8674f704f5 | Synjeco | 弗吉尼亚草3号砖草 / 1941 Virginia 3 Plug |

## 存在来源参数冲突的 42 条产品

| ID | 品牌 | 产品 |
| --- | --- | --- |
| canonical:12 | Borkum Riff | 波本威士忌 / Bourbon Whiskey |
| canonical:15 | Borkum Riff | 原味 / Original |
| canonical:33 | Captain Black | 樱桃 / Cherry |
| canonical:110 | Cornell & Diehl | 斜眼蟋蟀 / Cross-Eyed Cricket |
| canonical:132 | Cornell & Diehl | 绅士来访 / Gentleman Caller |
| canonical:169 | Cornell & Diehl | 夜行列车 / Night Train |
| canonical:293 | Drucquer & Sons | 特拉法尔加 / Trafalgar |
| canonical:358 | G. L. Pease | 黑点 / Blackpoint |
| canonical:379 | G. L. Pease | 子午线 / Meridian |
| canonical:394 | G. L. Pease | 弗吉尼亚奶油 / The Virginia Cream |
| canonical:499 | Mac Baren | 弗吉尼亚草切片 / Virginia Flake |
| canonical:525 | Robert McConnell | 纯弗吉尼亚草 / Pure Virginia |
| canonical:668 | Savinelli | 和谐 / Armonia |
| canonical:669 | Savinelli | 芳香 / Aroma |
| canonical:670 | Savinelli | 黑卡文迪什 / Black Cavendish |
| canonical:672 | Savinelli | 英式调配 / English Mixture |
| canonical:675 | Savinelli | 朱诺 / Juno |
| canonical:676 | Savinelli | 朱庇特 / Jupiter |
| canonical:684 | Sillem's | 黑色 / Black |
| canonical:685 | Sillem's | 蓝色 / Blue |
| canonical:690 | Sillem's | 绿色 / Green |
| canonical:694 | Sillem's | 红色 / Red |
| canonical:737 | Warped | 圣浓缩咖啡 / Saint Espresso |
| blendv3:2033a6ad35e55c9d | Davidoff | 阿根廷 / argentina |
| blendv3:7ab7eb77df7d5aa4 | Davidoff | 巴西 / brazil |
| blendv3:85200faf4186e7ce | Davidoff | 马拉维 / malawi |
| blendv3:1efe7b816fdfdebe | Mac Baren | 和谐预揉 / Harmony Ready Rubbed |
| blendv3:c406753549012897 | Mac Baren | 经典切片 / classic flake |
| blendv3:738e68a39bdb1a98 | POUL WINSLOW | 1号 / No. 1 |
| blendv3:d7a13514f5938768 | POUL WINSLOW | 2号 / No. 2 |
| blendv3:824e9f5c000cbcec | POUL WINSLOW | 3号 / No. 3 |
| blendv3:c6fd333dcfc9dc6a | Reiner | 专业版不规则切 / Wild Cut Professional |
| blendv3:fcbf42e590aac66b | Savinelli | 1876巴尔干 / 1876 The Balkans |
| blendv3:d8c7285a261bae02 | Sutliff | 957豪华巴尔干调配 / Balkan Luxe 957 Blend |
| blendv3:8755612ff0dfa1d4 | Torben Dansk | 海军切14号 / Navy Cut No. 14 |
| blendv3:f609be2ef1258832 | Torben Dansk | 水手切片15号 / Sailor´s Flake No. 15 |
| blendv3:742369daa932bd9d | Torben Dansk | 苏格兰调配1号 / Scottish Blend No. 1 |
| blendv3:50bbc55ab95ccbf2 | Tordenskjold | 弗吉尼亚草切片 / Virginia Slices |
| blendv3:6deb362994ac679a | W.O. LARSEN | 2024年度版 / Edition 2024 |
| blendv3:619bf666efb987e5 | W.O. LARSEN | 2025年度版 / Edition 2025 |
| blendv3:b1a76654f0c241b1 | W.O. LARSEN | 柔和调配 / Mellow Mixture |
| blendv3:2cdfc967dd3d9f4b | W.O. LARSEN | 甜调味 / Sweet Aromatic |

## 中文全文待完成的 53 条产品

| ID | 品牌 | 产品 |
| --- | --- | --- |
| canonical:293 | Drucquer & Sons | 特拉法尔加 / Trafalgar |
| canonical:408 | Gawith Hoggarth & Co. | 美式愉悦 / American Delite |
| canonical:614 | Reiner | 12号调配 / Blend No. 12 |
| canonical:616 | Reiner | 51号调配 / Blend No. 51 |
| canonical:617 | Reiner | 专业版 / Professional |
| canonical:641 | Samuel Gawith | 1792切片焦边 / 1792 Flake Burnt Ends |
| canonical:643 | Samuel Gawith | 巴尔干切片焦边 / Balkan Flake Burnt Ends |
| canonical:645 | Samuel Gawith | 黑樱桃卡文迪什 / Black Cherry Cavendish |
| canonical:628 | Samuel Gawith | 黑XX绳草 / Black XX Rope |
| canonical:648 | Samuel Gawith | 马车夫绳草 / Cabbie's Rope |
| canonical:630 | Samuel Gawith | 加农炮砖 / Cannon Plug |
| canonical:649 | Samuel Gawith | 巧克力切片焦边 / Chocolate Flake Burnt Ends |
| canonical:650 | Samuel Gawith | 玉米芯砖草 / Cob Plug |
| canonical:651 | Samuel Gawith | 火舞砖草 / Fire Dance Plug |
| canonical:654 | Samuel Gawith | 纯弗吉尼亚草迷你砖草 / Full Virginia Mini Plug |
| canonical:656 | Samuel Gawith | 纯弗吉尼亚草砖草 / Full Virginia Plug |
| canonical:657 | Samuel Gawith | 金色光辉 / Golden Glow |
| canonical:659 | Samuel Gawith | 格鲁斯摩尔砖 / Grousemoor Plug |
| canonical:636 | Samuel Gawith | 海军切片焦边 / Navy Flake Burnt Ends |
| canonical:637 | Samuel Gawith | RC土耳其草 / RC Turkish |
| canonical:663 | Samuel Gawith | 山姆切片焦边 / Sam's Flake Burnt Ends |
| canonical:666 | Samuel Gawith | 圣詹姆斯迷你砖草 / St. James Mini Plug |
| canonical:713 | St. Bruno | 预揉 / Ready Rubbed |
| blendv3:d03f3810b0a9e164 | BBB | 丹麦调配 / Danish Mixture |
| blendv3:2c7889513153918c | Century | 丹麦黑樱桃卡文迪什 / danish black cherry cavendish |
| blendv3:d0b7d6a1dc6b54a8 | Charatan | 1992调配 / 1992 dunhill 965 mixture |
| blendv3:3eb3d5c350e37688 | Charatan | 黑色切片 / Black Flake |
| blendv3:ab8ba06177b17171 | Charatan | 皇家远游调配 / Royal Escape Mixture |
| blendv3:cf15ff34ab2184a0 | Charatan | 寇松杜巴 / curzon durbar |
| blendv3:f96f43e2bf2a6719 | Charatan | FC1863 BB1938 / fc1863 bb1938 |
| blendv3:493478605fff1750 | Charatan | 四叶开胃酒 / four leaf aperitif |
| blendv3:d1217fa09b2e0acd | Charatan | 皇家旗帜调配（登喜路标准调配） / royal ensign mixture dunhill standard mixture |
| blendv3:b3a45f4f68edd0f1 | Charatan | 维多利亚调配（登喜路伊丽莎白调配） / victorian mixture dunhill elizabethan mixture |
| blendv3:e9fb862737f37ad3 | Charatan | 三年熟化弗吉尼亚 / virginia three year matured |
| blendv3:74f44ace4dd6cc67 | Gawith Hoggarth & Co. | 美式黑棕调配 / American Blend Black And Brown |
| blendv3:851b1804cae96389 | Gawith Hoggarth & Co. | 光明切片 / Bright Cr Flake |
| blendv3:a58688ded66380df | Gawith Hoggarth & Co. | 美式BC（原名黑樱桃） / american bc formerly black cherry |
| blendv3:d529b51684e990a1 | Gawith Hoggarth & Co. | 美式加勒比椰子 / american caribbean coconut |
| blendv3:b8ae08a25a5794ea | Gawith Hoggarth & Co. | 棕色爱尔兰绳草 / brown irish twist |
| blendv3:da1ca73f0846c8e7 | Gawith Hoggarth & Co. | 棕色AN绳草（原名茴香） / brown twist an formerly aniseed |
| blendv3:e15c01f4fa38624b | Gawith Hoggarth & Co. | 棕色AP绳草（原名甜苹果） / brown twist ap formerly sweet apple |
| blendv3:7a322f332299ae6c | Gawith Hoggarth & Co. | 棕色BCH绳草（原名黑樱桃） / brown twist bch formerly black cherry |
| blendv3:bebe94f644989dd4 | Gawith Hoggarth & Co. | 拉塔基亚CC调配用草 / latakia cc blending |
| blendv3:75ade15b5739a41f | Gawith Hoggarth & Co. | 浓郁深色春露（原名浓郁深色蜜露） / rich dark spring dew formerly rich dark honeydew |
| blendv3:b25ede3b58b859c2 | Gawith Hoggarth & Co. | 棕色U.S.绳草切片 / sliced brown twist u s |
| blendv3:decaa6a60d751a2f | Ilsted | 伊尔斯特私藏100号异域滋味 / ilsteds own number 100 exotic taste |
| blendv3:7f22c66d11feee61 | Ilsted | 伊尔斯特私藏55号清新滋味 / ilsteds own number 55 fresh taste |
| blendv3:67ba3b211c4c76e1 | Ilsted | 伊尔斯特私藏66号芳香滋味 / ilsteds own number 66 aromatic taste |
| blendv3:9a90dd6e18045487 | Ilsted | 伊尔斯特私藏77号经典滋味 / ilsteds own number 77 classic taste |
| blendv3:02566420acba09f2 | Ilsted | 伊尔斯特私藏99号甜美滋味 / ilsteds own number 99 sweet taste |
| blendv3:d35fd93be8e8c23b | Kopp | 南方风暴限量版 / stormy south limited edition |
| blendv3:5ff181434c9ec4e1 | Mac Baren | 金砖 / gold block the tobacco is a little dry |
| blendv3:cb27ec4adc561092 | Wilsons of Sharrow | 沙罗金色烟草 / sharrow gold tobacco |

## 相似条目候选（7 组，未判定重复）

- Peterson De Luxe Mixture（canonical:566）；Peterson Luxury Blend（blendv3:b69d45247e9b23f6）。
- Mac Baren Three Nuns Bells（blendv3:ccd0f5e2ba7d120c）；Mac Baren non nicer（blendv3:bf8dc6e4386e3d75）。
- Gladora Pesse Canoe Latakia Flake 20（canonical:430）；Gladora Pesse Canoe Latakia Flake 40（canonical:431）。
- Dan Tobacco Ocean Liner Series American Line（blendv3:17583d7615054a48）；Dan Tobacco Ocean Liner Series Flake & Cavendish（blendv3:cdcbb5b088c246c4）。
- Mac Baren Meine Mischung Braun（blendv3:e6777fb38e80a78c）；Mac Baren Meine Mischung Sweet Caribbean（blendv3:e3acad1d93f2c972）。
- Mac Baren Mixture Scottish Blend Limited Heritage Edition Handblended Black（blendv3:6bd0bc99c4602868）；Mac Baren Mixture Scottish Blend Limited Heritage Edition Handblended Red（blendv3:210fc6733fbefce8）；Mac Baren Mixture Scottish Blend Limited Heritage Edition Handblended Yellow（blendv3:c371dcd9994cf3e2）。
- Vauen PipooCherry-Flavour（blendv3:cac8ee07df314e81）；Vauen PipooChoco-Flavour（blendv3:a5988de77fa084c8）；Vauen PipooNeutral-Flavour（blendv3:e84cc65a1ef9ab26）；Vauen PipooVanilla-Flavour（blendv3:7acf1428f80d4571）。

## 完整逐条清单

[全部 2,088 条展示记录及问题标记](encyclopedia-20261015-all-visible.json) 包含每条记录的 ID、名称、品牌、缺失项、来源冲突与详情链接；没有标记只表示本次规则未发现问题，不表示所有内容已经权威认证。[相似条目候选详情](encyclopedia-20261015-candidates.json)。

## 线上资源校验

{
  "checkedAt": "2026-10-15T13:03:12.583196+00:00",
  "storedRows": 2342,
  "visibleRows": 2088,
  "visibleBrands": 178,
  "cardImageIssues": [],
  "liveResources": {
    "data.js": {
      "httpStatus": 200,
      "matchesInstalled": true,
      "sha256": "0e83b764caabbed64a30bbcff1223368bb4c8365ce2ea41dae24e02a9a999dc6"
    },
    "app.js": {
      "httpStatus": 200,
      "matchesInstalled": true,
      "sha256": "89f6fe156fbd0276f9a8b37c21a07de371527778d886794b94e31e281235ba77"
    }
  }
}
