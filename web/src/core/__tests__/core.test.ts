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
import { inRanges, isPua, lookupUnicodeVariants, mergePuaIds, type PuaIds } from '../unicodeIndex'
import { webFontCovers } from '../zhswFont'

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

describe('lookupUnicodeVariants（层级规范化变体查询）', () => {
  const idx: UnicodeIndex = {
    note: 'test',
    index: {
      '⿰亻𭗼': [['344E', 1]], // 㑎 · 原子式（𭗼 有编码）
      '⿱巛山': [['2D5FC', 1]], // 𭗼 自身（折叠映射源）
      '⿰亻⿱䙲山': [['203A3', 1]], // 𠎣 · 展开式（䙲 有编码却展开，惯例不统一）
    },
  }
  const fallback: Record<string, string> = { '2D5FC': '⿱巛山', '4672': '⿱䙲山' }

  it('精确命中：matchedIds 为原输入', () => {
    const r = lookupUnicodeVariants(idx, '⿰亻𭗼', fallback)
    expect(r.matchedIds).toBe('⿰亻𭗼')
    expect(r.candidates).toEqual([{ cp: '344E', inFont: true }])
  })

  it('折叠变体：⿰亻⿱巛山 → ⿰亻𭗼 命中 㑎', () => {
    const r = lookupUnicodeVariants(idx, '⿰亻⿱巛山', fallback)
    expect(r.matchedIds).toBe('⿰亻𭗼')
    expect(r.candidates[0]?.cp).toBe('344E')
  })

  it('展开变体：⿰亻䙲 → ⿰亻⿱䙲山 命中 𠎣', () => {
    const r = lookupUnicodeVariants(idx, '⿰亻䙲', fallback)
    expect(r.matchedIds).toBe('⿰亻⿱䙲山')
    expect(r.candidates[0]?.cp).toBe('203A3')
  })

  it('无变体可命中时返回空', () => {
    const r = lookupUnicodeVariants(idx, '⿰木木', fallback)
    expect(r.candidates).toEqual([])
    expect(r.matchedIds).toBeNull()
  })
})

