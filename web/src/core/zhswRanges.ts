/** tools/prepare_web_fonts.py 生成：三平面 TTF 的 unicode-range 描述符 */

export interface ZhswPlane {
  tag: '00' | '02' | '15'
  file: string
  /** @font-face unicode-range，仅 CJK 相关区段（≥ U+2000） */
  ranges: string
}

export const ZHSW_PLANES: ZhswPlane[] = [
  { tag: '00', file: 'zhsw-00.ttf', ranges: "U+200C-2812, U+296D-2B2D, U+2C6D-2D37, U+2E80-9FFC, U+A4D2-A795, U+A9F8-A9F8, U+AB34-AEF4, U+B098-B518, U+B744-BE59, U+BFCC-C2ED, U+C528-C9D3, U+CAED-CAED, U+CC30-D790, U+E76C-E864, U+EA40-EA40, U+F880-FA29, U+FE10-FFED" },  // 17 段
  { tag: '02', file: 'zhsw-02.ttf', ranges: "U+2630-268F, U+4DC0-4DFF, U+10A57-10A57, U+10C00-10C3E, U+11580-115DD, U+1D15E-1D15E, U+1D300-1D356, U+1D703-1D703, U+1F755-1F755, U+20000-2EBE0, U+2F800-2FA1D" },  // 11 段
  { tag: '15', file: 'zhsw-15.ttf', ranges: "U+F0000-F9B1B, U+FC500-FD01D" },  // 2 段
]
