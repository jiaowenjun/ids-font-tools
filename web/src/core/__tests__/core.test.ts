import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse, flatten, children } from '../parse'
import { layoutTree } from '../layout'
import type { LayoutNode } from '../layout'
import type { GlyphDB } from '../glyphStore'

interface SimpleLeaf {
  char: string
  missing: boolean
  inferred: boolean
  cell: { x: number; w: number }
  transform?: string
  path?: string
}

const db: GlyphDB = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../public/glyphs.json', import.meta.url)), 'utf-8'),
)

describe('parse', () => {
  it('解析二元结构', () => {
    const t = parse('⿰𠦝一')!
    expect(t.type).toBe('⿰')
    expect(children(t)).toHaveLength(2)
  })

  it('解析嵌套结构', () => {
    const t = parse('⿰⿱十早一')!
    expect(t.type).toBe('⿰')
    expect(children(t)[0].type).toBe('⿱')
    const leaves = flatten(t).map((n) => (n.type === 'char' ? n.char : ''))
    expect(leaves.join('')).toBe('十早一')
  })

  it('解析三元结构', () => {
    const t = parse('⿲氵𠦝亍')!
    expect(children(t)).toHaveLength(3)
  })

  it('括号不配对返回 null', () => {
    expect(parse('⿰𠦝')).toBeNull()
    expect(parse('⿰')).toBeNull()
    expect(parse('⿲氵𠦝')).toBeNull()
  })

  it('多余字符返回 null', () => {
    expect(parse('⿰𠦝一x')).toBeNull()
  })

  it('HTML 实体引用（CHISE 数据兼容）', () => {
    const t = parse('⿰&A-xB;一')!
    const leaves = flatten(t)
    expect(leaves[0].type).toBe('html')
  })
})

describe('layout', () => {
  const TOLERANCE = 0.6 // 舍入误差容差（layout 用 3 位小数）

  // 无重叠要求仅针对包围类；⿻ 除外
  const NO_OVERLAP_OPS = ['⿰', '⿱', '⿲', '⿳']
  const CELL_OPS: Record<string, string[]> = {
    '⿰': ['日', '月'],
    '⿱': ['一', '大'],
    '⿲': ['氵', '十', '亍'],
    '⿳': ['一', '一', '大'],
    '⿴': ['囗', '十'],
    '⿺': ['辶', '十'],
  }

  for (const [op, parts] of Object.entries(CELL_OPS)) {
    it(`${op} 子格不越界且并集守恒`, () => {
      const ast = parse(op + parts.join(''))!
      const node = layoutTree(ast, db)
      expect(node.kind).toBe('group')
      if (node.kind !== 'group') return
      const root = node.cell // 根 cell = faceBox（标准字面框）
      const cells = node.children.map((c) => c.cell)
      // 所有子格落在根 cell（faceBox）内
      for (const cell of cells) {
        expect(cell.x).toBeGreaterThanOrEqual(root.x - TOLERANCE)
        expect(cell.y).toBeGreaterThanOrEqual(root.y - TOLERANCE)
        expect(cell.x + cell.w).toBeLessThanOrEqual(root.x + root.w + TOLERANCE)
        expect(cell.y + cell.h).toBeLessThanOrEqual(root.y + root.h + TOLERANCE)
      }
      if (NO_OVERLAP_OPS.includes(op)) {
        // 非包围结构：子格面积并集 = 根 cell 面积
        const area = cells.reduce((s, c) => s + c.w * c.h, 0)
        expect(Math.abs(area - root.w * root.h)).toBeLessThan(TOLERANCE * 4000)
      }
    })
  }

  it('faceBox 元数据存在且根 cell 匹配标准字面', () => {
    expect(db.faceBox).toBeDefined()
    const node = layoutTree(parse('⿰𠦝一')!, db)
    if (node.kind !== 'group') throw new Error('root should be group')
    const k = 1000 / db.upem
    const [x0, , x1] = db.faceBox!
    expect(node.cell.x).toBeCloseTo(x0 * k, 1)
    expect(node.cell.w).toBeCloseTo((x1 - x0) * k, 1)
    // faceBox 应约为 em 的 95%（全尺寸汉字字面率），而非撑满
    expect(node.cell.w / 1000).toBeGreaterThan(0.9)
    expect(node.cell.w / 1000).toBeLessThan(1.0)
  })

  it('⿰𠦝一 端到端：两叶均有字形且变换存在', () => {
    const node = layoutTree(parse('⿰𠦝一')!, db)
    const leaves = collectLeaves(node)
    expect(leaves).toHaveLength(2)
    expect(leaves.every((l) => !l.missing)).toBe(true)
    expect(leaves.every((l) => l.transform && l.path)).toBe(true)
    // 左叶中心在根 cell 左半，右叶中心在右半
    const [l, r] = leaves
    const root = node.kind === 'group' ? node.cell : { x: 0, w: 1000 }
    const midX = root.x + root.w / 2
    expect(l.cell.x + l.cell.w / 2).toBeLessThan(midX)
    expect(r.cell.x + r.cell.w / 2).toBeGreaterThan(midX)
  })

  it('缺字渲染为 missing 叶并可被兜底替换', () => {
    // 从 db 中移除 𠦝，触发兜底 ⿱十早
    const dbNoZao = { ...db, glyphs: { ...db.glyphs } }
    delete dbNoZao.glyphs['2099D']
    const plain = layoutTree(parse('⿰𠦝一')!, dbNoZao)
    const leaves = collectLeaves(plain)
    expect(leaves.some((l) => l.missing && l.char === '𠦝')).toBe(true)

    const fb = layoutTree(parse('⿰𠦝一')!, dbNoZao, (ch) => (ch === '𠦝' ? '⿱十早' : null))
    const fbLeaves = collectLeaves(fb)
    expect(fbLeaves.map((l) => l.char).join('')).toBe('十早一')
    expect(fbLeaves.every((l) => !l.missing)).toBe(true)
    expect(fbLeaves.some((l) => l.inferred)).toBe(true)
  })
})

function collectLeaves(n: LayoutNode): SimpleLeaf[] {
  if (n.kind === 'leaf') return [n]
  return n.children.flatMap(collectLeaves)
}
