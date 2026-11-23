#!/usr/bin/env python3
"""把中华书局宋体三平面 TTF 净化重存进 web/public/fonts/ 并生成 unicode-range 区间模块。

目的：字形库 glyphs.json 只含高频 3000 字；收录但未提取的字形（如 U+27BAD 𧮭）
改由浏览器 @font-face 直接渲染原字体（真宋体字形，按需加载对应平面 TTF）。

净化重存：剔除 vhea/vmtx/GSUB 后重算表目录与校验和——00 平面原文件含 vhea/vmtx，
WebKit OT sanitizer 直接拒收（FontFace load 报 "Invalid font data"），重存后可加载。

三字体 cmap 在 BMP 有零星重叠，路由按 extract_glyphs.py 的 00→02→15 优先级：
注册时按 15, 02, 00 顺序 add（同族后注册者优先），浏览器匹配结果与提取管线一致。

用法:
    python3 tools/prepare_web_fonts.py

产物:
    web/public/fonts/zhsw-{00,02,15}.ttf   （版权原因已 gitignore）
    web/src/core/zhswRanges.ts             （unicode-range 描述符）
"""
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
FONT_DIR = ROOT / "assets" / "中华书局宋体"
FONTS = [
    ("00", FONT_DIR / "中华书局宋体00平面_20211201.TTF"),
    ("02", FONT_DIR / "中华书局宋体02平面_20221110.TTF"),
    ("15", FONT_DIR / "中华书局宋体15平面_20230105.TTF"),
]
OUT_DIR = ROOT / "web" / "public" / "fonts"
RANGES_TS = ROOT / "web" / "src" / "core" / "zhswRanges.ts"

# 浏览器单字渲染用不到的表：竖排度量（vhea/vmtx）与连字整形（GSUB）
DROP_TABLES = ("GSUB", "vhea", "vmtx")

# 只登记 CJK 相关区段（≥ U+2000），剔除三字体共有的 ASCII/Latin 噪声（U+20-7E 等）
CP_MIN = 0x2000
GAP = 0x100  # 区间内空洞 ≤ 此值时合并


def plane_ranges(path: Path) -> list[tuple[int, int]]:
    cps = sorted(cp for cp in TTFont(path, lazy=True).getBestCmap() if cp >= CP_MIN)
    runs, s, prev = [], cps[0], cps[0]
    for c in cps[1:]:
        if c - prev > GAP:
            runs.append((s, prev))
            s = c
        prev = c
    runs.append((s, prev))
    return runs


def save_web_font(src: Path, dst: Path) -> None:
    """净化重存，产出 WebKit 可加载的 web 副本（fontTools 重算目录与校验和）。

    00 平面原文件被 WebKit OT sanitizer 拒收（FontFace load 报 "Invalid font data"），
    变体二分实测定位：其 (1,0) format 0 Macintosh cmap 子表畸形（02/15 的同名子表无恙）。
    处方 = 剔除 vhea/vmtx/GSUB + cmap 只保留 platform 3 Unicode 子表（(3,1)/(3,10)，
    CJK 映射完整）；hinting 表保留不影响。
    """
    f = TTFont(src)
    dropped = [t for t in DROP_TABLES if t in f]
    for t in dropped:
        del f[t]
    f["cmap"].tables = [t for t in f["cmap"].tables if t.platformID == 3]
    f.save(dst)
    if dropped:
        print(f"  dropped tables: {dropped}")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    planes = []
    for tag, src in FONTS:
        dst = OUT_DIR / f"zhsw-{tag}.ttf"
        save_web_font(src, dst)
        runs = plane_ranges(src)
        ranges = ", ".join(f"U+{a:X}-{b:X}" for a, b in runs)
        planes.append((tag, dst.name, len(runs), ranges))
        print(f"{tag}: {dst.name} ({dst.stat().st_size // 1024 // 1024} MB), {len(runs)} 段 "
              f"U+{runs[0][0]:X}–U+{runs[-1][1]:X}")

    ts = ["/** tools/prepare_web_fonts.py 生成：三平面 TTF 的 unicode-range 描述符 */", "", "export interface ZhswPlane {", "  tag: '00' | '02' | '15'", "  file: string", "  /** @font-face unicode-range，仅 CJK 相关区段（≥ U+2000） */", "  ranges: string", "}", "", "export const ZHSW_PLANES: ZhswPlane[] = ["]
    for tag, file, n, ranges in planes:
        ts.append(f"  {{ tag: '{tag}', file: '{file}', ranges: {repr(ranges).replace(chr(39), chr(34))} }},  // {n} 段")
    ts += ["]", ""]
    RANGES_TS.write_text("\n".join(ts), encoding="utf-8")
    print(f"wrote {RANGES_TS}")


if __name__ == "__main__":
    main()
