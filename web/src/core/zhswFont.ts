/**
 * 中华书局宋体三平面 TTF 的 @font-face 惰性加载。
 *
 * 字形库 glyphs.json 只含高频 3000 字；收录但未提取的字形（如 U+27BAD 𧮭）
 * 由浏览器直接渲染原字体——unicode-range 命中才下载对应平面 TTF（本地
 * 17–40 MB，一次后由浏览器缓存），真宋体字形、零提取。
 *
 * 三平面 cmap 在 BMP 有零星重叠（见 zhswRanges）：按 15 → 02 → 00 顺序注册
 * （同族后注册者优先），使重叠区段由 00 平面胜出，与 tools/extract_glyphs.py
 * 的 00→02→15 提取路由一致。
 */
import { ZHSW_PLANES } from './zhswRanges'

export const ZHSW_FAMILY = 'ZHSW-Web'
/** 渲染 spans 的 font-family 栈：宋体三平面优先，系统字体兜底 */
export const ZHSW_STACK =
  `'${ZHSW_FAMILY}', '中华书局宋体', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif`

let registered = false

/** 注册三平面 FontFace（幂等；不主动 load，靠 unicode-range 按需触发下载） */
export function registerZhswFonts(): void {
  if (registered || typeof document === 'undefined') return
  registered = true
  for (const p of [...ZHSW_PLANES].reverse()) {
    document.fonts.add(
      new FontFace(ZHSW_FAMILY, `url(${import.meta.env.BASE_URL}fonts/${p.file})`, {
        unicodeRange: p.ranges,
        display: 'swap',
      }),
    )
  }
}

/** 触发覆盖 ch 的平面加载（就绪后文本自动换用真字形；失败静默保持系统兜底） */
export function preloadZhsw(ch: string): void {
  registerZhswFonts()
  document.fonts.load(`1em ${ZHSW_FAMILY}`, ch).catch(() => undefined)
}
