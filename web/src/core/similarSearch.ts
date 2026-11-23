/**
 * 近似描述搜索：精确反查未命中时，找「部件大部分一致」的已收录字。
 *
 * 动机（实测案例）：`⿰亻𡿸` 未命中（CHISE 无此精确描述），但用户意向很可能是
 * 㑎 U+344E `⿰亻𭗼`——𭗼(⿱巛山) 与 𡿸(⿳巛一囚) 不同形却高度相似。
 * 按递归展开后的叶部件集合算 Jaccard 相似度排序：
 *   q={亻,巛,一,囚} vs 㑎={亻,巛,山} → 2/5 = 0.4，稳定排到最前。
 *
 * 数据：PreparedSearchIndex（patternSearch 的 107k 预解析键）+ chise-fallback
 * 映射（叶展开；可解析闭包保证展开必到底，另设深度上限兜底）。
 * 叶集计算：字符级 memo 全局缓存 + 条目级 WeakMap 缓存，首次全量扫描
 * 约 1–3M 次集合操作（一次性 ~百 ms），此后每次仅打分。
 */
import { children, parse, type IDS, type Character } from './parse'
import type { PreparedSearchIndex } from './patternSearch'

export interface SimilarHit {
  cp: string
  inFont: boolean
  /** 命中键的 IDS 描述（点击载入工坊用） */
  ids: string
  /** 叶集 Jaccard 相似度 0..1 */
  score: number
}

const MAX_EXPAND_DEPTH = 8

export function searchSimilar(
  prepared: PreparedSearchIndex,
  ids: string,
  fallback: Record<string, string>,
  opts?: { limit?: number; minScore?: number },
): SimilarHit[] {
  const limit = opts?.limit ?? 8
  const minScore = opts?.minScore ?? 1 / 3
  const qAst = parse(ids)
  if (!qAst) return []

  // 字符 → 递归展开叶集（全查询共享缓存；条目间部件大量复用，命中率高）
  const charMemo = new Map<string, Set<string>>()
  const expandChar = (ch: string, depth: number): Set<string> => {
    const cached = charMemo.get(ch)
    if (cached) return cached
    const set = new Set<string>()
    const alt = depth < MAX_EXPAND_DEPTH ? fallback[ch.codePointAt(0)!.toString(16).toUpperCase()] : undefined
    const ast = alt ? parse(alt) : null
    if (ast) collect(ast, set, depth + 1)
    else set.add(ch)
    charMemo.set(ch, set)
    return set
  }
  const collect = (n: IDS, out: Set<string>, depth: number): void => {
    if (n.type === 'char') {
      expandChar((n as Character).char, depth).forEach((c) => out.add(c))
      return
    }
    children(n).forEach((c) => collect(c, out, depth + 1))
  }
  const q = new Set<string>()
  collect(qAst, q, 0)
  if (!q.size) return []

  // 条目叶集缓存：PreparedSearchIndex 的 entry 是稳定对象
  const entryLeaves = new WeakMap<IDS, Set<string>>()
  const leavesOf = (ast: IDS): Set<string> => {
    let s = entryLeaves.get(ast)
    if (!s) {
      s = new Set()
      collect(ast, s, 0)
      entryLeaves.set(ast, s)
    }
    return s
  }

  const byCp = new Map<string, SimilarHit>()
  for (const e of prepared.entries) {
    if (!e.cands.length) continue
    const [cp, f] = e.cands[0]
    // 候选字符本身已出现在查询串里（如 ⿰亻𡿸 建议𡿸自己）无信息量，跳过
    if (ids.includes(String.fromCodePoint(parseInt(cp, 16)))) continue
    const s = leavesOf(e.ast)
    let inter = 0
    q.forEach((c) => {
      if (s.has(c)) inter++
    })
    const score = inter / (q.size + s.size - inter)
    if (score < minScore) continue
    const hit = { cp, inFont: f === 1, ids: e.ids, score }
    const prev = byCp.get(cp)
    if (!prev || hit.score > prev.score) byCp.set(cp, hit)
  }
  const rank = (cp: string): number => prepared.freqRank.get(cp) ?? 1e9
  return [...byCp.values()]
    .sort((a, b) => b.score - a.score || rank(a.cp) - rank(b.cp) || parseInt(a.cp, 16) - parseInt(b.cp, 16))
    .slice(0, limit)
}

/**
 * 由未命中的 IDS 派生反查模式：顶层每个「单字叶」槽位依次替换为通配符 x
 * （其余槽位必须也是单字叶，嵌套子树无法拍平成模式串则跳过该槽）。
 * 如 ⿰亻𡿸 → ['⿰x𡿸', '⿰亻x']——反查结果完备覆盖该结构族（㑎 必在 ⿰亻x 中）。
 */
export function suggestPatterns(ids: string): string[] {
  const ast = parse(ids)
  if (!ast || ast.type === 'char' || ast.type === 'html') return []
  const op = ast.type as string
  const kids = children(ast as { type: string })
  const chars = kids.map((k) => (k.type === 'char' ? (k as Character).char : null))
  const out: string[] = []
  kids.forEach((k, i) => {
    if (k.type !== 'char') return
    if (chars.some((c, j) => j !== i && c === null)) return // 其他槽存在嵌套子树
    out.push(op + chars.map((c, j) => (j === i ? 'x' : c)).join(''))
  })
  return out
}
