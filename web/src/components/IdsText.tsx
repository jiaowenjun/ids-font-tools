/**
 * IDS 字符串的 UI 展示：运算符（系统字体普遍缺字）用 glyphs.json 内联 SVG 渲染，
 * 其余字符正常文本流。用于 chips、构件树、说明文字。
 */
import type { CSSProperties } from 'react'
import { lookup, type GlyphDB } from '../core/glyphStore'

const OPERATORS = new Set('⿰⿱⿲⿳⿴⿵⿶⿷⿸⿹⿺⿻⿼⿽')

export function IdsText({ ids, db, size = 14, style }: { ids: string; db: GlyphDB; size?: number; style?: CSSProperties }) {
  return (
    <span style={{ lineHeight: 1.2, ...style }}>
      {[...ids].map((ch, i) =>
        OPERATORS.has(ch) ? (
          <InlineGlyph key={i} char={ch} db={db} size={size * 0.92} />
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </span>
  )
}

/** 单字形内联小 SVG（按 ink bounds 裁剪，避免大方框留白） */
export function InlineGlyph({ char, db, size, color = 'currentColor' }: { char: string; db: GlyphDB; size: number; color?: string }) {
  const g = lookup(db, char)
  if (!g?.path) return <span style={{ fontSize: size }}>{char}</span>
  const [x0, y0, x1, y1] = g.bounds ?? [0, 0, g.advance, db.upem]
  const w = Math.max(1e-6, x1 - x0)
  const h = Math.max(1e-6, y1 - y0)
  const up = db.upem
  return (
    <svg
      width={size * (w / h)}
      height={size}
      viewBox={`${x0} ${up - y1} ${w} ${h}`}
      fill={color}
      style={{ verticalAlign: '-0.12em', margin: '0 0.05em' }}
      aria-label={char}
    >
      {/* 字体 y 轴向上：viewBox 翻转显示，path 需配合镜像 */}
      <g transform={`translate(0 ${up}) scale(1 -1)`}>
        <path d={g.path} />
      </g>
    </svg>
  )
}
