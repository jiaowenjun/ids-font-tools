import { useEffect, useMemo, useState } from 'react'
import { parse } from './core/parse'
import { layoutTree, type LayoutNode, type FallbackLookup } from './core/layout'
import { loadGlyphDB, type GlyphDB } from './core/glyphStore'
import { IDSRenderer } from './components/IDSRenderer'
import { IdsText } from './components/IdsText'
import { CASES } from './cases'

export default function App() {
  const [ids, setIds] = useState('⿰𠦝一')
  const [size, setSize] = useState(180)
  const [db, setDb] = useState<GlyphDB | null>(null)
  const [fallback, setFallback] = useState<FallbackLookup | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    loadGlyphDB()
      .then(setDb)
      .catch((e) => setErr(String(e)))
    // 加载 CHISE 兜底映射（缺字时递归拆解）
    fetch('chise-fallback.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Record<string, string[]> | null) => {
        if (j) setFallback(() => (ch: string) => {
          const list = j[ch.codePointAt(0)!.toString(16).toUpperCase()]
          return list?.[0] ?? null
        })
      })
      .catch(() => undefined)
  }, [])

  if (err) return <div className="container">字形库加载失败：{err}</div>
  if (!db) return <div className="container">加载字形库…</div>

  return (
    <div className="container">
      <header>
        <h1>IDS 单字渲染</h1>
        <p>
          输入 IDS 序列（如 <IdsText ids="⿰𠦝一" db={db} />），实时合成完整单字 · 部件取自中华书局宋体（三平面 TTF）
        </p>
      </header>

      <ViewA ids={ids} setIds={setIds} size={size} setSize={setSize} db={db} fallback={fallback} />
    </div>
  )
}

function ViewA(props: {
  ids: string
  setIds: (s: string) => void
  size: number
  setSize: (n: number) => void
  db: GlyphDB
  fallback: FallbackLookup | null
}) {
  const { ids, setIds, size, setSize, db, fallback } = props
  const [hoverCp, setHoverCp] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const layout = useMemo(() => {
    const ast = parse(ids)
    return ast ? layoutTree(ast, db, fallback ?? undefined) : null
  }, [ids, db, fallback])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ids)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard 不可用时忽略 */
    }
  }

  return (
    <>
      <div className="controls">
        <input
          type="text"
          value={ids}
          onChange={(e) => setIds(e.target.value)}
          placeholder="输入 IDS 序列，如 ⿰𠦝一"
          spellCheck={false}
        />
        <label>
          字号 {size}px
          <input type="range" min={40} max={320} value={size} onChange={(e) => setSize(+e.target.value)} />
        </label>
        <button className="primary" onClick={copy}>
          {copied ? '已复制 ✓' : '复制 IDS'}
        </button>
      </div>

      <div className="chip-row" style={{ marginBottom: 20 }}>
        {CASES.map((c) => (
          <button key={c.ids} className={`chip ${ids === c.ids ? 'active' : ''}`} title={c.note} onClick={() => setIds(c.ids)}>
            <IdsText ids={c.ids} db={db} />
          </button>
        ))}
      </div>

      <div className="grid-2">
        <div className="render-box">
          <IDSRenderer
            ids={ids}
            db={db}
            fallback={fallback ?? undefined}
            size={size}
            hoverCp={hoverCp}
            onHover={(cp) => setHoverCp(cp)}
          />
          <span className="hint">悬停构件查看码位；虚线框 = 字形库缺字</span>
        </div>
        <div className="panel">
          <h3 style={{ marginTop: 0, fontSize: 15 }}>构件树</h3>
          {layout ? (
            <div className="tree">
              <TreeView node={layout} db={db} hoverCp={hoverCp} setHoverCp={setHoverCp} />
            </div>
          ) : (
            <p className="hint">IDS 解析失败：括号不配对或字符数不足</p>
          )}
        </div>
      </div>
    </>
  )
}

function TreeView(props: {
  node: LayoutNode
  db: GlyphDB
  hoverCp: string | null
  setHoverCp: (cp: string | null) => void
  depth?: number
}) {
  const { node: n, db, hoverCp, setHoverCp } = props
  const depth = props.depth ?? 0
  const leafProps =
    n.kind === 'leaf'
      ? {
          className: `node${hoverCp === n.cp ? ' active' : ''}${n.missing ? ' missing' : ''}${n.inferred ? ' inferred' : ''}`,
          onMouseEnter: () => setHoverCp(n.cp),
          onMouseLeave: () => setHoverCp(null),
        }
      : { className: 'node' }

  if (n.kind === 'leaf') {
    return (
      <div style={{ paddingLeft: depth * 18 }} {...leafProps}>
        {n.char}
        <span className="cp">U+{n.cp}</span>
        {n.missing && <span className="cp">缺字{n.inferred ? '·兜底失败' : ''}</span>}
        {n.inferred && !n.missing && <span className="cp">兜底拆解</span>}
      </div>
    )
  }
  return (
    <div style={{ paddingLeft: depth * 18 }} {...leafProps}>
      <span className="op">
        <IdsText ids={n.op} db={db} />
      </span>
      {n.role !== 'root' && <span className="cp">{n.role}</span>}
      {n.children.map((c, i) => (
        <TreeView key={i} node={c} db={db} hoverCp={hoverCp} setHoverCp={setHoverCp} depth={depth + 1} />
      ))}
    </div>
  )
}
