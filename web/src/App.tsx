import { useEffect, useMemo, useState } from 'react'
import { parse } from './core/parse'
import { layoutTree, type LayoutNode, type FallbackLookup } from './core/layout'
import { loadGlyphDB, lookup, type GlyphDB } from './core/glyphStore'
import { loadUnicodeIndex, lookupUnicode, charOf, cpLabel, type UnicodeCandidate } from './core/unicodeIndex'
import { IDSRenderer } from './components/IDSRenderer'
import { GlyphView, ZhswChar } from './components/GlyphView'
import { registerZhswFonts } from './core/zhswFont'
import { IdsText } from './components/IdsText'
import {
  parsePattern,
  prepareSearchIndex,
  searchByPattern,
  type PreparedSearchIndex,
} from './core/patternSearch'
import { CASES } from './cases'

export default function App() {
  const [ids, setIds] = useState('⿰𠦝一')
  const [size, setSize] = useState(200)
  const [db, setDb] = useState<GlyphDB | null>(null)
  const [fallback, setFallback] = useState<FallbackLookup | null>(null)
  const [unicodeIdx, setUnicodeIdx] = useState<Awaited<ReturnType<typeof loadUnicodeIndex>> | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [selCp, setSelCp] = useState<string | null>(null) // 多候选时的预览对象

  useEffect(() => {
    loadGlyphDB().then(setDb).catch((e) => setErr(String(e)))
    registerZhswFonts() // 三平面 TTF @font-face（unicode-range 按需下载）
    loadUnicodeIndex().then(setUnicodeIdx).catch(() => setUnicodeIdx(null))
    // 加载 CHISE 兜底映射（缺字时递归拆解）
    fetch('chise-fallback.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Record<string, string[]> | null) => {
        if (j)
          setFallback(
            () => (ch: string) => {
              const list = j[ch.codePointAt(0)!.toString(16).toUpperCase()]
              return list?.[0] ?? null
            },
          )
      })
      .catch(() => undefined)
  }, [])

  if (err) return <div className="container">字形库加载失败：{err}</div>
  if (!db) return <div className="container">加载字形库…</div>

  return (
    <div className="container">
      <header>
        <h1>IDS 合字工坊</h1>
        <p>
          输入 IDS 序列（如 <IdsText ids="⿰𠦝一" db={db} />）→ 判定 Unicode / 字体收录 → 字体收录时真字形与方案 A 合成并排对比
          · 部件取自中华书局宋体（三平面 TTF）
        </p>
      </header>

      <Composer
        ids={ids}
        setIds={(s) => {
          setIds(s)
          setSelCp(null)
        }}
        db={db}
      />

      <div className="chip-row" style={{ marginBottom: 16 }}>
        {CASES.map((c) => (
          <button
            key={c.ids}
            className={`chip ${ids === c.ids ? 'active' : ''}`}
            title={c.note}
            onClick={() => {
              setIds(c.ids)
              setSelCp(null)
            }}
          >
            <IdsText ids={c.ids} db={db} />
          </button>
        ))}
      </div>

      <VerdictPanel ids={ids} unicodeIdx={unicodeIdx} selCp={selCp} setSelCp={setSelCp} />

      <Preview
        ids={ids}
        db={db}
        fallback={fallback}
        unicodeIdx={unicodeIdx}
        selCp={selCp}
        size={size}
        setSize={setSize}
      />

      <PatternSearch
        db={db}
        unicodeIdx={unicodeIdx}
        onPick={(hitIds, cp) => {
          setIds(hitIds)
          setSelCp(cp)
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }}
      />
    </div>
  )
}

/* ---------------- 按部件反查 ---------------- */

const SEARCH_CASES: [string, string][] = [
  ['⿰x几', '左右结构 · 右为几'],
  ['⿱艹x', '上下结构 · 上为艹'],
  ['⿴囗x', '全包围 · 内为口以外的部件'],
]

const MAX_SHOW = 300

