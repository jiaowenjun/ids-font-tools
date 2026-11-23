import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse, flatten, children } from '../parse'
import { layoutTree } from '../layout'
import type { LayoutNode } from '../layout'
import type { GlyphDB } from '../glyphStore'
import {
  parsePattern,
  matchPattern,
  containsWildcard,
  prepareSearchIndex,
  searchByPattern,
} from '../patternSearch'
import { searchSimilar, suggestPatterns } from '../similarSearch'
import type { UnicodeIndex } from '../unicodeIndex'

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

describe('patternSearch', () => {
  it('通配符匹配单字部件与整棵子树', () => {
    const pat = parsePattern('⿰x几')!
    expect(matchPattern(pat, parse('⿰木几')!)).toBe(true) // 机
    expect(matchPattern(pat, parse('⿰⿰口耳几')!)).toBe(true) // 左槽为嵌套组合
    expect(matchPattern(pat, parse('⿰木子')!)).toBe(false) // 右部件不符
    expect(matchPattern(pat, parse('⿱木几')!)).toBe(false) // 结构符不符
    expect(matchPattern(pat, parse('⿰几木')!)).toBe(false) // 槽位不符
  })

  it('x / X / * 均为通配符，HTML 实体叶可被通配匹配', () => {
    expect(matchPattern(parsePattern('⿰X几')!, parse('⿰木几')!)).toBe(true)
    expect(matchPattern(parsePattern('⿰*几')!, parse('⿰木几')!)).toBe(true)
    expect(matchPattern(parsePattern('⿰x一')!, parse('⿰&A-xB;一')!)).toBe(true)
    expect(matchPattern(parsePattern('⿰&A-xB;一')!, parse('⿰木一')!)).toBe(false)
  })

  it('模式宽容空白；非法模式返回 null', () => {
    expect(parsePattern(' ⿰x几 ')).toEqual(parse('⿰x几'))
    expect(parsePattern('⿰x')).toBeNull()
    expect(parsePattern('⿰x几 y')).toBeNull() // 去空白后多余字符
  })

  it('containsWildcard：任意深度检测；拉丁 x 字面量即通配符', () => {
    expect(containsWildcard(parsePattern('⿰x几')!)).toBe(true)
    expect(containsWildcard(parsePattern('⿰亻⿱x山')!)).toBe(true) // 通配符在嵌套层
    expect(containsWildcard(parsePattern('⿰亻⿱巛山')!)).toBe(false) // 全具体
    expect(containsWildcard(parsePattern('⿰亻⿱巛X')!)).toBe(true) // X 同样计入
  })

  const miniIndex: UnicodeIndex = {
    note: 'test',
    index: {
      '⿰木几': [['673A', 1]], // 机 · 字体已收录
      '⿰口几': [['53FD', 1]], // 叽
      '⿰王几': [['7391', 1]], // 玑（简体，另一条描述见下）
      '⿰𤣩几': [['7391', 1]], // 玑（繁形部件描述 → 同码位去重）
      '⿰⿰口耳几': [['46B5', 0]], // 嵌套左槽 · 字体未收录
      '⿰木子': [['5B57', 1]], // 不应命中
      千北: [['5317', 1]], // 源数据怪癖：无法解析，跳过
    },
  }

  it('全扫描：命中、去重、fontOnly 过滤、跳过坏键', async () => {
    const prepared = await prepareSearchIndex(miniIndex, new Map())
    expect(prepared.skipped).toBe(1)
    expect(prepared.entries).toHaveLength(6)

    const all = searchByPattern(prepared, parsePattern('⿰x几')!)
    expect(all.map((h) => h.cp).sort()).toEqual(['46B5', '53FD', '673A', '7391'])
    const ji = all.find((h) => h.cp === '7391')!
    expect(ji.idsAll).toEqual(['⿰王几', '⿰𤣩几']) // 同码位两条描述按索引序合并

    const fontOnly = searchByPattern(prepared, parsePattern('⿰x几')!, { fontOnly: true })
    expect(fontOnly.map((h) => h.cp)).toEqual(['53FD', '673A', '7391']) // 无 46B5（未收录）
  })

  it('排序：高频字优先，其余按码位升序', async () => {
    const freq = new Map([
      ['673A', 500], // 机 高频
    ])
    const prepared = await prepareSearchIndex(miniIndex, freq)
    const hits = searchByPattern(prepared, parsePattern('⿰x几')!)
    expect(hits[0].cp).toBe('673A') // 高频置顶
    expect(hits.slice(1).map((h) => h.cp)).toEqual(['46B5', '53FD', '7391']) // 数值码位升序
  })
})

describe('similarSearch（近似描述）', () => {
  const idx: UnicodeIndex = {
    note: 'test',
    index: {
      '⿰亻𭗼': [['344E', 1]], // 㑎 · 𭗼=⿱巛山（真实案例）
      '⿰亻革': [['313BC', 0]], // 𱎼 · 仅共享亻
      '⿰木几': [['673A', 1]], // 机 · 无共享部件
    },
  }
  // 兜底映射：𡿸=⿳巛一囚、𭗼=⿱巛山（叶展开后两者共享 巛）
  const fallback: Record<string, string> = { '21FF8': '⿳巛一囚', '2D5FC': '⿱巛山' }

  it('同形异码部件：⿰亻𡿸 的近似首选是 㑎 ⿰亻𭗼', async () => {
    const prepared = await prepareSearchIndex(idx, new Map())
    const hits = searchSimilar(prepared, '⿰亻𡿸', fallback)
    // q={亻,巛,一,囚} vs 㑎={亻,巛,山} → 2/5=0.4；𱎼 1/5、机 0 均低于阈值
    expect(hits[0]?.cp).toBe('344E')
    expect(hits[0]?.score).toBeCloseTo(0.4)
    expect(hits).toHaveLength(1)
  })

  it('阈值之外的完全不同部件不产生建议', async () => {
    const prepared = await prepareSearchIndex(idx, new Map())
    expect(searchSimilar(prepared, '⿱日月', fallback)).toEqual([]) // 与库内描述无交集
  })
})

describe('suggestPatterns（结构族反查模式派生）', () => {
  it('顶层叶槽位依次替换为通配符', () => {
    expect(suggestPatterns('⿰亻𡿸')).toEqual(['⿰x𡿸', '⿰亻x'])
    expect(suggestPatterns('⿱十早')).toEqual(['⿱x早', '⿱十x'])
  })

  it('其余槽位存在嵌套子树时跳过该槽；单字/解析失败返回空', () => {
    expect(suggestPatterns('⿰⿱十早一')).toEqual([]) // 左槽为子树，右槽虽是叶也跳过
    expect(suggestPatterns('一')).toEqual([])
    expect(suggestPatterns('⿰x')).toEqual([])
  })
})
