/** 字形库：码位 → 字形轮廓（来自 tools/extract_glyphs.py 的产物 glyphs.json） */

export interface GlyphData {
  /** SVG path 命令（字体原始坐标，y 轴向上） */
  path: string
  advance: number
  /** ink bounds [x0, y0, x1, y1]，字体坐标 */
  bounds: [number, number, number, number] | null
  plane: string
}

export interface GlyphDB {
  upem: number
  /** 标准字面框 [x0,y0,x1,y1]（常用字 ink 包络，字体坐标 y-up），无则回退全 em */
  faceBox?: [number, number, number, number]
  hhea?: { ascent: number; descent: number }
  glyphs: Record<string, GlyphData>
}

/** 视口宽度（固定 1000 单位，对应字体 x ∈ [0, upem]） */
export const VIEW_W = 1000

/**
 * 视口高度：对应字体 y ∈ [upem（em 顶）, hhea.descent（行框底）]。
 * 合成字的 ink 因此与真实字体字的基线/位置一致（含 descender）。
 */
export function viewportH(db: GlyphDB): number {
  const descent = db.hhea?.descent ?? -Math.round(db.upem * 0.24)
  return ((db.upem - descent) * VIEW_W) / db.upem
}

export const cpKey = (char: string): string => char.codePointAt(0)!.toString(16).toUpperCase()

export function lookup(db: GlyphDB, char: string): GlyphData | undefined {
  return db.glyphs[cpKey(char)]
}

let cache: Promise<GlyphDB> | null = null

/** 浏览器端：fetch 加载 glyphs.json（单例缓存） */
export function loadGlyphDB(): Promise<GlyphDB> {
  cache ??= fetch(import.meta.env.BASE_URL + 'glyphs.json').then((r) => {
    if (!r.ok) throw new Error(`glyphs.json 加载失败: ${r.status}`)
    return r.json() as Promise<GlyphDB>
  })
  return cache
}
