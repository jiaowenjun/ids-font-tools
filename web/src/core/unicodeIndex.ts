/**
 * IDS → Unicode 收录反查（tools/build_unicode_index.py 的产物）。
 *
 * 口径：CHISE-IDS + cjkvi-ids 反查（Unihan 无 IDS 字段）；
 * 未命中 ≠ Unicode 绝对未收录，只是社区库中无此描述。
 * IDS 与字符是多对多：返回全部候选，首个为首选（预览对象）。
 */

export interface UnicodeCandidate {
  /** 大写 hex，无 U+ 前缀 */
  cp: string
  /** 码位是否在中华书局宋体三平面 cmap 中 */
  inFont: boolean
}

export interface UnicodeIndex {
  index: Record<string, [string, number][]>
  note: string
}

let cache: Promise<UnicodeIndex> | null = null

export function loadUnicodeIndex(): Promise<UnicodeIndex> {
  cache ??= fetch(import.meta.env.BASE_URL + 'ids-unicode-index.json').then((r) => {
    if (!r.ok) throw new Error(`ids-unicode-index.json 加载失败: ${r.status}`)
    return r.json() as Promise<UnicodeIndex>
  })
  return cache
}

export function lookupUnicode(idx: UnicodeIndex | null, ids: string): UnicodeCandidate[] {
  if (!idx) return []
  return (idx.index[ids] ?? []).map(toCand)
}

export const charOf = (cp: string): string => String.fromCodePoint(parseInt(cp, 16))
export const cpLabel = (cp: string): string => `U+${cp}`

/* ---------------- 层级规范化变体查询 ---------------- */

/**
 * CHISE 的描述层级惯例不统一：同一索引内原子式（⿰亻𭗼 → 㑎）与展开式
 * （⿰亻⿱䙲山 → 𠎣）并存，字面精确匹配时层级不同即未命中。
 * 信息本身完备：⿱巛山 → 𭗼 在索引里（折叠映射）、𭗼 → ⿱巛山 在兜底映射里
 * （展开映射）。miss 后生成一层「折叠 / 展开」变体重试：
 *   折叠：某子树若有编码字（索引逆查）→ 替换为该字，如 ⿰亻⿱巛山 → ⿰亻𭗼
 *   展开：某原子叶若有兜底拆解 → 替换为拆解串，如 ⿰亻䙲 → ⿰亻⿱䙲山（若已索引）
 */
import { children, parse, type IDS, type Character, type HTMLCode } from './parse'

const MAX_FRONTIER = 64 // BFS 每层变体数上限（防爆栈；正常输入变体个位数）

function serialize(n: IDS): string {
  if (n.type === 'char') return (n as Character).char
  if (n.type === 'html') return `&${(n as HTMLCode).code};`
  return String(n.type) + children(n).map(serialize).join('')
}

/** 以 replace 替换树中 target 节点（引用相等），返回新树；组节点按命名子字段重建 */
function substitute(n: IDS, target: IDS, replace: IDS): IDS {
  if (n === target) return replace
  if (n.type === 'char' || n.type === 'html') return n
  const src = n as unknown as Record<string, unknown>
  const out: Record<string, unknown> = { type: src.type }
  for (const k of Object.keys(src)) {
    if (k !== 'type') out[k] = substitute(src[k] as IDS, target, replace)
  }
  return out as unknown as IDS
}

function variantStrings(ids: string, idx: UnicodeIndex, fallback: Record<string, string>): string[] {
  const ast = parse(ids)
  if (!ast || ast.type === 'char' || ast.type === 'html') return []
  const groups: IDS[] = []
  const leaves: IDS[] = []
  const walk = (n: IDS) => {
    if (n.type === 'char') leaves.push(n)
    else if (n.type !== 'html') {
      if (n !== ast) groups.push(n)
      children(n).forEach(walk)
    }
  }
  walk(ast)
  const out: string[] = []
  // 折叠：子树 → 编码字（索引逆查全部候选）
  for (const g of groups) {
    const hit = idx.index[serialize(g)]
    if (!hit) continue
    for (const [cp] of hit.slice(0, 3)) {
      const leaf: IDS = { type: 'char', char: charOf(cp) } as IDS
      out.push(serialize(substitute(ast, g, leaf)))
    }
  }
  // 展开：原子叶 → 兜底拆解串
  for (const l of leaves) {
    const alt = fallback[(l as Character).char.codePointAt(0)!.toString(16).toUpperCase()]
    if (!alt) continue
    const parsed = parse(alt)
    if (parsed) out.push(serialize(substitute(ast, l, parsed)))
  }
  return [...new Set(out)]
}

export interface VariantLookup {
  candidates: UnicodeCandidate[]
  /** 命中的键（层级规范化变体时 ≠ 原输入；null = 未命中） */
  matchedIds: string | null
}

/** 精确查询 + 层级规范化变体重试（BFS ≤ 2 层） */
export function lookupUnicodeVariants(
  idx: UnicodeIndex | null,
  ids: string,
  fallback: Record<string, string> | null,
): VariantLookup {
  if (!idx) return { candidates: [], matchedIds: null }
  const direct = idx.index[ids]
  if (direct) return { candidates: direct.map(toCand), matchedIds: ids }
  let frontier = [ids]
  for (let depth = 0; depth < 2 && frontier.length; depth++) {
    const next: string[] = []
    for (const s of frontier.slice(0, MAX_FRONTIER)) {
      for (const v of variantStrings(s, idx, fallback ?? {})) {
        if (v === ids || v === s) continue
        const hit = idx.index[v]
        if (hit) return { candidates: hit.map(toCand), matchedIds: v }
        next.push(v)
      }
    }
    const uniq = [...new Set(next)]
    frontier = uniq.slice(0, MAX_FRONTIER)
  }
  return { candidates: [], matchedIds: null }
}

const toCand = ([cp, f]: [string, number]): UnicodeCandidate => ({ cp, inFont: f === 1 })
