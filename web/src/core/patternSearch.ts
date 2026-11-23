/**
 * 按部件反查：IDS 模式（含通配符）→ 候选字列表。
 *
 * 模式语法 = IDS 序列 + 通配符叶（x / X / *，拉丁字母不会出现在 IDS 部件中，无歧义），
 * 通配符匹配对应槽位的整个部件子树（单字或嵌套组合均可）。
 * 如 ⿰x几 = 左右结构且右部件为「几」→ 机 叽 肌 饥 凯 …
 *
 * 数据源：ids-unicode-index.json 全量键（CHISE + cjkvi 反查口径）。
 * 全量 107k 键一次性预解析（浏览器约 150ms，分块调度避免卡顿），
 * 之后每次全扫描匹配仅 ~10ms，可随输入实时搜索。
 * 约 3k 条源数据无法解析（无运算符的裸序列、⿼⿽ 等新增 IDC），如实跳过并计数。
 */
import { parse, children, type IDS, type Character, type HTMLCode } from './parse'
import type { UnicodeIndex } from './unicodeIndex'

const WILDCARDS = new Set(['x', 'X', '*'])

/** 命中：一个码位一条（同一码位多条 IDS 描述去重合并） */
export interface PatternHit {
  cp: string
  inFont: boolean
  /** 首选 IDS 描述（点击载入工坊用） */
  ids: string
  /** 该码位所有命中描述（tooltip 展示） */
  idsAll: string[]
}

export interface PreparedSearchIndex {
  entries: { ids: string; ast: IDS; cands: [string, number][] }[]
  /** 无法解析而跳过的源键数 */
  skipped: number
  /** 高频字码位 → 频序（glyphs-frequent.txt，行序即频序） */
  freqRank: Map<string, number>
}

/** 模式即普通 IDS 解析（x / * 自然解析为 char 叶再按通配符解读）；宽容去除空白 */
export function parsePattern(pattern: string): IDS | null {
  return parse(pattern.replace(/\s+/g, ''))
}

const isWildcard = (n: IDS): boolean =>
  n.type === 'char' && WILDCARDS.has((n as Character).char)

/** 结构化匹配：模式与键的 AST 逐节点比对，通配符叶吞掉整棵子树 */
export function matchPattern(pattern: IDS, node: IDS): boolean {
  if (isWildcard(pattern)) return true
  if (pattern.type === 'char' || pattern.type === 'html') {
    if (node.type !== pattern.type) return false
    return pattern.type === 'char'
      ? (pattern as Character).char === (node as Character).char
      : (pattern as HTMLCode).code === (node as HTMLCode).code
  }
  if (node.type !== pattern.type) return false
  const pc = children(pattern)
  const nc = children(node)
  return pc.length === nc.length && pc.every((p, i) => matchPattern(p, nc[i]))
}

let prepCache: { idx: UnicodeIndex; promise: Promise<PreparedSearchIndex> } | null = null
let freqCache: Promise<Map<string, number>> | null = null

/** 高频字频序表（加载失败按空表处理，仅影响排序） */
function loadFreqRank(): Promise<Map<string, number>> {
  freqCache ??= fetch(import.meta.env.BASE_URL + 'glyphs-frequent.txt')
    .then((r) => (r.ok ? r.text() : ''))
    .then((txt) => {
      const rank = new Map<string, number>()
      txt.split('\n').forEach((cp, i) => {
        if (cp.trim()) rank.set(cp.trim(), i)
      })
      return rank
    })
    .catch(() => new Map<string, number>())
  return freqCache
}

const PARSE_CHUNK = 20000

/**
 * 预解析索引（单例，按 UnicodeIndex 对象身份缓存；测试可传入自制索引与频序表）。
 * 分块 + setTimeout 让出主线程，避免 107k 键解析阻塞页面交互。
 */
export function prepareSearchIndex(
  idx: UnicodeIndex,
  freqRank?: Map<string, number>,
): Promise<PreparedSearchIndex> {
  // 显式传入频序表（测试）不走缓存，避免同 idx 异频序的缓存陷阱
  if (!freqRank && prepCache?.idx === idx) return prepCache.promise
  const promise = (async () => {
    const freq = freqRank ?? (await loadFreqRank())
    const keys = Object.keys(idx.index)
    const entries: PreparedSearchIndex['entries'] = []
    let skipped = 0
    for (let start = 0; start < keys.length; start += PARSE_CHUNK) {
      const end = Math.min(start + PARSE_CHUNK, keys.length)
      for (let i = start; i < end; i++) {
        const ast = parse(keys[i])
        if (ast) entries.push({ ids: keys[i], ast, cands: idx.index[keys[i]] })
        else skipped++
      }
      await new Promise((r) => setTimeout(r, 0)) // 让出主线程
    }
    return { entries, skipped, freqRank: freq }
  })()
  prepCache = { idx, promise }
  return promise
}

/**
 * 全扫描匹配。结果按高频在前、码位升序；同码位多条描述去重合并。
 * fontOnly=true 时仅保留中华书局宋体 cmap 已收录的码位。
 */
export function searchByPattern(
  prepared: PreparedSearchIndex,
  pattern: IDS,
  opts?: { fontOnly?: boolean },
): PatternHit[] {
  const fontOnly = opts?.fontOnly ?? false
  const byCp = new Map<string, PatternHit>()
  for (const e of prepared.entries) {
    if (!matchPattern(pattern, e.ast)) continue
    for (const [cp, f] of e.cands) {
      const inFont = f === 1
      if (fontOnly && !inFont) continue
      const hit = byCp.get(cp)
      if (hit) hit.idsAll.push(e.ids)
      else byCp.set(cp, { cp, inFont, ids: e.ids, idsAll: [e.ids] })
    }
  }
  const rank = (cp: string): number => prepared.freqRank.get(cp) ?? 1e9
  return [...byCp.values()].sort(
    (a, b) => rank(a.cp) - rank(b.cp) || parseInt(a.cp, 16) - parseInt(b.cp, 16),
  )
}
