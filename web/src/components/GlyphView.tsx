/**
 * 字体真实字形视图（非合成）：按码位取 glyphs.json 的原生轮廓直接绘制。
 * 视口几何与合成视图一致（em + descent 行框），两者可公平对比大小。
 * 字形数据未提取时回退为浏览器直渲染宋体原字体（@font-face 按需加载平面 TTF）。
 */
import { useEffect } from 'react'
import { lookup, type GlyphDB } from '../core/glyphStore'
import { preloadZhsw, ZHSW_STACK } from '../core/zhswFont'

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
    // 行框比例与上方 SVG 视口一致（(upem-descent)/upem），两分支高度可对齐
    return <ZhswChar ch={ch} size={size} color={color} className={className} lineHeight={vh / db.upem} />
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

/** 用宋体原字体（@font-face 按需加载）渲染单字；未就绪/不覆盖时系统字体兜底 */
export function ZhswChar(props: {
  ch: string
  size: number
  color?: string
  className?: string
  lineHeight?: number
}) {
  const { ch, size, color = 'currentColor', className, lineHeight = 1.25 } = props
  useEffect(() => preloadZhsw(ch), [ch])
  return (
    <span className={className} style={{ fontSize: size, color, fontFamily: ZHSW_STACK, lineHeight }}>
      {ch}
    </span>
  )
}
