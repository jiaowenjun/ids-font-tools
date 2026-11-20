# ids-font-tools

给定 IDS（表意文字描述序列），如 `⿰𠦝一`，从**中华书局宋体**（三平面 TTF）中提取部件字形，在网页中实时合成为完整单字。

> 实施过程、三方案对比评估（SVG 动态合成 / OpenType 连字 / 图片字库）与最终取舍详见**[验收文档](docs/acceptance.md)**。经对比评估，最终保留 **方案 A（SVG 动态合成）**；方案 B/C 的评估结论与代码见 git 历史。

## 核心特性

- 任意 IDS 序列**即时渲染**（12 种经典运算符：⿰⿱⿲⿳⿴⿵⿶⿷⿸⿹⿺⿻，支持嵌套）
- **跨字体 cmap 合并路由**：三份平面字体（00/02/15）覆盖互斥，统一按码位路由取字形
- **CHISE 兜底拆解**：字形库缺字时自动查官方 IDS 描述递归拆解（如缺 `明` → `⿰日月`，可多级递归）
- **标准字面**：合成字与原字体真实汉字同大、同基线位置（faceBox 由 69 个常用字的 ink 包络统计）
- 构件树悬停联动、码位标注、复制原始 IDS；IDS 运算符以字体原生字形内联显示（防系统字体 tofu）

## 快速开始

```bash
# 1. 生成字形数据（需 fontTools：pip3 install fonttools）
python3 tools/extract_glyphs.py       # → web/public/glyphs.json（含 faceBox）
python3 tools/build_fallback.py       # → web/public/chise-fallback.json（2686 个高频构件）

# 2. 启动
cd web && npm install && npm run dev   # http://localhost:5173
npm test                               # vitest（15 用例）
```

## 目录

```
assets/中华书局宋体/     三份平面字体（gitignored，需自行放置）
references/              IDS 参考仓库（gitignored：parse-ids、chise-ids、cjkvi-ids 等）
testcases/ids.txt        用例集（布局引擎覆盖面：嵌套/三元/包围等 8 例）
tools/
  extract_glyphs.py      cmap 合并路由 + faceBox 统计 + 字形提取（含 IDS 运算符）
  build_fallback.py      CHISE/cjkvi-ids 高频构件兜底映射
web/                     Vite + React + TS
  src/core/              框架无关核心：parse（移植 parse-ids，MIT）/ glyphStore / layout
  src/components/        IDSRenderer（<IDSRenderer ids="⿰𠦝一" />）/ IdsText
docs/acceptance.md       验收文档（实现过程 · 问题与解决 · 评估结论）
```

## 布局引擎

`web/src/core/layout.ts`：`SPLITS` 表定义 12 种运算符的子格切分（包围类带 inset）；叶节点按 ink bbox **各向异性缩放 + 2× 拉伸钳制**（左右结构部件全高横向压缩、上下结构全宽纵向压缩，笔画类部件不变形）；根 cell 为标准字面框。

实测对照（合成 ink vs 原字体真实字形）：`⿱十早` vs `𠦝` 宽高差 ≤1.2%；`⿰𠦝一` vs `朝` 高差 2.5%、垂直中心 362 vs 361。

## 许可注意

中华书局宋体版权为方正电子。衍生产物（`glyphs.json`、`chise-fallback.json`）已 gitignore，仅限本地研究使用；再分发须获版权方授权。`parse-ids` 为 MIT（源码内保留版权注记）。
