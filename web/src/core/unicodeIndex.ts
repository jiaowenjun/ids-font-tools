/**
 * IDS → Unicode 收录反查（tools/build_unicode_index.py 的产物）。
 *
 * 口径：CHISE-IDS + cjkvi-ids 反查（Unihan 无 IDS 字段）；
 * 未命中 ≠ Unicode 绝对未收录，只是社区库中无此描述。
 * IDS 与字符是多对多：返回全部候选，首个为首选（预览对象）。
 * 单字输入不走描述反查而是「单字直查」：候选即该字自身，Unicode 收录查
 * Unihan、字体收录查三平面 cmap，见 lookupUnicodeVariants。
 * 私用区对照表（zhsw-pua-ids.json）在加载时并入 index，命中后与其余描述同路。
 */

export interface UnicodeCandidate {
  /** 大写 hex，无 U+ 前缀 */
  cp: string
  /** 码位是否在中华书局宋体三平面 cmap 中 */
  inFont: boolean
  /**
   * Unicode 是否已分配该码位。CHISE / cjkvi 描述反查命中的候选恒为已收录（不设此字段）；
   * 单字直查给出判定；码位落在私用区（对照表候选）恒为 false。false 即「未收录」
   * （私用区 / 未分配 / 非字符）
   */
  assigned?: boolean
}

export interface UnicodeIndex {
  index: Record<string, [string, number][]>
  /** 中华书局宋体三平面 cmap 并集的闭区间（大写 hex，升序互不相接）；缺失 = 旧版数据 */
  font?: [string, string][]
  /** Unihan 已分配汉字（统一表意文字 + 兼容表意文字）的闭区间；ranges 为空 = 构建时无 Unihan 数据 */
  unihan?: { version: string | null; ranges: [string, string][] }
  note: string
}

/**
 * 私用区对照表（web/public/zhsw-pua-ids.json，人工维护、入库）。
 * 中华书局宋体 15 平面的 4.2 万私用区字形：字体文件不含结构信息（post 3.0 无字形名、
 * 全字体无复合字形），CHISE / cjkvi-ids 只描述 Unicode 已分配码位——没有本表，
 * 这些字形无法由 IDS 描述反查到。键 = IDS 描述，值 = 大写 hex 码位。
 */
export interface PuaIds {
  note: string
  index: Record<string, string[]>
}

let cache: Promise<UnicodeIndex> | null = null

export function loadUnicodeIndex(): Promise<UnicodeIndex> {
  cache ??= Promise.all([
    fetch(import.meta.env.BASE_URL + 'ids-unicode-index.json').then((r) => {
      if (!r.ok) throw new Error(`ids-unicode-index.json 加载失败: ${r.status}`)
      return r.json() as Promise<UnicodeIndex>
    }),
    // 对照表缺失/损坏不致命：退化为不含私用区条目的索引
    fetch(import.meta.env.BASE_URL + 'zhsw-pua-ids.json')
      .then((r) => (r.ok ? (r.json() as Promise<PuaIds>) : null))
      .catch(() => null),
  ]).then(([idx, pua]) => mergePuaIds(idx, pua))
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
  /** 单字直查结果（输入为单个字符时非空） */
  identity: IdentityLookup | null
  /** 索引为旧版数据（无字体覆盖区间），单字直查不可用；IDS 查询不受影响 */
  stale: boolean
}

const miss = (): VariantLookup => ({ candidates: [], matchedIds: null, identity: null, stale: false })

/** 精确查询 + 层级规范化变体重试（BFS ≤ 2 层）；单字输入转单字直查 */
export function lookupUnicodeVariants(
  idx: UnicodeIndex | null,
  ids: string,
  fallback: Record<string, string> | null,
): VariantLookup {
  if (!idx) return miss()
  const direct = idx.index[ids]
  if (direct) return { candidates: direct.map(toCand), matchedIds: ids, identity: null, stale: false }
  const ast = parse(ids)
  if (ast?.type === 'char') return lookupIdentity(idx, (ast as Character).char, fallback ?? {})
  let frontier = [ids]
  for (let depth = 0; depth < 2 && frontier.length; depth++) {
    const next: string[] = []
    for (const s of frontier.slice(0, MAX_FRONTIER)) {
      for (const v of variantStrings(s, idx, fallback ?? {})) {
        if (v === ids || v === s) continue
        const hit = idx.index[v]
        if (hit) return { candidates: hit.map(toCand), matchedIds: v, identity: null, stale: false }
        next.push(v)
      }
    }
    const uniq = [...new Set(next)]
    frontier = uniq.slice(0, MAX_FRONTIER)
  }
  return miss()
}

const toCand = ([cp, f]: [string, number]): UnicodeCandidate => {
  const c: UnicodeCandidate = { cp, inFont: f === 1 }
  if (isPua(parseInt(cp, 16))) c.assigned = false // 私用区码位：字体厂商私有映射，不是 Unicode 字符
  return c
}

/** 码位是否在私用区（BMP U+E000–F8FF；平面 15/16 补充私用区） */
export const isPua = (cp: number): boolean =>
  (cp >= 0xe000 && cp <= 0xf8ff) || (cp >= 0xf0000 && cp <= 0x10fffd)

/**
 * 把私用区对照表并入索引（纯函数，返回新对象）：同键已有 CHISE / cjkvi 候选时
 * 私用区码位排在其后；字体收录标记按 font 区间现算（旧版索引无区间 → 0）。
 * 非法条目跳过：单字符键、非法码位、非私用区码位（本表只收私用区）。
 */