function PatternSearch(props: {
  db: GlyphDB
  unicodeIdx: Awaited<ReturnType<typeof loadUnicodeIndex>> | null
  onPick: (ids: string, cp: string) => void
}) {
  const { db, unicodeIdx, onPick } = props
  const [pattern, setPattern] = useState('⿰x几')
  const [fontOnly, setFontOnly] = useState(true)
  const [prepared, setPrepared] = useState<PreparedSearchIndex | null>(null)
  const [buildErr, setBuildErr] = useState<string | null>(null)

  // 索引到位即后台预解析（分块调度，不阻塞交互），首次搜索前通常已就绪
  useEffect(() => {
    if (!unicodeIdx) return
    prepareSearchIndex(unicodeIdx)
      .then(setPrepared)
      .catch((e) => setBuildErr(String(e)))
  }, [unicodeIdx])

  const parsed = useMemo(() => parsePattern(pattern), [pattern])
  const hits = useMemo(
    () => (prepared && parsed ? searchByPattern(prepared, parsed, { fontOnly }) : []),
    [prepared, parsed, fontOnly],
  )

  return (
    <section className="panel" style={{ marginTop: 24 }}>
      <h3 style={{ marginTop: 0, fontSize: 15 }}>按部件反查</h3>
      <div className="controls" style={{ marginBottom: 10 }}>
        <input
          type="text"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="如 ⿰x几"
          spellCheck={false}
        />
        <label>
          <input type="checkbox" checked={fontOnly} onChange={(e) => setFontOnly(e.target.checked)} />
          仅字体已收录
        </label>
        <span className="chip-row">
          {SEARCH_CASES.map(([c, note]) => (
            <button
              key={c}
              className={`chip ${pattern === c ? 'active' : ''}`}
              title={note}
              onClick={() => setPattern(c)}
            >
              <IdsText ids={c} db={db} />
            </button>
          ))}
        </span>
      </div>
      <div className="verdict-row" style={{ marginBottom: 10 }}>
        {buildErr ? (
          <span className="badge bad">索引构建失败：{buildErr}</span>
        ) : !unicodeIdx ? (
          <span className="badge bad">Unicode 索引未加载</span>
        ) : !prepared ? (
          <span className="badge source">构建反查索引…（全量 IDS 预解析）</span>
        ) : !parsed ? (
          <span className="badge bad">模式解析失败</span>
        ) : (
          <span className={`badge ${hits.length ? 'ok' : 'bad'}`}>
            命中 {hits.length} 字{fontOnly ? '（字体已收录）' : ''}
          </span>
        )}
        <span className="hint">
          模式 = IDS + 通配符 x / X / *（匹配整个部件子树）；同字多条描述去重，高频字优先、其余按码位升序
        </span>
      </div>
      <div className="results-grid">
        {prepared && parsed &&
          hits.slice(0, MAX_SHOW).map((h) => (
            <button
              key={h.cp}
              className="chip cand"
              title={h.idsAll.join('\n')}
              onClick={() => onPick(h.ids, h.cp)}
            >
              <ZhswChar ch={charOf(h.cp)} size={22} />
              <span className="cp">{cpLabel(h.cp)}</span>
              {!h.inFont && <span className="mini bad">字体✗</span>}
            </button>
          ))}
      </div>
      {hits.length > MAX_SHOW && (
        <p className="hint" style={{ marginBottom: 0 }}>
          共 {hits.length} 字，仅显示前 {MAX_SHOW}（高频字优先，其余码位升序）
        </p>
      )}
    </section>
  )
}

/* ---------------- 输入行 ---------------- */

function Composer(props: { ids: string; setIds: (s: string) => void; db: GlyphDB }) {
  const { ids, setIds } = props
  const [copied, setCopied] = useState(false)
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
    <div className="controls">
      <input
        type="text"
        value={ids}
        onChange={(e) => setIds(e.target.value)}
        placeholder="输入 IDS 序列，如 ⿰𠦝一"
        spellCheck={false}
      />
      <button className="primary" onClick={copy}>
        {copied ? '已复制 ✓' : '复制 IDS'}
      </button>
    </div>
  )
}

/* ---------------- 判定面板 ---------------- */

function VerdictPanel(props: {
  ids: string
  unicodeIdx: Awaited<ReturnType<typeof loadUnicodeIndex>> | null
  selCp: string | null
  setSelCp: (cp: string | null) => void
}) {
  const { ids, unicodeIdx, selCp, setSelCp } = props
  const parsed = useMemo(() => parse(ids), [ids])
  const candidates = useMemo(() => lookupUnicode(unicodeIdx, ids), [unicodeIdx, ids])

  if (!parsed) {
    return (
      <div className="panel verdict">
        <span className="badge bad">IDS 解析失败</span>
        <span className="hint">括号不配对或参数字符数不足</span>
      </div>
    )
  }

  return (
    <div className="panel verdict">
      <div className="verdict-row">
        <span className={`badge ${candidates.length ? 'ok' : 'bad'}`}>
          Unicode {candidates.length ? '已收录' : '未收录'}
        </span>
        {candidates.length === 0 ? (
          <span className="hint">
            CHISE / cjkvi-ids 中无此描述（未命中 ≠ Unicode 绝对未收录）；预览将使用方案 A 合成
          </span>
        ) : (
          <span className="cand-row">
            {candidates.map((c) => (
              <CandidateChip key={c.cp} c={c} active={(selCp ?? candidates[0].cp) === c.cp} onClick={() => setSelCp(c.cp)} />
            ))}
            <span className="hint">{candidates.length > 1 ? '多个候选（同描述异码位），点击切换预览' : ''}</span>
          </span>
        )}
      </div>
      {candidates.length > 0 && (
        <div className="verdict-row">
          <span className={`badge ${fontVerdict(candidates, selCp) ? 'ok' : 'bad'}`}>
            中华书局宋体 {fontVerdict(candidates, selCp) ? '已收录' : '未收录'}
          </span>
          <span className="hint">
            {fontVerdict(candidates, selCp)
              ? '预览并排显示字体真实字形与方案 A 合成，便于对比（字形未提取时按需加载宋体原字体直接渲染）'
              : '三平面 cmap 均无此码位；预览使用方案 A 合成'}
          </span>
        </div>
      )}
    </div>
  )
}

