import { useEffect, useMemo, useState } from 'react'
import { parse } from './core/parse'
import { layoutTree, type LayoutNode, type FallbackLookup } from './core/layout'
import { loadGlyphDB, lookup, type GlyphDB } from './core/glyphStore'
import { loadUnicodeIndex, lookupUnicode, charOf, cpLabel, type UnicodeCandidate } from './core/unicodeIndex'
import { IDSRenderer } from './components/IDSRenderer'
import { GlyphView, ZhswChar } from './components/GlyphView'
import { registerZhswFonts, preloadZhsw, ZHSW_STACK } from './core/zhswFont'
import { IdsText, InlineGlyph } from './components/IdsText'
import {
  parsePattern,
  prepareSearchIndex,
  searchByPattern,
  containsWildcard,
  type PreparedSearchIndex,
} from './core/patternSearch'
import { searchSimilar, suggestPatterns } from './core/similarSearch'
import { CASES } from './cases'

export default function App() {
  const [ids, setIds] = useState('⿰𠦝一')
  const [size, setSize] = useState(200)
  const [db, setDb] = useState<GlyphDB | null>(null)
  const [fallback, setFallback] = useState<FallbackLookup | null>(null)
  const [fallbackMap, setFallbackMap] = useState<Record<string, string> | null>(null) // 原始映射（近似搜索的叶展开用）
  const [unicodeIdx, setUnicodeIdx] = useState<Awaited<ReturnType<typeof loadUnicodeIndex>> | null>(null)
  const [prepared, setPrepared] = useState<PreparedSearchIndex | null>(null)
  const [prepErr, setPrepErr] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [selCp, setSelCp] = useState<string | null>(null) // 多候选时的预览对象
  const [pattern, setPattern] = useState('⿰x几') // 按部件反查模式（判定面板可一键跳入）

  useEffect(() => {
    loadGlyphDB().then(setDb).catch((e) => setErr(String(e)))
    registerZhswFonts() // 三平面 TTF @font-face（unicode-range 按需下载）
    loadUnicodeIndex().then(setUnicodeIdx).catch(() => setUnicodeIdx(null))
    // 加载 CHISE 兜底映射（缺字时递归拆解；v2 可解析闭包，99k 码位）
    fetch('chise-fallback.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Record<string, string> | null) => {
        if (j) {
          setFallbackMap(j)
          setFallback(
            () => (ch: string) => j[ch.codePointAt(0)!.toString(16).toUpperCase()] ?? null,
          )
        }
      })
      .catch(() => undefined)
  }, [])

  // 反查索引预解析提升到 App 级：判定面板（近似描述）与按部件反查共用
  useEffect(() => {
    if (!unicodeIdx) return
    prepareSearchIndex(unicodeIdx).then(setPrepared).catch((e) => setPrepErr(String(e)))
  }, [unicodeIdx])

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

      <VerdictPanel
        ids={ids}
        db={db}
        unicodeIdx={unicodeIdx}
        prepared={prepared}
        fallbackMap={fallbackMap}
        selCp={selCp}
        setSelCp={setSelCp}
        setIds={(s) => {
          setIds(s)
          setSelCp(null)
        }}
        onPattern={(p) => {
          setPattern(p)
          document.getElementById('pattern-search')?.scrollIntoView({ behavior: 'smooth' })
        }}
      />

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
        prepared={prepared}
        buildErr={prepErr}
        pattern={pattern}
        setPattern={setPattern}
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
  ['⿴囗x', '全包围 · 内为单部件'],
  ['⿰亻⿱x山', '嵌套：左右 + 右为上下组合（下为山）'],
  ['⿴囗⿰xx', '嵌套：全包围 + 内为左右组合'],
]

const MAX_SHOW = 300

