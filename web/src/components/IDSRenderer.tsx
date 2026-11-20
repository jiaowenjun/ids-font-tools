/**
 * <IDSRenderer ids="⿰𠦝一" /> —— 方案 A 的 React 封装。
 *
 * 遍历 LayoutNode 生成 JSX（而非 innerHTML），以便：
 *  - 悬停任意构件高亮（data-cp + 事件）
 *  - CSS 控制 fill/stroke（currentColor 跟随文字颜色）
 */
import { useMemo } from 'react'
import { parse } from '../core/parse'
import { layoutTree, type LayoutNode, type FallbackLookup } from '../core/layout'
import { viewportH, type GlyphDB } from '../core/glyphStore'

export interface IDSRendererProps {
  ids: string
  db: GlyphDB
  fallback?: FallbackLookup
  /** 像素边长 */
  size?: number
  color?: string
  /** 悬停的码位（高亮对应叶/组） */
  hoverCp?: string | null
  onHover?: (cp: string | null, char: string | null) => void
  className?: string
}

export function IDSRenderer({
  ids,
  db,
  fallback,
  size = 120,
  color = 'currentColor',
  hoverCp,
  onHover,
  className,
}: IDSRendererProps) {
  const layout = useMemo(() => {
    const ast = parse(ids)
    return ast ? layoutTree(ast, db, fallback) : null
  }, [ids, db, fallback])

  if (!layout) {
    return (
      <div
        className={className}
        style={{ width: size, height: size, border: '2px dashed #c33', color: '#c33', display: 'grid', placeItems: 'center', fontSize: size / 8, padding: 4, textAlign: 'center' } as const}
      >
        IDS 解析失败
      </div>
    )
  }
  const vh = viewportH(db)
  return (
    <svg
      className={className}
      viewBox={`0 0 1000 ${vh}`}
      width={size}
      height={(size * vh) / 1000}
      fill={color}
      style={{ display: 'block' }}
    >
      {renderNode(layout, hoverCp, onHover)}
    </svg>
  )
}

function renderNode(
  n: LayoutNode,
  hoverCp: string | null | undefined,
  onHover?: (cp: string | null, char: string | null) => void,
  dim = false,
): React.ReactNode {
  const active = hoverCp != null && n.kind === 'leaf' && n.cp === hoverCp
  const childDim = dim || (hoverCp != null && !active)
  const handlers = onHover
    ? {
        onMouseEnter: () => onHover(n.kind === 'leaf' ? n.cp : null, n.kind === 'leaf' ? n.char : null),
        onMouseLeave: () => onHover(null, null),
      }
    : undefined
  const opacity = hoverCp != null ? (active ? 1 : dim ? 0.35 : 0.75) : 1

  if (n.kind === 'group') {
    return (
      <g key={n.op + n.role} data-op={n.op} {...handlers}>
        {n.children.map((c, i) => renderNode(c, hoverCp, onHover, childDim))}
      </g>
    )
  }
  if (n.missing) {
    return (
      <g key={n.cp + n.role} data-cp={n.cp} data-missing="1" {...handlers}>
        <rect
          x={n.cell.x}
          y={n.cell.y}
          width={n.cell.w}
          height={n.cell.h}
          fill="none"
          stroke="currentColor"
          strokeWidth={8}
          strokeDasharray="32 24"
          opacity={opacity}
        />
        <text
          x={n.cell.x + n.cell.w / 2}
          y={n.cell.y + n.cell.h / 2}
          fontSize={Math.min(n.cell.w, n.cell.h) / 3}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="sans-serif"
          opacity={opacity}
        >
          {n.char}
        </text>
      </g>
    )
  }
  return (
    <g
      key={n.cp + n.role}
      data-cp={n.cp}
      data-inferred={n.inferred ? 1 : undefined}
      transform={n.transform}
      opacity={opacity}
      {...handlers}
    >
      <path d={n.path} />
    </g>
  )
}
