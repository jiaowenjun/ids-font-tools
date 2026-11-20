/**
 * IDS (Ideographic Description Sequence) 解析器。
 *
 * 移植自 parse-ids (https://github.com/tomcumming/parse-ids)，MIT License，
 * Copyright (c) Tom Cumming <mail@tomcumming.co.uk>。
 * 重写为数据驱动（运算符→元数→子字段名），行为与原版一致。
 */

export const compositions = '⿰⿱⿲⿳⿴⿵⿶⿷⿸⿹⿺⿻'

/** 运算符 → 子节点在 AST 接口中的字段名（顺序即 IDS 序列顺序） */
const FIELDS: Record<string, string[]> = {
  '⿰': ['left', 'right'],
  '⿱': ['above', 'below'],
  '⿲': ['left', 'middle', 'right'],
  '⿳': ['above', 'middle', 'below'],
  '⿴': ['outside', 'inside'],
  '⿵': ['outside', 'inside'],
  '⿶': ['outside', 'inside'],
  '⿷': ['outside', 'inside'],
  '⿸': ['outside', 'inside'],
  '⿹': ['outside', 'inside'],
  '⿺': ['outside', 'inside'],
  '⿻': ['back', 'front'],
}

export type IDS = Character | HTMLCode | { type: string; [k: string]: unknown }

export interface Character {
  type: 'char'
  char: string
}

export interface HTMLCode {
  type: 'html'
  code: string
}

/** 返回节点的直接子节点 */
export function children(ids: IDS): IDS[] {
  const fields = FIELDS[ids.type as string]
  if (!fields) return []
  const node = ids as unknown as Record<string, unknown>
  return fields.map((f) => node[f] as IDS)
}

/** 展平为叶节点列表 */
export function flatten(ids: IDS): (Character | HTMLCode)[] {
  if (ids.type === 'char' || ids.type === 'html') return [ids as Character | HTMLCode]
  return children(ids).flatMap(flatten)
}

/** 解析完整的 IDS 字符串，失败返回 null */
export function parse(str: string): IDS | null {
  const parsed = parsePart(str)
  return parsed !== null && parsed.rest === '' ? parsed.ids : null
}

function parsePart(str: string): { ids: IDS; rest: string } | null {
  if (str.length === 0) return null
  const next = [...str][0]
  const rest = str.slice(next.length)

  if (next === '&') {
    const end = rest.indexOf(';')
    if (end === -1) return null
    return { ids: { type: 'html', code: rest.slice(0, end) }, rest: rest.slice(end + 1) }
  }
  const fields = FIELDS[next]
  if (fields) {
    const parts = parseParts(rest, fields.length)
    if (parts === null) return null
    const node: Record<string, unknown> = { type: next }
    fields.forEach((f, i) => (node[f] = parts.ids[i]))
    return { ids: node as unknown as IDS, rest: parts.rest }
  }
  return { ids: { type: 'char', char: next }, rest }
}

function parseParts(str: string, count: number): { ids: IDS[]; rest: string } | null {
  const ids: IDS[] = []
  for (let i = 0; i < count; i++) {
    const parsed = parsePart(str)
    if (parsed === null) return null
    ids.push(parsed.ids)
    str = parsed.rest
  }
  return { ids, rest: str }
}