function fontVerdict(candidates: UnicodeCandidate[], selCp: string | null): boolean {
  const target = selCp ? candidates.find((c) => c.cp === selCp) : candidates[0]
  return target?.inFont ?? false
}

function CandidateChip(props: { c: UnicodeCandidate; active: boolean; onClick: () => void }) {
  const { c, active, onClick } = props
  return (
    <button className={`chip cand ${active ? 'active' : ''}`} onClick={onClick}>
      <ZhswChar ch={charOf(c.cp)} size={18} />
      <span className="cp">{cpLabel(c.cp)}</span>
      <span className={`mini ${c.inFont ? 'ok' : 'bad'}`}>{c.inFont ? '字体✓' : '字体✗'}</span>
    </button>
  )
}

/* ---------------- 预览 ---------------- */

function Preview(props: {
  ids: string
  db: GlyphDB
  fallback: FallbackLookup | null
  unicodeIdx: Awaited<ReturnType<typeof loadUnicodeIndex>> | null
  selCp: string | null
  size: number
  setSize: (n: number) => void
}) {
  const { ids, db, fallback, unicodeIdx, selCp, size, setSize } = props
  const [hoverCp, setHoverCp] = useState<string | null>(null)

  const parsed = useMemo(() => parse(ids), [ids])
  const layout = useMemo(
    () => (parsed ? layoutTree(parsed, db, fallback ?? undefined) : null),
    [parsed, db, fallback],
  )
  const candidates = useMemo(() => lookupUnicode(unicodeIdx, ids), [unicodeIdx, ids])
  const previewCand = selCp ? candidates.find((c) => c.cp === selCp) : candidates[0]
  const previewCp = previewCand?.cp ?? null
  // 字体收录即并排对比；真字形数据未提取时 GlyphView 回退系统字体代显（hint 如实标注）
  const fontHit = !!previewCand?.inFont && !!previewCp
  const realGlyph = fontHit ? lookup(db, charOf(previewCp)) : undefined

  return (
    <>
      <div className="controls" style={{ marginBottom: 12 }}>
        <label>
          字号 {size}px
          <input type="range" min={40} max={360} value={size} onChange={(e) => setSize(+e.target.value)} />
        </label>
        <span className="badge source">{fontHit ? '对比模式：字体真实字形 × 方案 A 合成' : '方案 A · SVG 合成'}</span>
      </div>

      <div className="grid-2">
        <div className="render-pair">
          {fontHit && (
            <div className="render-box">
              <span className="badge source">字体真实字形</span>
              <GlyphView cp={previewCp!} db={db} size={size} />
              <span className="hint">
                {realGlyph
                  ? `中华书局宋体原生字形 · ${cpLabel(previewCp!)}`
                  : `字形数据未提取（高频 3000 字之外），按需加载宋体 TTF 由浏览器渲染真字形 · ${cpLabel(previewCp!)}`}
              </span>
            </div>
          )}
          <div className="render-box">
            <span className="badge source">方案 A · SVG 合成</span>
            {layout ? (
              <IDSRenderer
                ids={ids}
                db={db}
                fallback={fallback ?? undefined}
                size={size}
                hoverCp={hoverCp}
                onHover={(cp) => setHoverCp(cp)}
              />
            ) : null}
            <span className="hint">
              {fontHit
                ? `与字体原生字形并排对比 · ${cpLabel(previewCp!)}`
                : previewCand
                  ? `字体未收录 ${cpLabel(previewCp!)}（三平面 cmap 均无），以方案 A 合成显示`
                  : '悬停构件查看码位；虚线框 = 字形库缺字（自动经 CHISE 兜底拆解）'}
            </span>
          </div>
        </div>
        <div className="panel">
          <h3 style={{ marginTop: 0, fontSize: 15 }}>构件树</h3>
          {layout ? (
            <div className="tree">
              <TreeView node={layout} db={db} hoverCp={hoverCp} setHoverCp={setHoverCp} />
            </div>
          ) : (
            <p className="hint">IDS 解析失败。</p>
          )}
        </div>
      </div>
    </>
  )
}

/* ---------------- 构件树 ---------------- */

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
