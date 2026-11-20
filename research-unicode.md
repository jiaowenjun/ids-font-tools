# 调研：Unicode 中的汉字资源 与「判断某汉字是否被 Unicode 收录」任务

> 调研日期：2026-11-20（当前最新版本 Unicode 18.0，2026-09 发布）
>
> 任务定义：给定一个汉字字符 ——（a）提供 IDS 序列，或（b）提供字形图片 —— 判断该字是否被 Unicode 收录。

## 结论速览（TL;DR）

1. **Unicode 官方数据可以精确回答「码位 X 是否已分配给表意文字」**（UCD / Unihan），这是最终裁决数据源，体积小、离线可用。
2. **但官方不提供任何「结构 → 码位」的检索能力**：Unihan 没有 IDS/构件分解字段（只有部首-笔画 `kRSUnicode`、总笔画 `kTotalStrokes` 等粗粒度属性）；也没有以图搜字服务。两条输入路径都必须靠社区数据库做「查找」，再用官方数据做「裁决」。
3. **IDS 路径基本可精确自动化**：`码位 → IDS` 的全量映射已存在（CHISE、cjkvi-ids，本地 `references/` 已克隆），反向建索引即可；注意 IDS 与字符是多对多关系，输出应为「候选 + 证据」而非布尔值。
4. **字形图片路径没有可靠的官方/现成方案**：通用 OCR 对扩展区生僻字基本失效；Unicode 只提供码表 PDF 供人工比对。可行方向是「图片 →（人工/模型）拆构件 → 转走 IDS 路径」，或用 GlyphWiki 全量字形图像做相似度比对；相关研究见 AutoCJK、DiffCJK。
5. 「收录」本身有三个粒度：**常规收录 / 兼容等价（含 IVS 变体序列）/ 管线待收录**（IRG WS2024 预计成为 Ext K，约 2028 年 v20；v19.0 将新增 Components-A/B 构件块）。回答用户时应区分。

---

## 1. Unicode 官方资源清单

### 1.1 数据库与标准文档（可离线使用，判定为最终依据）