function PatternSearch(props: {
  db: GlyphDB
  unicodeIdx: Awaited<ReturnType<typeof loadUnicodeIndex>> | null
  prepared: PreparedSearchIndex | null
  buildErr: string | null
  pattern: string
  setPattern: (p: string) => void
  onPick: (ids: string, cp: string) => void
}) {
  const { db, unicodeIdx, prepared, buildErr, pattern, setPattern, onPick } = props
  const [fontOnly, setFontOnly] = useState(true)
  // Safari/系统字体对 IDS 运算符与生僻部件无覆盖：反查输入框同样用宋体栈
  useEffect(() => {
    ;[...pattern].forEach(preloadZhsw)
  }, [pattern])

  const parsed = useMemo(() => parsePattern(pattern), [pattern])
  const hits = useMemo(
    () => (prepared && parsed ? searchByPattern(prepared, parsed, { fontOnly }) : []),
    [prepared, parsed, fontOnly],
  )
  // 解析失败 / 全具体无命中（引导换通配符）/ 常规语法说明，三种口径如实区分
  const hint = !parsed
    ? '括号不配对、参数字符数不足，或含 ⿼⿽ 等暂不支持的运算符'
    : prepared && hits.length === 0 && !containsWildcard(parsed)
      ? '无通配符 = 精确结构匹配，索引中无此描述；可将任意部件换成 x 放宽（如 ⿰亻⿱巛山 → ⿰亻⿱x山）'
      : '模式 = IDS + 通配符 x / X / *（匹配整个部件子树，支持任意嵌套构型）；同字多条描述去重，高频字优先、其余按码位升序'

  return (
    <section className="panel" id="pattern-search" style={{ marginTop: 24 }}>
      <h3 style={{ marginTop: 0, fontSize: 15 }}>按部件反查</h3>
      <div className="controls" style={{ marginBottom: 10 }}>
        <input
          type="text"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="如 ⿰x几"
          spellCheck={false}
          style={{ fontFamily: ZHSW_STACK }}
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
        <span className="hint">{hint}</span>
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
  // Safari/系统字体对 IDS 运算符与生僻部件无覆盖（方框/横条）：输入框用宋体栈
  useEffect(() => {
    ;[...ids].forEach(preloadZhsw)
  }, [ids])
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
        style={{ fontFamily: ZHSW_STACK }}
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
  db: GlyphDB
  unicodeIdx: Awaited<ReturnType<typeof loadUnicodeIndex>> | null
  prepared: PreparedSearchIndex | null
  fallbackMap: Record<string, string> | null
  selCp: string | null
  setSelCp: (cp: string | null) => void
  setIds: (s: string) => void
  onPattern: (p: string) => void
}) {
  const { ids, db, unicodeIdx, prepared, fallbackMap, selCp, setSelCp, setIds, onPattern } = props
  const parsed = useMemo(() => parse(ids), [ids])
  const candidates = useMemo(() => lookupUnicode(unicodeIdx, ids), [unicodeIdx, ids])
  // 未命中时找「部件大部分一致」的已收录字（叶集 Jaccard，兜底映射递归展开）
  const similar = useMemo(
    () =>
      candidates.length === 0 && prepared && fallbackMap
        ? searchSimilar(prepared, ids, fallbackMap)
        : [],
    [candidates.length, prepared, fallbackMap, ids],
  )
  // 未命中时派生反查模式（顶层叶槽位换通配符），完备浏览该结构族
  const patterns = useMemo(
    () => (candidates.length === 0 ? suggestPatterns(ids) : []),
    [candidates.length, ids],
  )

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
      {candidates.length === 0 && similar.length > 0 && (
        <div className="verdict-row">
          <span className="badge source">近似描述</span>
          <span className="cand-row">
            {similar.map((h) => (
              <button
                key={h.cp}
                className="chip cand"
                title={h.ids}
                onClick={() => setIds(h.ids)}
              >
                <ZhswChar ch={charOf(h.cp)} size={18} />
                <span className="cp">{cpLabel(h.cp)}</span>
                <span className="cp">{Math.round(h.score * 100)}%</span>
                <span className={`mini ${h.inFont ? 'ok' : 'bad'}`}>{h.inFont ? '字体✓' : '字体✗'}</span>
              </button>
            ))}
          </span>
          <span className="hint">部件大部分一致但非精确匹配（同形异码部件最常见），点击载入该字描述</span>
        </div>
      )}
      {candidates.length === 0 && patterns.length > 0 && (
        <div className="verdict-row">
          <span className="badge source">浏览结构族</span>
          <span className="cand-row">
            {patterns.map((p) => (
              <button key={p} className="chip" onClick={() => onPattern(p)} title="跳转按部件反查">
                <IdsText ids={p} db={db} />
              </button>
            ))}
          </span>
          <span className="hint">反查该结构的全部已描述字（通配符 x），如 ⿰亻𡿸 的意向字必在 ⿰亻x 结果中</span>
        </div>
      )}
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
        {/* Safari/系统字体对生僻部件无覆盖：库内字用内联 SVG，库外回退宋体栈 */}
        <InlineGlyph char={n.char} db={db} size={15} />
        <span className="cp">U+{n.cp}</span>
        {n.missing && (
          <span className="cp">字形库缺字{n.inferred ? '·兜底失败' : '·宋体直渲染'}</span>
        )}
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
