/**
 * 字体真实字形视图（非合成）：按码位取 glyphs.json 的原生轮廓直接绘制。
 * 视口几何与合成视图一致（em + descent 行框），两者可公平对比大小。
 */
import { lookup, type GlyphDB } from '../core/glyphStore'

export function GlyphView(props: {
  cp: string
  db: GlyphDB
  size: number
  color?: string
  className?: string
}) {
  const { cp, db, size, color = 'currentColor', className } = props
  const ch = String.fromCodePoint(parseInt(cp, 16))
  const g = lookup(db, ch)
  const vh = ((db.upem - (db.hhea?.descent ?? -246)) / db.upem) * db.upem // 字体坐标行框高
  if (!g?.path) {
    return (
      <span className={className} style={{ fontSize: size, color, lineHeight: 1.25 }}>
        {ch}
      </span>
    )
  }
  return (
    <svg
      className={className}
      viewBox={`0 0 ${db.upem} ${vh}`}
      width={size}
      height={(size * vh) / db.upem}
      fill={color}
      style={{ display: 'block' }}
      aria-label={`U+${cp}`}
    >
      <g transform={`translate(0 ${db.upem}) scale(1 -1)`}>
        <path d={g.path} />
      </g>
    </svg>
  )
}