describe('lookupUnicodeVariants（单字直查）', () => {
  // 袤 U+88A4：CHISE ⿴衣矛 / cjkvi ⿳亠矛𧘇；覃 U+8983 落在 Unihan 区间之外充当未分配码位
  const idx: UnicodeIndex = {
    note: 'test',
    index: {
      '⿴衣矛': [['88A4', 1]],
      '⿳亠矛𧘇': [['88A4', 1]],
    },
    font: [
      ['4E00', '9FFF'],
      ['E000', 'E000'],
      ['F0000', 'F0001'],
    ],
    unihan: { version: '18.0.0', ranges: [['4E00', '88A4']] },
  }
  const fallback: Record<string, string> = { '88A4': '⿴衣矛' }

  it('常见字「袤」：候选即自身，Unicode（Unihan）/ 字体均已收录，附全部 IDS 描述', () => {
    const r = lookupUnicodeVariants(idx, '袤', fallback)
    expect(r.stale).toBe(false)
    expect(r.candidates).toEqual([{ cp: '88A4', inFont: true, assigned: true }])
    expect(r.matchedIds).toBeNull()
    expect(r.identity).toEqual({
      basis: 'unihan',
      version: '18.0.0',
      description: '⿴衣矛',
      descriptions: ['⿴衣矛', '⿳亠矛𧘇'],
    })
  })

  it('无任何 IDS 描述的字（口）：判定不依赖社区库', () => {
    const r = lookupUnicodeVariants(idx, '口', {})
    expect(r.candidates).toEqual([{ cp: '53E3', inFont: true, assigned: true }])
    expect(r.identity?.basis).toBe('unihan')
    expect(r.identity?.descriptions).toEqual([])
    expect(r.identity?.description).toBeNull()
  })

  it('私用区码位：Unicode 未收录（PUA），字体收录如实（含平面 15）', () => {
    const r = lookupUnicodeVariants(idx, '\uE000', {})
    expect(r.identity?.basis).toBe('pua')
    expect(r.candidates).toEqual([{ cp: 'E000', inFont: true, assigned: false }])
    const r15 = lookupUnicodeVariants(idx, String.fromCodePoint(0xf0000), {})
    expect(r15.identity?.basis).toBe('pua')
    expect(r15.candidates).toEqual([{ cp: 'F0000', inFont: true, assigned: false }])
  })

  it('汉字区未分配码位：Unihan 无记录 → 未收录（字体有无分别如实）', () => {
    const inFont = lookupUnicodeVariants(idx, '覃', {})
    expect(inFont.identity?.basis).toBe('unassigned')
    expect(inFont.candidates).toEqual([{ cp: '8983', inFont: true, assigned: false }])
    const gap = lookupUnicodeVariants(idx, String.fromCodePoint(0x2a6e0), {}) // 扩展 B/C 之间的空隙
    expect(gap.identity?.basis).toBe('unassigned')
    expect(gap.candidates).toEqual([{ cp: '2A6E0', inFont: false, assigned: false }])
  })

  it('非字符码点：未收录；非汉字：按合法码位认定，字体未覆盖如实', () => {
    expect(lookupUnicodeVariants(idx, String.fromCodePoint(0xfffe), {}).identity?.basis).toBe('noncharacter')
    const r = lookupUnicodeVariants(idx, 'a', {})
    expect(r.identity?.basis).toBe('identity')
    expect(r.candidates).toEqual([{ cp: '61', inFont: false, assigned: true }])
  })

  it('无 Unihan 数据：汉字退化为码位认定，私用区/非字符仍可识别', () => {
    const noUnihan: UnicodeIndex = { ...idx, unihan: { version: null, ranges: [] } }
    expect(lookupUnicodeVariants(noUnihan, '覃', {}).identity).toMatchObject({ basis: 'identity', version: null })
    expect(lookupUnicodeVariants(noUnihan, '\uE000', {}).identity?.basis).toBe('pua')
  })

  it('旧版索引（无字体覆盖区间）：单字直查标记 stale，IDS 查询不受影响', () => {
    const old: UnicodeIndex = { note: 'old', index: idx.index }
    const r = lookupUnicodeVariants(old, '袤', fallback)
    expect(r.stale).toBe(true)
    expect(r.identity).toBeNull()
    expect(r.candidates).toEqual([])
    const hit = lookupUnicodeVariants(old, '⿴衣矛', fallback)
    expect(hit.stale).toBe(false)
    expect(hit.candidates).toEqual([{ cp: '88A4', inFont: true }])
  })

  it('inRanges：端点含边界，区间外为假', () => {
    expect(inRanges(idx.font!, 0x4e00)).toBe(true)
    expect(inRanges(idx.font!, 0x9fff)).toBe(true)
    expect(inRanges(idx.font!, 0x9fff + 1)).toBe(false)
    expect(inRanges(idx.font!, 0xdfff)).toBe(false)
    expect(inRanges([], 0x4e00)).toBe(false)
  })

  it('真实数据回归：袤（U+88A4，广袤）→ 已收录、字体✓、描述 ⿴衣矛 / ⿳亠矛𧘇', () => {
    const load = (f: string): unknown =>
      JSON.parse(readFileSync(fileURLToPath(new URL(`../../../public/${f}`, import.meta.url)), 'utf-8'))
    const r = lookupUnicodeVariants(
      load('ids-unicode-index.json') as UnicodeIndex,
      '袤',
      load('chise-fallback.json') as Record<string, string>,
    )
    expect(r.candidates).toEqual([{ cp: '88A4', inFont: true, assigned: true }])
    expect(r.identity).toMatchObject({ basis: 'unihan', version: '18.0.0' })
    expect(r.identity?.descriptions).toEqual(['⿴衣矛', '⿳亠矛𧘇'])
  })
})

