# ids-font-tools

**IDS 合字工坊**：输入任意 IDS（表意文字描述序列，如 `⿰𠦝一`），自动完成收录判定并渲染单字——

1. 判定该序列描述的字符是否被 **Unicode 收录**（CHISE/cjkvi-ids 反查，多候选可切换），已收录给出码位；输入单个汉字（如 `袤`）则直查该字本身（Unicode 按 Unihan、字体按三平面 cmap 判定，并列出其 IDS 描述）
2. 判定是否被**中华书局宋体**（三平面 TTF）收录
3. 已收录且字形数据可用 → 预览**字体真实字形**；否则 → **方案 A（SVG 动态合成）**，缺字自动经 CHISE 兜底拆解

> 实施过程、三方案对比评估（SVG 动态合成 / OpenType 连字 / 图片字库）与最终取舍详见**[验收文档](docs/acceptance.md)**。最终保留 **方案 A**；B/C 评估结论与代码见 git 历史。

## 核心特性

- **判定链**：Unicode 收录 → 字体收录 → 真字形/合成，口径与降级原因在界面上如实标注
- **单字直查**：输入单个汉字即判定该字（Unicode 18.0 / 中华书局宋体收录），列出 CHISE / cjkvi 的 IDS 描述，按描述合成并与真字形并排对比；私用区、未分配码位如实判「未收录」
- **按部件反查**：IDS 模式 + 通配符（如 `⿰x几` = 左右结构·右为几）搜字体已收录的字，支持任意嵌套构型（`⿰亻⿱x山`、`⿴囗⿰xx`），全量索引预解析后实时匹配，点击结果载入工坊
- **私用区对照表**：中华书局宋体 15 平面的 4.2 万私用区字形既无 Unicode 码位，字体文件也不含结构信息，CHISE / cjkvi-ids 无法描述——`web/public/zhsw-pua-ids.json`（人工维护、入库）记录「IDS → 私用区码位」，加载时并入判定索引；命中后同走「字体收录 → 真字形/合成对比」，Unicode 一栏如实判「未收录」。描述未命中时字体一栏标「未判定」（≠ 字体没有）
- 任意 IDS 序列**即时渲染**（12 种经典运算符：⿰⿱⿲⿳⿴⿵⿶⿷⿸⿹⿺⿻，支持嵌套）
- **跨字体 cmap 合并路由**：三份平面字体（00/02/15）覆盖互斥，统一按码位路由取字形
- **CHISE 兜底拆解**：字形库缺字时自动查官方 IDS 描述递归拆解（如缺 `明` → `⿰日月`，可多级递归）
- **标准字面**：合成字与原字体真实汉字同大、同基线位置（faceBox 由 69 个常用字的 ink 包络统计）
- 构件树悬停联动、码位标注、复制原始 IDS；IDS 运算符以字体原生字形内联显示（防系统字体 tofu）
- **亮暗双主题**：随系统外观自动切换（`prefers-color-scheme`，无需刷新）；颜色全部收进 `web/src/index.css` 的语义变量，暗色主题只覆盖变量值

## 快速开始

```bash
# 1. 生成数据（需 fontTools：pip3 install fonttools）
python3 tools/build_unicode_index.py   # → ids-unicode-index.json（反查索引 + 字体 cmap / Unihan 已分配区间）+ glyphs-frequent.txt
python3 tools/extract_glyphs.py        # → glyphs.json（高频 3000 字真字形 + faceBox）
python3 tools/build_fallback.py        # → chise-fallback.json（2686 个高频构件兜底）

# 2. 启动
cd web && npm install && npm run dev   # http://localhost:5173
npm test                               # vitest（44 用例）
```

## 目录

```
assets/中华书局宋体/     三份平面字体（gitignored，需自行放置）
references/              IDS 参考仓库（gitignored：parse-ids、chise-ids、cjkvi-ids、unihan 等）
testcases/ids.txt        用例集（布局引擎覆盖面：嵌套/三元/包围等 8 例）
tools/
  build_unicode_index.py IDS→Unicode 反查索引 + 字体覆盖标记/区间 + Unihan 已分配区间 + 高频码位清单
  extract_glyphs.py      cmap 合并路由 + faceBox 统计 + 字形提取（含 IDS 运算符）
  build_fallback.py      CHISE/cjkvi-ids 高频构件兜底映射
web/                     Vite + React + TS
  src/core/              框架无关核心：parse / glyphStore / layout / unicodeIndex / patternSearch
  src/components/        IDSRenderer（合成）/ GlyphView（真字形）/ IdsText
  public/zhsw-pua-ids.json  私用区对照表（IDS → 私用区码位，人工维护、入库；其余 public 数据为衍生产物，gitignored）
docs/acceptance.md       验收文档（实现过程 · 问题与解决 · 评估结论）
```

## 布局引擎

`web/src/core/layout.ts`：`SPLITS` 表定义 12 种运算符的子格切分（包围类带 inset）；叶节点按 ink bbox **各向异性缩放 + 2× 拉伸钳制**（左右结构部件全高横向压缩、上下结构全宽纵向压缩，笔画类部件不变形）；根 cell 为标准字面框。

实测对照（合成 ink vs 原字体真实字形）：`⿱十早` vs `𠦝` 宽高差 ≤1.2%；`⿰𠦝一` vs `朝` 高差 2.5%、垂直中心 362 vs 361。

## 许可注意

中华书局宋体版权为方正电子。衍生产物（`glyphs.json`、`chise-fallback.json`）已 gitignore，仅限本地研究使用；再分发须获版权方授权。`parse-ids` 为 MIT（源码内保留版权注记）。
