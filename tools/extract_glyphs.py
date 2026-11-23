#!/usr/bin/env python3
"""从中华书局宋体三份平面字体中提取指定码位的字形轮廓，输出 glyphs.json。

三份字体按 Unicode 平面分工、覆盖互斥，本脚本即"跨字体 cmap 合并路由层"：
按 00→02→15 顺序查找，首个命中者即为该码位的字形来源。

用法:
    python3 tools/extract_glyphs.py                    # 解析 testcases/ids.txt
    python3 tools/extract_glyphs.py 一 𠦝 U+4E00       # 追加码位/字符

输出: web/public/glyphs.json
  { "upem": 1024,
    "faceBox": [x0, y0, x1, y1],          # 标准字面框（常用字 ink 包络，字体坐标 y-up）
    "hhea": { "ascent": int, "descent": int },
    "glyphs": { "<大写hex>": {"path": str, "advance": int, "bounds": [x0,y0,x1,y1], "plane": "00|02|15"} } }

坐标保留字体原始坐标系（y 轴向上、单位 upem），由渲染端统一处理翻转。
"""
import json
import sys
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen

ROOT = Path(__file__).resolve().parent.parent
FONT_DIR = ROOT / "assets" / "中华书局宋体"
FONTS = [
    ("00", FONT_DIR / "中华书局宋体00平面_20211201.TTF"),
    ("02", FONT_DIR / "中华书局宋体02平面_20221110.TTF"),
    ("15", FONT_DIR / "中华书局宋体15平面_20230105.TTF"),
]
OUT = ROOT / "web" / "public" / "glyphs.json"

IDS_OPERATORS = "⿰⿱⿲⿳⿴⿵⿶⿷⿸⿹⿺⿻⿼⿽"

# 常用全尺寸汉字采样（估计该字体的标准字面框 faceBox）
FACE_SAMPLE = "一大天国立中人口日月十早明水火土木金心手足言車馬魚鳥白黑的目玉王石田力女子公司学校城市東南北西春秋冬時地方上下左右中外前後高低長短大小多少"
# 对照字：与合成目标同族的真实字（⿰𠦝月=朝、⿰日月=明）及
# Ext-H 验证用例（⿰亻革=𱎼 U+313BC，Unicode 15.0，用于数据源时效性回归）
PROBE_CHARS = "朝明𱎼"


def collect_codepoints():
    cps = {ord(ch) for ch in IDS_OPERATORS}  # 运算符也提取，供 UI 内联渲染
    cps |= {ord(ch) for ch in PROBE_CHARS}
    tc = ROOT / "testcases" / "ids.txt"
    for line in tc.read_text(encoding="utf-8").splitlines():
        line = line.split("#")[0].strip()
        for ch in line:
            if ch in IDS_OPERATORS or ch.isspace():
                continue
            cps.add(ord(ch))
    # 高频构件清单（build_unicode_index.py 产物）：真字形预览的主要数据来源
    freq_file = ROOT / "web" / "public" / "glyphs-frequent.txt"
    if freq_file.exists():
        for line in freq_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                cps.add(int(line, 16))
    for arg in sys.argv[1:]:
        arg = arg.strip()
        if arg.startswith(("U+", "u+")):
            cps.add(int(arg[2:], 16))
        else:
            for ch in arg:
                cps.add(ord(ch))
    return sorted(cps)


def measure_face_box(font00):
    """标准字面框 = 常用全尺寸汉字 ink 的包络（字体坐标 y-up）"""
    cmap = font00.getBestCmap() or {}
    gs = font00.getGlyphSet()
    boxes = []
    for ch in FACE_SAMPLE:
        gname = cmap.get(ord(ch))
        if not gname:
            continue
        bp = BoundsPen(gs)
        gs[gname].draw(bp)
        if bp.bounds:
            boxes.append(bp.bounds)
    if not boxes:
        return None
    face = [min(b[0] for b in boxes), min(b[1] for b in boxes),
            max(b[2] for b in boxes), max(b[3] for b in boxes)]
    return [round(v, 2) for v in face]


def main():
    cps = collect_codepoints()
    print(f"collecting {len(cps)} codepoints from testcases + args")

    fonts = []
    for plane, path in FONTS:
        f = TTFont(path)
        fonts.append((plane, f, f.getBestCmap() or {}, f.getGlyphSet()))

    face_box = measure_face_box(fonts[0][1])
    hhea = fonts[0][1]["hhea"]
    print(f"faceBox (envelope of {len(FACE_SAMPLE)} common glyphs): {face_box}")
    print(f"hhea ascent/descent: {hhea.ascent}/{hhea.descent}")

    glyphs, missing = {}, []
    for cp in cps:
        for plane, f, cmap, gs in fonts:
            gname = cmap.get(cp)
            if not gname:
                continue
            spen = SVGPathPen(gs)
            bpen = BoundsPen(gs)
            gs[gname].draw(spen)
            gs[gname].draw(bpen)
            advance = f["hmtx"][gname][0]
            glyphs[f"{cp:X}"] = {
                "path": spen.getCommands(),
                "advance": advance,
                "bounds": list(bpen.bounds) if bpen.bounds else None,
                "plane": plane,
            }
            break
        else:
            missing.append(cp)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({
            "upem": fonts[0][1]["head"].unitsPerEm,
            "faceBox": face_box,
            "hhea": {"ascent": hhea.ascent, "descent": hhea.descent},
            "glyphs": glyphs,
        }, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"wrote {OUT} ({len(glyphs)} glyphs, {OUT.stat().st_size // 1024} KB)")
    if missing:
        print("MISSING (no cmap in any plane font):")
        for cp in missing:
            print(f"  U+{cp:X} {chr(cp)}")


if __name__ == "__main__":
    main()
