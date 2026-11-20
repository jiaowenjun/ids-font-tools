# 调研：Unihan Database（Unicode 汉字数据库）

> 调研日期：2026-11-20。除注明外，**全部统计与样例均来自实测**：官方 `Unihan.zip`（Unicode 18.0.0，数据生成日 2026-07-31，压缩 8.0 MB），已下载解压至本地 `references/unihan/`（gitignored）。
>
> 关联文档：[research-unicode.md](research-unicode.md)（Unicode 汉字资源总览）、[research-case.md](research-case.md)（项目背景：网页 IDS→SVG 渲染）。

## TL;DR

- Unihan 是 Unicode 官方对 **CJK 统一表意文字的知识库**，规范文档为 [UAX #38](https://www.unicode.org/reports/tr38/)，随 UCD 按版本发布，**8 MB 纯文本（TSV）离线可用**。
- 实测 18.0.0：**8 个数据文件、99 个字段、约 148 万条记录、102,999 个码位**——与已收录汉字全集精确一致（每字必有 `kRSUnicode`、`kTotalStrokes`）。
- 对本项目最有价值的字段：`kRSUnicode` / `kTotalStrokes`（候选校验）、`kIRG_*Source`（收录来源证据）、`kSemanticVariant` 等 8 个变体字段（异体判定）、**`kCangjie` + `kFourCornerCode`（官方自带"以形查字"索引，共 4.6 万条——上一次调研漏掉的官方资源）**、`kUnihanCore2020`（字体子集优先级）。
- Unihan **不含 IDS/构件分解、不含字形图像、不含笔画顺序**，也不含"待收录"信息（那是 IRG WS / Pipeline 的事）。

---

## 1. 定位与规范

| 项 | 说明 |
|---|---|
| 定义 | Unicode Consortium 对 CJK 统一表意文字的官方属性数据库（"collective knowledge regarding CJK Unified Ideographs"） |
| 规范 | [UAX #38: Unicode Han Database (Unihan)](https://www.unicode.org/reports/tr38/)（定义字段、状态、语法） |
| 发布 | 随 UCD 按版本发布；勘误与新增走 [unicode-org/unihan-database](https://github.com/unicode-org/unihan-database)（GitHub 评审流程） |
| 许可 | Unicode License（免费，商用允许，见 [terms_of_use](https://www.unicode.org/terms_of_use.html)） |
| 与 UnicodeData.txt 的关系 | 互补而非重复：`UnicodeData.txt` 回答"码位是否分配"（名字规则 `CJK UNIFIED IDEOGRAPH-XXXX`，无读音属性）；Unihan 回答"这个字是什么"（读音/笔画/来源/异体…）。⚠️ Python 标准库 `unicodedata` **不含** Unihan 数据，读音等需自行解析 zip 或用 ICU |

## 2. 获取渠道

| 渠道 | 位置 | 适用 |
|---|---|---|
| 版本化下载 | `https://www.unicode.org/Public/<版本>/ucd/Unihan.zip`（如 `18.0.0`） | 精确锁定版本，本项目推荐 |
| 最新版 | `https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip` | 跟随最新 |
| 在线查询 | [Unihan Lookup（逐字）](https://www.unicode.org/charts/unihan.html) / [Unihan Search（按属性）](https://www.unicode.org/charts/unihansearch.html) | 人工查证 |
| GitHub | [unicode-org/unihan-database](https://github.com/unicode-org/unihan-database) | 勘误提案、变更追踪 |
| 第三方工具 | Python：`unihan-etl` / `unihan-db`（cihai 生态）；ICU 内置 Unihan 派生数据 | 数据库/CSV 工作流 |

## 3. 包内结构（实测）

8 个 TSV 文件按主题分组（文件名即主题）。行数含少量注释头：

| 文件 | 约行数 | 字段数 | 内容主题 |
|---|---|---|---|
| `Unihan_IRGSources.txt` | 486k | 15 | **部首笔画（kRSUnicode/kTotalStrokes）+ IRG 各成员体收录来源 + kIICore/kCompatibilityVariant** |
| `Unihan_DictionaryIndices.txt` | 340k | 17 | 各权威字典页码/卷次索引（康熙/汉语大字典/大汉和/广韵…） |
| `Unihan_Readings.txt` | 291k | 17 | 各语言读音与释义 |
| `Unihan_OtherMappings.txt` | 171k | 23 | 各国/地区字符集编码映射（CNS/GB/Big5/JIS/EACC…） |
| `Unihan_DictionaryLikeData.txt` | 159k | 12 | 字典型杂项（**kCangjie/kFourCornerCode 输入码**、kUnihanCore2020 等） |
| `Unihan_Variants.txt` | 19k | 8 | 异体/简繁/新旧字关系 |
| `Unihan_RadicalStrokeCounts.txt` | 13k | 1 | 仅 `kRSAdobe_Japan1_6`（Adobe-Japan1-6 CID 的部首笔画） |
| `Unihan_NumericValues.txt` | 183 | 6 | 数字用法（会计数字/序数等） |

**记录格式**（三列 TSV，UTF-8，`#` 开头为注释/文档头）：

```
U+4E00	kCantonese	jat1
U+4E00	kDefinition	one; a, an; alone
U+9F8D	kSimplifiedVariant	U+9F99      ← 龍 → 龙
U+9F99	kTraditionalVariant	U+9F8D     ← 龙 → 龍（成对出现）
```

**值语法要点**（详见 UAX #38 §3）：

1. **多值**：空格分隔，如 `kSemanticVariant` 的 `U+5EDD<kMatthews U+53AE<kMatthews`；
2. **来源角括号**：变体字段用 `<...>` 标注该异体关系的出处，如 `<kLau,kMatthews`；
3. **kRSUnicode 撇号**：`167'.6`（实测样例）——1 个撇号 = 中文简化部首形（`U+9F99 龙`），2 个 = 非中文简化形（`U+7ADC 竜`），3 个 = 第二种非中文简化形；部首号一律按康熙 214 部首编号；
4. **冒号后缀**：来源字母标注，如 `kAlternateTotalStrokes` 的 `3:J`、`kMojiJoho` 的 `MJ030312:E0100`（E0100+ 为变体选择符，表示仅在该变体序列下成立）；
5. 18.0 中 `kTotalStrokes` **已全部单值**——地区差异笔画数被拆分到新字段 `kAlternateTotalStrokes`（实测无任何多值 kTotalStrokes 记录）。

## 4. 码位覆盖（实测：102,999 个）

| 区块 | Unihan 码位数 | 区块 | Unihan 码位数 |
|---|---|---|---|
| URO 基本区 4E00–9FFF | 20,992 | Ext G 30000–3134F | 4,939 |
| Ext A 3400–4DBF | 6,592 | Ext H 31350–323AF | 4,192 |
| Ext B 20000–2A6DF | 42,720 | **Ext J 323B0–3347F** | **4,298** |
| Ext C 2A700–2B73F | 4,160 | 兼容 Ideographs F900–FAD9 | 472 |
| Ext D 2B740–2B81F | 223 | 兼容 Supplement 2F800–2FA1F | 542 |
| Ext E 2B820–2CEAF | 5,774 | **合计** | **102,999** |
| Ext F 2CEB0–2EBEF | 7,473 | 区块外 | 0 |
| Ext I 2EBF0–2EE5F | 622 | | |

- `kRSUnicode` 与 `kTotalStrokes` 各 102,999 条 = **每个字必有**，可当作"已收录汉字全集"清单使用。
- ⚠️ 但判定收录的**规范依据仍是 `UnicodeData.txt` + `DerivedCoreProperties.txt` 的 `Unified_Ideograph`**：Unihan 是知识库而非分配表（历史上两者偶有时间差）；兼容区两块（1,014 字）注意用 `kCompatibilityVariant` 映射回统一区。

## 5. 字段总目录（99 个，按文件；★=对本项目关键）

### Unihan_IRGSources.txt（15）

| 字段 | 条数 | 状态 | 说明 |
|---|---|---|---|
| ★ `kRSUnicode` | 102,999 | normative | 部首.余笔（撇号表简化部首形），可多值 |
| ★ `kTotalStrokes` | 102,999 | provisional | 总笔画数（18.0 起单值，差异见 kAlternateTotalStrokes） |
| `kAlternateTotalStrokes` | 104 | provisional | 替代笔画数（`3:J` 带来源后缀） |
| ★ `kIRG_GSource` | 70,329 | normative | 中国（G）来源引用（如 `GKX-0075.06`=康熙页.行） |
| `kIRG_TSource` | 60,270 | normative | 台湾（T） |
| `kIRG_JSource` | 52,649 | normative | 日本（J），常为 MJ 面（`JMJ-030312`） |
| `kIRG_KPSource` | 24,133 | normative | 朝鲜（KP） |
| `kIRG_KSource` | 21,630 | normative | 韩国（K） |
| `kIRG_HSource` | 17,669 | normative | 香港（H） |
| `kIRG_VSource` | 14,276 | normative | 越南（V） |
| `kIRG_SSource` | 3,715 | normative | 新加坡（S） |
| `kIRG_UKSource` | 3,409 | normative | 英国（UK） |
| `kIRG_USource` | 1,189 | normative | UTC（U） |
| `kIRG_MSource` | 348 | normative | 澳门（M） |
| ★ `kCompatibilityVariant` | 1,002 | normative | 兼容区字 → 统一区等价字（`U+2F800 → U+4E3D`） |
| `kIICore` | 9,810 | normative | 2005 版 IICore 核心集（已被 kUnihanCore2020 实质取代） |

> 来源字段值形如 `GKX-`（康熙）/`GHZ-`（汉语大字典）/`JMJ-`（MJ 面）/`T5-2125`（CNS 平面-码位）——是"该字为什么被收录"的证据链，判定接口的 evidence 输出直接用它。

### Unihan_Readings.txt（17）

| 字段 | 条数 | 说明 |
|---|---|---|
| ★ `kDefinition` | 23,310 | 英文释义（43% 覆盖——大部分扩展区无释义） |
| ★ `kMandarin` | 44,355 | 汉语拼音（多音空格分隔） |
| `kCantonese` | 29,936 | 粤拼（耶鲁/粤音方案） |
| `kJapanese` | 51,583 | 日语读音（含假名注记） |
| `kJapaneseKun` / `kJapaneseOn` | 11,296 / 13,177 | 训读 / 音读 |
| `kKorean` / `kHangul` | 9,050 / 8,525 | 韩语 |
| `kVietnamese` | 8,306 | 越南语 |
| `kZhuang` | 2,472 | 壮语 |
| `kTang` | 3,811 | 中古音（Bernard Karlgren 拟音，`*tɑŋ`） |
| `kHanyuPinyin` | 34,130 | 《汉语大字典》音（卷次:页:位:音 格式） |
| `kHanyuPinlu` | 3,799 | 现汉词频+读音 |
| `kXHC1983` | 11,072 | 《现代汉语词典》1983 |
| `kTGHZ2013` | 8,105 | 《通用规范汉字字典》2013 |
| `kFanqie` | 20,222 | 反切 |
| `kSBGY` | 19,588 | 《宋本广韵》 |
| `kSMSZD2003Readings` | 8,110 | 《现代汉语词典》2003？读法 |

### Unihan_DictionaryLikeData.txt（12）

| 字段 | 条数 | 说明 |
|---|---|---|
| ★ `kCangjie` | 29,189 | **仓颉输入码**（`龍→YBYSP`）——以形查字的官方数据 |
| ★ `kFourCornerCode` | 16,916 | **四角号码**（`龍→0121.1`）——同上 |
| ★ `kUnihanCore2020` | 20,720 | 2020 版核心子集（值为收录该字的核心来源字母，如 `HJKMPT`），字体覆盖优先级 |
| `kPhonetic` | 24,948 | 声旁 |
| `kMojiJoho` | 52,515 | MJ 面映射（含 E0100+ 变体序列细分） |
| `kGradeLevel` | 2,632 | 日本学年 |
| `kHKGlyph` | 4,823 | 香港 Reference_Glyph |
| `kCheungBauer` | 809 | 张氏仓颉 |
| `kFenn` | 5,084 | Fenn 仓颉 |
| `kStrange` | 828 | "怪异"标记（如 `B:U+311B` 指注音符号等跨界同形） |
| `kHDZRadBreak` | 200 | 《汉语大字典》部首归部差异 |

### Unihan_OtherMappings.txt（23）

`kCNS1986`/`kCNS1992`（17,257）、`kCCCII`（19,697）、`kEACC`（13,254）、`kBigFive`（13,064）、`kGB0/1/3/5/8`（共 28,518）、`kJis0`/`kJis1`/`kJIS0213`（15,852）、`kXerox`（9,747）、`kTaiwanTelegraph`（9,024）、`kMainlandTelegraph`（7,078）、`kTGH`（8,105）、`kKoreanName`（6,367）、`kJoyoKanji`（2,140）、`kKoreanEducationHanja`（1,800）、`kJinmeiyoKanji`（864）、`kIBMJapan`（360）、`kPseudoGB1`（153）等——各国旧字符集↔Unicode 映射，做古籍/旧数据转码查证有用。

### Unihan_Variants.txt（8）★ 整组关键字段

| 字段 | 条数 | 说明 |
|---|---|---|
| `kSemanticVariant` | 3,563 | 语义异体（`U+5EDD<kMatthews`，可多值+多来源） |
| `kSpecializedSemanticVariant` | 525 | 特定领域语义异体 |
| `kSimplifiedVariant` | 7,290 | 简化指向（`龍→U+9F99`） |
| `kTraditionalVariant` | 6,840 | 繁化指向（成对出现） |
| `kJapaneseNewVariant` / `kJapaneseOldVariant` | 364 / 362 | 日本新/旧字体 |
| `kSpoofingVariant` | 353 | 易混形（安全场景） |
| `kZVariant` | 159 | Z-变体（字形学） |

### 其余两组

- `Unihan_RadicalStrokeCounts.txt`：`kRSAdobe_Japan1_6`（13,454；Adobe-Japan1-6 CID 部首笔画，日文字体排印用）。
- `Unihan_NumericValues.txt`：`kPrimaryNumeric`(20)/`kAccountingNumeric`(25)/`kOtherNumeric`(40)/`kVietnameseNumeric`(56)/`kZhuangNumeric`(14)/`kTayNumeric`(7)，合计仅 162 条。

## 6. 与本项目的关系（收录判定 + IDS 渲染）

**能回答：**
- 「码位 X 的笔画/部首/读音/释义/来源」→ 判定接口的**证据输出**与**候选校验**（IDS 候选字先用 kTotalStrokes 过滤——IDS 构件笔画和与 kTotalStrokes 不符者降权）；
- 「这个字是不是那个字的异体/简繁/易混」→ 8 个变体字段；
- 「以形查字」的官方结构化线索 → **kCangjie + kFourCornerCode**（4.6 万字覆盖；仓颉码本身即构件序列，与 IDS 构件树可互校，字形图片路径的又一特征源）；
- 「优先做字体覆盖的字」→ kUnihanCore2020（2 万字核心集，网页字体子集化的优先级依据）。

**不能回答（须另配数据）：**
- 构件分解 / IDS（→ chise-ids / cjkvi-ids / GlyphWiki）；
- 字形图像（→ GlyphWiki `uXXXX.png`）；
- 笔画顺序（→ KanjiVG / 汉字笔顺数据）；
- 待收录状态（→ IRG WS 数据 + [Pipeline](https://www.unicode.org/alloc/Pipeline.html)）。

**推荐管线**（承接 research-unicode.md）：

```
IDS/图片 → 候选码位列表（chise-ids 反查）
        → Unihan 校验过滤（kTotalStrokes/kRSUnicode）
        → 分级输出：已收录(码位+Age+kIRG_*Source) / 兼容等价(kCompatibilityVariant)
                   / 异体提示(kSemanticVariant…) / IVS / 待收录(WS+Pipeline) / 未收录
```

## 7. 版本演进要点

- `kUnihanCore2020`（15.0 新增）实质取代 `kIICore`（2005，仍保留，normative）；
- `kAlternateTotalStrokes` 从 kTotalStrokes 多值中拆出（15.1 起）；
- 已移除字段：`kIRGDaeJaweon`、`kIRGDaiKanwaZiten`、`kIRGKangXi`（并入字典索引字段）；
- 新近加入：`kStrange`、`kSMSZD2003Index/Readings`、`kTGH` 等；
- 展望（[Ken Lunde 2026 报告](https://ken-lunde.medium.com/2026-state-of-the-unification-report-5dde65b49828)）：v19.0 新增 Components-A/B 构件块后，IDS 数据库维护者可用正式码位表示构件，Unihan 覆盖将再 +494；IRG WS2024（约 1 万字）预计 v20 成 Ext K。

## 8. 解析与落地（本仓库）

- 已下载：`references/unihan/`（18.0.0，8 文件）；生产代码建议锁定版本号 URL 下载并记录 UCD 版本；
- 解析极简：TSV 三列，`grep`/`awk`/任意语言按 `\t` 切分即可；建索引建议——
  1. `码位 → 属性 dict`（全量内存 ~200MB 文本，或只取★字段，<30MB）；
  2. `kCangjie/kFourCornerCode → [码位]` 倒排（以形查字）；
  3. `kRSUnicode → [码位]` 倒排（部首笔画查字）；
- 状态分级提醒：仅 `kRSUnicode`、`kCompatibilityVariant`、`kIICore`、`kIRG_*Source` 为 normative，其余多为 provisional/informative——**作为过滤条件时容忍例外**（如 kTotalStrokes 允许 ±1 或用 kAlternateTotalStrokes 兜底）。

## 9. 参考

- [UAX #38: Unicode Han Database (Unihan)](https://www.unicode.org/reports/tr38/)（字段状态与语法的唯一权威）
- [Unihan.zip 下载（版本化）](https://www.unicode.org/Public/18.0.0/ucd/Unihan.zip) · [latest](https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip)
- [Unihan Lookup](https://www.unicode.org/charts/unihan.html) · [Unihan Search](https://www.unicode.org/charts/unihansearch.html) · [unicode-org/unihan-database](https://github.com/unicode-org/unihan-database)
- [Ken Lunde: 2026 State of the Unification](https://ken-lunde.medium.com/2026-state-of-the-unification-report-5dde65b49828) · [Wikipedia: CJK Unified Ideographs](https://en.wikipedia.org/wiki/CJK_Unified_Ideographs)
- 第三方工具：[unihan-etl](https://github.com/cihai/unihan-etl) / [unihan-db](https://github.com/cihai/unihan-db)
