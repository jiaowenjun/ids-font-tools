/**
 * 布局引擎：IDS AST → 嵌套子格树。
 *
 * 坐标系统一为 em 方格 viewBox 0 0 1000 1000（y 轴向下）。
 * 字形数据为字体原始坐标（y 轴向上），在叶节点 transform 中完成翻转。
 *
 * IDS 只描述相对结构，不含比例——布局表为本项目的调参核心，
 * 所有子格参数集中在 SPLITS，便于对照真实宋体字形迭代。
 */
import type { IDS } from './parse'
import { children, parse } from './parse'
import { lookup, VIEW_W, viewportH, type GlyphDB } from './glyphStore'

export interface Cell {
  x: number
  y: number
  w: number
  h: number
}

export interface LayoutLeaf {
  kind: 'leaf'
  char: string
  cp: string
  /** 在父结构中的角色（left/right/above/...），根节点为 'root' */
  role: string
  /** 所在子格（missing 占位框、悬停高亮用） */
  cell: Cell
  /** 字形库缺字 */
  missing: boolean
  /** 由 CHISE 兜底拆解得到（M1） */
  inferred: boolean
  transform?: string
  path?: string
}

export interface LayoutGroup {
  kind: 'group'
  op: string
  role: string
  cell: Cell
  children: LayoutNode[]
}

export type LayoutNode = LayoutLeaf | LayoutGroup

/** 缺字时查找兜底拆解（如 𠦝 → ⿱十早）；返回 IDS 字符串或 null */
export type FallbackLookup = (char: string) => string | null

/**
 * 布局表：运算符 → 各子格 { cell 比例, 角色 }（基于全格 [0,1]²）。
 * 子格内不重叠由包围类的 inset 参数保证；⿻ 叠加除外。
 */
const SPLITS: Record<string, { cell: [number, number, number, number]; role: string }[]> = {
  '⿰': [
    { cell: [0, 0, 0.5, 1], role: 'left' },
    { cell: [0.5, 0, 0.5, 1], role: 'right' },
  ],
  '⿱': [
    { cell: [0, 0, 1, 0.5], role: 'above' },
    { cell: [0, 0.5, 1, 0.5], role: 'below' },
  ],
  '⿲': [
    { cell: [0, 0, 1 / 3, 1], role: 'left' },
    { cell: [1 / 3, 0, 1 / 3, 1], role: 'middle' },
    { cell: [2 / 3, 0, 1 / 3, 1], role: 'right' },
  ],
  '⿳': [
    { cell: [0, 0, 1, 1 / 3], role: 'above' },
    { cell: [0, 1 / 3, 1, 1 / 3], role: 'middle' },
    { cell: [0, 2 / 3, 1, 1 / 3], role: 'below' },
  ],
  // 全包围（囗）：内字内缩 ~17%
  '⿴': [
    { cell: [0, 0, 1, 1], role: 'outside' },
    { cell: [0.17, 0.17, 0.66, 0.66], role: 'inside' },
  ],
  // 从上包围（冂）：内字靠下
  '⿵': [
    { cell: [0, 0, 1, 1], role: 'outside' },
    { cell: [0.15, 0.3, 0.7, 0.56], role: 'inside' },
  ],
  // 从下包围（凵）：内字靠上
  '⿶': [
    { cell: [0, 0, 1, 1], role: 'outside' },
    { cell: [0.15, 0.1, 0.7, 0.56], role: 'inside' },
  ],
  // 从左包围（匚）：内字靠右
  '⿷': [
    { cell: [0, 0, 1, 1], role: 'outside' },
    { cell: [0.3, 0.15, 0.55, 0.7], role: 'inside' },
  ],
  // 从左上包围（尸/户）：内字右下
  '⿸': [
    { cell: [0, 0, 1, 1], role: 'outside' },
    { cell: [0.3, 0.32, 0.62, 0.56], role: 'inside' },
  ],
  // 从右上包围（𠃌 类）：内字左下
  '⿹': [
    { cell: [0, 0, 1, 1], role: 'outside' },
    { cell: [0.08, 0.32, 0.62, 0.56], role: 'inside' },
  ],
  // 从左下包围（辶）：内字右上
  '⿺': [
    { cell: [0, 0, 1, 1], role: 'outside' },
    { cell: [0.33, 0.05, 0.62, 0.66], role: 'inside' },
  ],
  // 叠加：两构件同格
  '⿻': [
    { cell: [0, 0, 1, 1], role: 'back' },
    { cell: [0, 0, 1, 1], role: 'front' },
  ],
}

