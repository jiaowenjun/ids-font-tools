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
  return (idx.index[ids] ?? []).map(([cp, f]) => ({ cp, inFont: f === 1 }))
}

export const charOf = (cp: string): string => String.fromCodePoint(parseInt(cp, 16))
export const cpLabel = (cp: string): string => `U+${cp}`
