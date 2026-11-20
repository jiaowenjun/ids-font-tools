# IDS→单字渲染：三方案对比实现计划

> 状态：实施中（2026-11-20）。本文档是经实测验证后的实施计划存档。

## Context

项目目标：给定 IDS 序列（如 `⿰𠦝一`），从 `assets/中华书局宋体` 三份 TTF 中取部件字形、合成为单字并在网页展示。**三种方案（A 动态 SVG / B OpenType 连字 / C 图片字库）全部实现以对比效果**。

## 可行性实测结论

| 验证点 | 结论 | 证据 |
|---|---|---|
| 部件字形存在 | ✅ | `𠦝 U+2099D`（02平面字体）、`一 U+4E00`、`⿰ U+2FF0`（00平面字体）均有映射。注意 `𠦝` 真实码位是 **U+2099D**（U+2599D 是 `𥦝`） |
| 轮廓→SVG 可行 | ✅ | fontTools 实测提取 `𠦝` 成功：path 长 571，bounds=(28,-139,987,861)，upem=1024，TrueType 轮廓 |
| 架构约束 | ⚠️ | 三份字体按平面分工、覆盖互斥（00平面无 U+2099D / 02平面无 U+4E00）→ **必须建跨字体 cmap 合并路由层** |
| 递归兜底 | ✅ | CHISE 实测 `𠦝 = ⿱十早`，`十`/`早` 为 BMP 常用字（00平面必有） |
| Parser | ✅ 免开发 | `references/parse-ids`（MIT、零依赖纯 TS）含 12 种运算符类型化 AST，直接复制使用 |
| 布局规则 | ⚠️ 需自建 | KAGE 的比例内嵌在 GlyphWiki 数据中非算法；需自定义运算符→子格矩阵表并调参 |
| 许可 | ⚠️ | 字体版权方正电子 → 所有衍生产物（glyphs.json、合成字体、导出 SVG）**gitignore，不入库分发**，仅本地对比 |

## 核心架构

三方案共享同一条管线 `Parse → Resolve → Layout → SVG path`，仅消费端不同：

- **方案 A**：运行时 SVG（`<IDSRenderer ids="⿰𠦝一" />`）
- **方案 B**：离线用同一布局引擎生成合成字形，fontTools 注入 GSUB 连字，产出专用 TTF
- **方案 C**：离线批量导出 SVG 文件 + manifest.json（即预渲染缓存）

布局引擎单一实现在 TS（`web/src/core/`）；Python (fontTools) 只做字形提取与字体注入，不做布局——避免双实现漂移。

## 实施步骤

### M0 核心管线 + 方案 A 最小可用
1. 计划存档（本文件）、`.gitignore` 追加产物路径
2. `testcases/ids.txt` 用例集（含 `⿰𠦝一`、`⿰日月`、`⿱十早`、嵌套/三元/包围结构）
3. `tools/extract_glyphs.py`：三字体 cmap 合并路由 → `web/public/glyphs.json`
4. `web/src/core/parse.ts`：复制 parse-ids（保留 MIT 注记）
5. `web/src/core/layout.ts`：运算符→子格矩阵表（em 方格 [0,1]²），子格内按 bounds 等比缩放居中
6. `web/src/core/render.ts`：AST → 嵌套 `<g transform>`
7. `IDSRenderer.tsx` + App 首页（输入、实时渲染、构件树悬停联动、复制 IDS）

### M1 方案 A 完整版
- `tools/build_fallback.py`：从 chise-ids/cjkvi-ids 提取缺字码位的兜底拆解 → `chise-fallback.json`
- `core/fallback.ts`：缺字时递归拆解（如缺 `𠦝` 用 `⿱十早`），标记"推断拆解"节点
- 对照真实宋体字形调参布局表

### M2 方案 B：OpenType 连字字体
- `tools/render_path.mjs`（薄壳调 core）+ `tools/build_ligature_font.py`（GSUB 注入）→ `web/public/fonts/ids-ligature.ttf`
- 视图 B：专用字体排版 IDS 原文，实测浏览器整形行为（成败均记录）

### M3 方案 C：图片字库
- `tools/export_glyph_files.mjs` → `web/public/glyphs/*.svg` + `manifest.json`
- 视图 C：gallery 以 `<img>` 引用

### M4 对比页
- 三列并排（A/B/C）× 用例集，字号 slider，对比维度表
- README 更新

## 验证

1. 单元测试：parse 合法/非法/嵌套；layout 子格矩阵守恒
2. 浏览器截图：`⿰𠦝一` 三方案出字；嵌套形式与直接形式视觉一致；`⿰日月` 对照"明"评估布局
3. 方案 B 专项：连字是否被应用（截图记录）
4. 兜底验证：临时移除 `𠦝` 仍能经 `⿱十早` 出字

## 风险与对策

- 布局美观度：无现成规则，对照真实字形迭代调参
- 浏览器可能不应用 IDS 连字：如实记录为方案 B 边界
- 方正版权：衍生产物仅本地、不入库