const SCALE = VIEW_W

/**
 * 标准字面框 → 视口 cell（y-down）。
 * 字体 y-up [upem, descent] 映射到视口 y-down [0, viewportH]。
 */
export function faceCellOf(db: GlyphDB): Cell {
  const vh = viewportH(db)
  if (!db.faceBox) return { x: 0, y: 0, w: SCALE, h: vh }
  const k = SCALE / db.upem
  const [x0, y0, x1, y1] = db.faceBox
  const top = (db.upem - y1) * k
  const bottom = (db.upem - y0) * k
  return { x: x0 * k, y: top, w: (x1 - x0) * k, h: bottom - top }
}

/** 对整棵 IDS 树布局。根 cell 为该字体的标准字面框（faceBox），使合成字与真实字同大、同基线位置。 */
export function layoutTree(
  ids: IDS,
  db: GlyphDB,
  fallback?: FallbackLookup,
  role = 'root',
  cell?: Cell,
  inferred = false,
): LayoutNode {
  cell ??= faceCellOf(db)
  if (ids.type === 'char') {
    const char = (ids as { char: string }).char
    const leaf = fitLeaf(char, db, cell, role, inferred)
    if (!leaf.missing || !fallback) return leaf
    // 缺字 → 用兜底 IDS（如 𠦝 → ⿱十早）递归布局，仍失败则退回缺字叶
    const alt = fallback(char)
    if (!alt) return leaf
    const parsed = parse(alt)
    if (!parsed) return leaf
    return layoutTree(parsed, db, fallback, role, cell, true)
  }
  if (ids.type === 'html') {
    return { kind: 'leaf', char: `&${(ids as { code: string }).code};`, cp: '?', role, cell, missing: true, inferred }
  }
  const split = SPLITS[ids.type as string]
  if (!split) {
    return { kind: 'leaf', char: String(ids.type), cp: '?', role, cell, missing: true, inferred }
  }
  const kids = children(ids)
  return {
    kind: 'group',
    op: ids.type as string,
    role,
    cell,
    children: split.map((s, i) =>
      layoutTree(
        kids[i],
        db,
        fallback,
        s.role,
        {
          x: cell.x + s.cell[0] * cell.w,
          y: cell.y + s.cell[1] * cell.h,
          w: s.cell[2] * cell.w,
          h: s.cell[3] * cell.h,
        },
        inferred,
      ),
    ),
  }
}

/**
 * 叶节点适配：ink bbox 各向异性缩放 + 居中 + y 翻转。
 *
 * 各轴独立适配子格（真实 CJK 排版中左右结构部件全高、横向压缩，
 * 上下结构部件全宽、纵向压缩——非等比），但拉伸倍率钳制在等比的
 * MAXR 以内，防「一」「丨」等笔画类部件被过度拉粗。
 */
const MAXR = 2.0

function fitLeaf(char: string, db: GlyphDB, cell: Cell, role: string, inferred: boolean): LayoutLeaf {
  const cp = char.codePointAt(0)!.toString(16).toUpperCase()
  const g = lookup(db, char)
  if (!g || !g.path) {
    return { kind: 'leaf', char, cp, role, cell, missing: true, inferred }
  }
  const [x0, y0, x1, y1] = g.bounds ?? [0, 0, g.advance, db.upem]
  const gw = Math.max(1e-6, x1 - x0)
  const gh = Math.max(1e-6, y1 - y0)
  const sx0 = cell.w / gw
  const sy0 = cell.h / gh
  const sIso = Math.min(sx0, sy0)
  const sx = Math.min(sx0, sIso * MAXR)
  const sy = Math.min(sy0, sIso * MAXR)
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const mx = cell.x + cell.w / 2
  const my = cell.y + cell.h / 2
  return {
    kind: 'leaf',
    char,
    cp,
    role,
    cell,
    missing: false,
    inferred,
    transform: `translate(${r(mx)} ${r(my)}) scale(${r(sx)} ${r(-sy)}) translate(${r(-cx)} ${r(-cy)})`,
    path: g.path,
  }
}

const r = (n: number) => Math.round(n * 1000) / 1000