| 资源 | 内容 | 对本任务的用处 |
|---|---|---|
| [UCD](https://www.unicode.org/ucd/)：`UnicodeData.txt`、`Blocks.txt`、`DerivedAge.txt`、`DerivedCoreProperties.txt` | 码位分配、区块、收录版本（Age）、`Unified_Ideograph` 属性 | **核心**。`isAssigned(ch) && Unified_Ideograph` 即"已收录"；Age 可回答"哪个版本收录" |
| [Unihan 数据库](https://www.unicode.org/charts/unihan.html)（`Unihan.zip`，规范见 [UAX #38](https://www.unicode.org/reports/tr38/)） | 约 10 万表意字的官方属性：`kTotalStrokes`、`kRSUnicode`（部首.余笔）、`kDefinition`、`kIRG_*Source`（G/T/K/V/UTC/… 收录来源）、`kSemanticVariant`/`kZVariant` 等异体关系 | **核心**。验证候选字（笔画数校验）、追溯来源、判断异体关系。**注意：Unihan 不含 IDS 分解字段** |
| [UAX #45](https://www.unicode.org/reports/tr45/) U-source 表意文字 | UTC 来源字符的提交管线说明 | 了解"未收录字如何进入管线" |
| [UTS #37 / IVD](https://www.unicode.org/reports/tr37/)（[ivd.unicode.org](https://ivd.unicode.org/)） | 表意文字变体序列：同一码位 + 变体选择符表示字形差异 | "收录"的细粒度：某字形可能只能以 IVS 表示 |
| 核心规范第 18 章（Han） | IDS 渲染许可（research-case.md 已引用）、Han 编码总纲 | 佐证本项目 IDS→SVG 渲染的合法性 |
| [码表 PDF](https://www.unicode.org/charts/) 与 [Unihan 在线 Lookup](https://www.unicode.org/charts/unihan.html) / [Unihan Search](https://www.unicode.org/charts/unihansearch.html) / [Unicode Utilities](https://unicode-org.github.io/unicodetools/) | 逐字官方字形图、属性查询 | 人工查证；构建离线判定数据 |
| [新增字符管线 Pipeline](https://www.unicode.org/alloc/Pipeline.html) | 已批准、待发布的码位 | 回答"即将收录"（如 v19.0 Components 块） |

### 1.2 汉字区块规模（截至 Unicode 18.0）

| 区块 | 码位范围 | 收录版本 | 字数 |
|---|---|---|---|
| URO（基本区） | 4E00–9FFF | 1.0 | 20,992 |
| Ext A | 3400–4DBF | 3.0 | 6,592 |
| Ext B | 20000–2A6DF | 3.1 | 42,720 |
| Ext C | 2A700–2B73F | 5.2 | 4,160+ |
| Ext D | 2B740–2B81F | 6.0 | 222+ |
| Ext E | 2B820–2CEAF | 8.0 | 5,774+ |
| Ext F | 2CEB0–2EBEF | 10.0 | 7,473 |
| Ext G | 30000–3134F | 13.0 | 4,939 |
| Ext H | 31350–323AF | 15.0 | 4,192 |
| Ext I | 2EBF0–2EE5F | 15.1 | 622 |
| **Ext J（最新整块）** | 323B0–3347F | 17.0 (2025) | 4,298 |

- 统一表意文字合计约 **101,997**；另有 CJK 兼容表意文字两区（F900–、2F800–）约 1,000 字，均有 `Equivalent_Unified_Ideograph` 映射回统一区（[Wikipedia: CJK Unified Ideographs](https://en.wikipedia.org/wiki/CJK_Unified_Ideographs)）。
- **管线中**：v19.0 将新增 **CJK Unified Ideographs Components-A/B**（U+2FA20–2FA9F 119 字 + U+2FAA0–2FC1F 375 字）——把 IDS 常用构件作为正式码位编码，对 IDS 数据规范化是重大利好；IRG WS2024（约 1 万字）预计成为 **Ext K（约 v20，2028）**（[Ken Lunde 2026 State of the Unification](https://ken-lunde.medium.com/2026-state-of-the-unification-report-5dde65b49828)）。
- ⚠️ 各扩展块尾部有**未分配保留码位**：落在汉字区块内 ≠ 已收录；必须查 UCD 分配状态。

---

## 2. 两条输入路径的可行性评估

### 路径 A：IDS 序列 → 是否收录 ✅ 可行（社区数据 + 官方裁决）

Unicode 官方在此路径零支持（Unihan 无 IDS），但社区数据完整：

| 数据源 | 状态 | 说明 |
|---|---|---|
| **chise-ids**（本地 `references/chise-ids`） | ✅ 已克隆 | UCS 全区（Basic/Ext A–G）+ 大藏经 + CNS + 康熙 + HNG 等 TSV：`U+4E06 ⇥ 丆 ⇥ ⿱一丿`，直接反向索引 |
| **cjkvi-ids**（本地） | ✅ 已克隆 | 合并库 `ids.txt` + **`ws2015-ids.txt`（IRG 工作集，即"待收录"字的 IDS）** + 韩日异体 |
| **GlyphWiki**（[glyphwiki.org](https://glyphwiki.org/wiki/GlyphWiki:%E3%83%A1%E3%82%A4%E3%83%B3%E3%83%9A%E3%83%BC%E3%82%B8)） | 在线 / [dump.tar.gz 每日全量](https://en.glyphwiki.org/wiki/GlyphWiki:%E9%AB%98%E5%BA%A6%E3%81%AA%E6%B4%BB%E7%94%A8%E6%96%B9%E6%B3%95) | 百万级字形，每个 glyph 带 IDS 分解；`u4e00` 命名条目与码位一一对应 |
| **ipfs-ids-find**（本地） | ✅ 已克隆 | 按构件检字的现成 npm 模块（任务 A 交互原型） |
| **zi.tools 字統网** | 在线 | IDS 表达式直接搜字（`⿰金昜`→鍚），整合 GlyphWiki 字形，可当产品交互标杆 |
| **CHISE IDS Find** | 在线 [chise.org/ids-find](https://www.chise.org/ids-find) | 官方反查页；[gwsearch](https://kurgm.github.io/gwsearch/) 为 GlyphWiki 部品检索 |

实现要点与坑：
1. **IDS ↔ 字符是多对多**：同字多拆法（省略形/全形、⿻ 覆盖方向不明）→ 需用 `parse-ids`（本地）规范化后做树匹配/构件集合匹配；输出**候选列表**。
2. **IDS 命中 ≠ 同字**：IDS 只描述结构，结构相同可能是不存在的不同字或异体。候选需用 `kTotalStrokes`/`kRSUnicode`（Unihan）校验，最终留给人工确认。
3. **未命中 ≠ 未收录**：拆字数据库对新扩展（Ext H–J）覆盖滞后；应显式提示"数据覆盖范围"。
4. CHISE 数据使用 `&M-xxx;`/`&AJx;` 等**实体引用表示未编码构件**（PUA）——判定逻辑必须识别。
5. 输出分级：已收录（码位+Age+来源）→ 兼容等价 → IVS-only → IRG WS 待收录（ws2015-ids / Pipeline）→ 未收录（建议提交 IRG 或用本项目 PUA/IDS 渲染方案）。

### 路径 B：字形图片 → 是否收录 ⚠️ 无现成可靠方案，建议转为路径 A

- **官方**：只有码表 PDF / 在线逐字页，供人工翻查；无图像检索 API。
- **通用 OCR**（白描、Tesseract 等）：训练集以常用字为主，对 Ext 区生僻字识别率差，只能当辅助。
- **研究现状**（说明"10 万全集无成熟分类器"是公认痛点）：
  - [AutoCJK](https://github.com/google/autocjk)（Google 开源）：构件图像 → 低分辨率整字预测，专为缺训练数据的生僻字设计；
  - DiffCJK（arXiv 2404.05212, 2024）：扩散模型生成生僻字字形；
  - Apple 手写识别（30k 字级）远小于全集。
- **可行的产品化路径**：
  1. 上传图片 → 视觉 LLM 或人工识别/拆构件 → 得到候选字或候选 IDS → **复用路径 A 的确定性管线**；
  2. 用 GlyphWiki 按码位出图（`https://glyphwiki.org/glyph/u4e00.png`，亦有 SVG/JSON）构建全量比对集，做图像相似度 top-k → 人工确认；
  3. 本地 `unicopedia-sinica/renderer/fonts/`（459M，思源黑/宋 VF 全系 + PUA 构件字体）可用于渲染比对集，但思源对 Ext G–J 覆盖不全，需 GlyphWiki/花園明朝补齐。
- 产品形态建议：**候选 + 置信度 + 一键查证**，而非布尔答案。

---

## 3. 「是否收录」判定的输出分级（建议 API 语义）

```
1. 已收录        → { codepoint, block, age(版本), kIRG_*Source, 定义 }
2. 兼容/等价收录  → { compatCodepoint → Equivalent_Unified_Ideograph }
3. 仅字形变体    → { base + IVS（IVD 收录）}
4. 管线待收录    → { IRG WS / Pipeline，预计版本 }
5. 未收录        → { 建议走 IRG 提交 或 本项目 IDS/PUA 渲染 }
```

## 4. 缺口清单（需下载/补充）

- UCD 数据本体：`Unihan.zip`、`DerivedAge.txt`、`Blocks.txt`、`DerivedCoreProperties.txt`（约几 MB，unicode.org 免费）
- （可选）GlyphWiki `dump.tar.gz`（大，含未编码字）
- chise-ids 尚无 Ext H/I/J 专文件（上游覆盖滞后），判定结果需注明数据截止版本

## 5. 参考链接

- 官方：[Unihan Lookup](https://www.unicode.org/charts/unihan.html) · [UAX #38](https://www.unicode.org/reports/tr38/) · [UAX #45](https://www.unicode.org/reports/tr45/) · [UTS #37 IVD](https://www.unicode.org/reports/tr37/) · [Pipeline](https://www.unicode.org/alloc/Pipeline.html) · [Code Charts](https://www.unicode.org/charts/)
- 社区：[CHISE IDS Find](https://www.chise.org/ids-find) · [GlyphWiki](https://glyphwiki.org/wiki/GlyphWiki:%E3%83%A1%E3%82%A4%E3%83%B3%E3%83%9A%E3%83%BC%E3%82%B8) · [gwsearch 部品检索](https://kurgm.github.io/gwsearch/) · [zi.tools 字統网](https://zi.tools/) · [AutoCJK](https://github.com/google/autocjk)
- 综述：[Wikipedia: CJK Unified Ideographs](https://en.wikipedia.org/wiki/CJK_Unified_Ideographs) · [Ken Lunde: 2026 State of the Unification](https://ken-lunde.medium.com/2026-state-of-the-unification-report-5dde65b49828)