describe('私用区对照表（mergePuaIds）', () => {
  const idx: UnicodeIndex = {
    note: 'test',
    index: { '⿰日月': [['660E', 1]], '⿰巾几': [['22052', 1]] }, // 后者 = 𢁒 的 CHISE 拆解（折叠映射源）
    font: [
      ['4E00', '9FFF'],
      ['F0000', 'F0001'],
      ['F1CDC', 'F1CDC'],
    ],
  }

  it('并入后描述可反查到私用区字形：Unicode 未收录，字体收录按 font 区间现算', () => {
    const m = mergePuaIds(idx, { note: '', index: { '⿱一𢁒': ['f1cdc', ' F1CDD '] } })
    const r = lookupUnicodeVariants(m, '⿱一𢁒', {})
    expect(r.matchedIds).toBe('⿱一𢁒')
    expect(r.candidates).toEqual([
      { cp: 'F1CDC', inFont: true, assigned: false },
      { cp: 'F1CDD', inFont: false, assigned: false },
    ])
  })

  it('同键已有 CHISE 候选：私用区码位排其后并去重，原索引对象不被改动', () => {
    const m = mergePuaIds(idx, { note: '', index: { '⿰日月': ['660E', 'F0000', 'F0000'] } })
    expect(m.index['⿰日月']).toEqual([
      ['660E', 1],
      ['F0000', 1],
    ])
    expect(idx.index['⿰日月']).toEqual([['660E', 1]])
    expect(lookupUnicodeVariants(m, '⿰日月', {}).candidates).toEqual([
      { cp: '660E', inFont: true },
      { cp: 'F0000', inFont: true, assigned: false },
    ])
  })

  it('非法条目跳过：单字符键、非法码位、非私用区码位；空表 / null 原样返回', () => {
    const m = mergePuaIds(idx, {
      note: '',
      index: { 一: ['F1CDC'], '⿰木木': ['660E', 'ZZ', '110000', 'D800'], '⿰火火': [], '⿰水水': 'F1CDC' as unknown as string[] },
    })
    expect(m).toBe(idx)
    expect(mergePuaIds(idx, null)).toBe(idx)
    expect(mergePuaIds(idx, { note: '', index: {} })).toBe(idx)
  })

  it('层级规范化对对照表条目同样生效：⿱一⿰巾几 折叠 → ⿱一𢁒', () => {
    const m = mergePuaIds(idx, { note: '', index: { '⿱一𢁒': ['F1CDC'] } })
    const r = lookupUnicodeVariants(m, '⿱一⿰巾几', { '22052': '⿰巾几' })
    expect(r.matchedIds).toBe('⿱一𢁒')
    expect(r.candidates).toEqual([{ cp: 'F1CDC', inFont: true, assigned: false }])
  })

  it('真实数据回归：⿱一𢁒 → 字体 15 平面 U+F1CDC（Unicode 未收录、字体✓），表中码位均可渲染真字形', () => {
    const load = (f: string): unknown =>
      JSON.parse(readFileSync(fileURLToPath(new URL(`../../../public/${f}`, import.meta.url)), 'utf-8'))
    const real = load('ids-unicode-index.json') as UnicodeIndex
    const pua = load('zhsw-pua-ids.json') as PuaIds
    const fallback = load('chise-fallback.json') as Record<string, string>
    // 不并入对照表时确实无命中——对照表存在的理由
    expect(lookupUnicodeVariants(real, '⿱一𢁒', fallback).candidates).toEqual([])
    const r = lookupUnicodeVariants(mergePuaIds(real, pua), '⿱一𢁒', fallback)
    expect(r.candidates).toEqual([{ cp: 'F1CDC', inFont: true, assigned: false }])
    for (const cps of Object.values(pua.index)) {
      for (const cp of cps) {
        expect(isPua(parseInt(cp, 16))).toBe(true)
        expect(inRanges(real.font!, parseInt(cp, 16))).toBe(true) // 三平面 cmap
        expect(webFontCovers(String.fromCodePoint(parseInt(cp, 16)))).toBe(true) // Web 字体登记区段
      }
    }
  })
})

describe('webFontCovers（Web 字体登记区段）', () => {
  it('CJK 区段与平面 15 私用区已登记；ASCII 等区外字符未登记（cmap 有也不由 Web 字体渲染）', () => {
    expect(webFontCovers('袤')).toBe(true) // U+88A4 · 00 平面
    expect(webFontCovers(String.fromCodePoint(0xf0000))).toBe(true) // 15 平面私用区
    expect(webFontCovers('⿰')).toBe(true) // U+2FF0 运算符
    expect(webFontCovers('a')).toBe(false) // U+0061
  })
})