export function mergePuaIds(idx: UnicodeIndex, pua: PuaIds | null): UnicodeIndex {
  if (!pua?.index) return idx
  const index: Record<string, [string, number][]> = { ...idx.index }
  let merged = 0
  for (const [raw, cps] of Object.entries(pua.index)) {
    const ids = raw.trim()
    const ast = ids ? parse(ids) : null
    if (!ast || ast.type === 'char' || ast.type === 'html') continue
    const entry = [...(index[ids] ?? [])]
    for (const rawCp of Array.isArray(cps) ? cps : []) {
      const cp = rawCp.trim().toUpperCase()
      if (!/^[0-9A-F]{4,6}$/.test(cp)) continue
      const n = parseInt(cp, 16)
      if (!isPua(n) || entry.some(([c]) => c === cp)) continue
      entry.push([cp, idx.font && inRanges(idx.font, n) ? 1 : 0])
    }
    if (entry.length > (index[ids]?.length ?? 0)) {
      index[ids] = entry
      merged++
    }
  }
  return merged ? { ...idx, index } : idx
}

/* ---------------- 单字直查 ---------------- */

/** 单字直查的 Unicode 收录判定依据（未收录时即原因） */
export type AssignedBasis = 'unihan' | 'identity' | 'pua' | 'unassigned' | 'surrogate' | 'noncharacter'

export interface IdentityLookup {
  basis: AssignedBasis
  /** Unihan 版本（无数据为 null） */
  version: string | null
  /** 合成侧所用的 IDS 描述（兜底映射中可解析者）；无则 null */
  description: string | null
  /** 该字的全部 IDS 描述（索引逆查，源文件序） */
  descriptions: string[]
}

/**
 * 输入本身就是字符而非「描述」：候选即该字的码位。
 *
 * 索引键全是长度 ≥ 2 的描述串（CHISE 的单字描述如「口 → 口」构建时即被丢弃），
 * 字面反查对单字必然落空——也不能改由描述反推收录：字体有字形的 134k 码位里
 * 45.9k 没有任何描述（私用区 4.2 万、无描述汉字 126 个……）。故 Unicode 收录直接
 * 查 Unihan 已分配区间，字体收录直接查三平面 cmap 覆盖区间，均与有无描述无关。
 */

/** 汉字区包络：扩展 A、BMP 统一表意文字、兼容表意文字，及整体预留给 CJK 扩展的平面 2–3（SIP/TIP） */
const CJK_ENVELOPE: [string, string][] = [
  ['3400', '4DBF'],
  ['4E00', '9FFF'],
  ['F900', 'FAFF'],
  ['20000', '3FFFF'],
]
const ASSIGNED: readonly AssignedBasis[] = ['unihan', 'identity']

/** 码位是否落在升序闭区间表内（二分） */
export function inRanges(ranges: [string, string][], cp: number): boolean {
  let lo = 0
  let hi = ranges.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const [a, b] = ranges[mid]
    if (cp < parseInt(a, 16)) hi = mid - 1
    else if (cp > parseInt(b, 16)) lo = mid + 1
    else return true
  }
  return false
}

function assignedBasis(idx: UnicodeIndex, cp: number): AssignedBasis {
  if (cp >= 0xd800 && cp <= 0xdfff) return 'surrogate'
  if ((cp & 0xfffe) === 0xfffe) return 'noncharacter'
  if (isPua(cp)) return 'pua'
  // 汉字区以 Unihan 为准（预留未分配码位如实判未收录）；区外字符没有权威数据，按合法码位认定
  const ranges = idx.unihan?.ranges
  if (ranges?.length && inRanges(CJK_ENVELOPE, cp)) return inRanges(ranges, cp) ? 'unihan' : 'unassigned'
  return 'identity'
}

const descriptionsCache = new WeakMap<UnicodeIndex, Map<string, string[]>>()

/** 码位的全部 IDS 描述（索引逆查，源文件序）；全表扫描约 107k 键，按索引对象缓存 */
export function descriptionsOf(idx: UnicodeIndex, cp: string): string[] {
  let perIdx = descriptionsCache.get(idx)
  if (!perIdx) {
    perIdx = new Map()
    descriptionsCache.set(idx, perIdx)
  }
  let hit = perIdx.get(cp)
  if (!hit) {
    hit = []
    for (const [ids, cands] of Object.entries(idx.index)) if (cands.some(([c]) => c === cp)) hit.push(ids)
    perIdx.set(cp, hit)
  }
  return hit
}

function lookupIdentity(idx: UnicodeIndex, ch: string, fallback: Record<string, string>): VariantLookup {
  const n = ch.codePointAt(0)!
  const cp = n.toString(16).toUpperCase()
  if (!idx.font) return { candidates: [], matchedIds: null, identity: null, stale: true }
  const basis = assignedBasis(idx, n)
  const alt = fallback[cp]
  return {
    candidates: [{ cp, inFont: inRanges(idx.font, n), assigned: ASSIGNED.includes(basis) }],
    matchedIds: null,
    stale: false,
    identity: {
      basis,
      version: idx.unihan?.version ?? null,
      description: alt && parse(alt) ? alt : null,
      descriptions: descriptionsOf(idx, cp),
    },
  }
}
