#!/usr/bin/env python3
"""IDS → Unicode 收录反查索引。

数据层三件套（供前端合字判定链：IDS → Unicode 码位 → 字体收录 → 真字形/合成）：

  web/public/ids-unicode-index.json
    { "index": { "<ids 串>": [["<HEX>", fontFlag], ...] },   # 多对多，全候选
      "font": [["<HEX>", "<HEX>"], ...],                     # 三平面 cmap 并集的闭区间
      "unihan": { "version": "18.0.0", "ranges": [...] },    # Unihan 已分配汉字的闭区间
      "note": "口径：CHISE-IDS + cjkvi-ids 反查；未命中≠Unicode 绝对未收录" }

  web/public/glyphs-frequent.txt    # 高频构件码位清单（扩字形提取用）

fontFlag = 1 表示该码位在中华书局宋体三平面任一 cmap 中（"字体已收录"判定口径）。
高频清单 = 码位作为构件在全部描述中出现的频率前 N（既是常用整字也是常用构件）。

index 的键全是长度 ≥ 2 的描述串（CHISE 的单字描述如「口 → 口」被丢弃），因此**单字输入
无法经 index 反查**——前端对单字走「单字直查」：候选即该字码位，Unicode 收录查 unihan
区间、字体收录查 font 区间，均不依赖该字有无 IDS 描述。font 区间是 cmap 的完整导出
（134k 码位压成 ~900 段）：字体有字形但无任何描述的码位（私用区 4.2 万、无描述汉字等）
只能经它判定，不能从 fontFlag 反推。

用法: python3 tools/build_unicode_index.py [N]     # N 默认 3000
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
SOURCES = [
    ROOT / "references" / "chise-ids",
    ROOT / "references" / "cjkvi-ids",
]
# 列出全部已分配汉字（统一表意文字 + 兼容表意文字）的 Unihan 文件；版本号取自文件头
UNIHAN_IRG = ROOT / "references" / "unihan" / "Unihan_IRGSources.txt"
FONTS = [
    ROOT / "assets" / "中华书局宋体" / "中华书局宋体00平面_20211201.TTF",
    ROOT / "assets" / "中华书局宋体" / "中华书局宋体02平面_20221110.TTF",
    ROOT / "assets" / "中华书局宋体" / "中华书局宋体15平面_20230105.TTF",
]
OUT_INDEX = ROOT / "web" / "public" / "ids-unicode-index.json"
OUT_FREQ = ROOT / "web" / "public" / "glyphs-frequent.txt"
TOP_N = int(sys.argv[1]) if len(sys.argv) > 1 else 3000

IDS_OPERATORS = set("⿰⿱⿲⿳⿴⿵⿶⿷⿸⿹⿺⿻⿼⿽")


def clean_ids(s: str):
    """过滤无法渲染/非标准的描述（含私有实体、通配符）；返回规范化串或 None"""
    if any(c in s for c in "&?*%"):
        return None
    s = s.strip()
    return s if len(s) >= 2 else None


def to_runs(cps: set) -> list:
    """码位集合 → 升序闭区间 [["<HEX lo>", "<HEX hi>"], ...]（相邻码位合并）"""
    runs, s, prev = [], None, None
    for c in sorted(cps):
        if prev is None or c != prev + 1:
            if s is not None:
                runs.append([s, prev])
            s = c
        prev = c
    if s is not None:
        runs.append([s, prev])
    return [[f"{a:X}", f"{b:X}"] for a, b in runs]


def unihan_cjk() -> tuple:
    """Unihan 已分配汉字码位全集 + 版本号；文件缺失返回 (None, 空集)，前端退化为码位认定"""
    if not UNIHAN_IRG.exists():
        return None, set()
    version, cps = None, set()
    with UNIHAN_IRG.open(encoding="utf-8") as f:
        for line in f:
            if version is None and line.startswith("# Unicode Version"):
                version = line.split("Version", 1)[1].strip()
            m = re.match(r"U\+([0-9A-Fa-f]+)", line)
            if m:
                cps.add(int(m.group(1), 16))
    return version, cps


def main():
    # 字体覆盖全集
    font_cps: set[int] = set()
    for p in FONTS:
        f = TTFont(p, lazy=True)
        font_cps |= set((f.getBestCmap() or {}).keys())
        f.close()
    print(f"font coverage: {len(font_cps)} codepoints")

    version, unihan_cps = unihan_cjk()
    if version is None:
        print("WARNING: references/unihan/Unihan_IRGSources.txt 缺失——unihan 区间为空，"
              "前端单字直查的汉字收录判定退化为码位认定")
    else:
        print(f"unihan {version}: {len(unihan_cps):,} 已分配汉字")

    # 反索引 + 构件频率
    index: dict[str, list] = {}
    freq = Counter()
    files = []
    for src in SOURCES:
        if src.is_dir():
            files += sorted(p for p in src.glob("*.txt") if "IDS" in p.name or p.name == "ids.txt")

    n_lines = 0
    for path in files:
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith(";") or line.startswith("#"):
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3 or not parts[0].startswith("U+"):
                continue
            cp = int(parts[0][2:], 16)
            for raw in parts[2].split(";"):
                ids = clean_ids(raw)
                if not ids:
                    continue
                n_lines += 1
                entry = index.setdefault(ids, [])
                pair = [f"{cp:X}", 1 if cp in font_cps else 0]
                if pair not in entry:
                    entry.append(pair)
                for ch in ids:
                    if ch not in IDS_OPERATORS:
                        freq[ord(ch)] += 1  # 构件码位频率

    print(f"sources: {len(files)} files, usable descriptions: {n_lines}, unique ids keys: {len(index)}")

    OUT_INDEX.parent.mkdir(parents=True, exist_ok=True)
    OUT_INDEX.write_text(
        json.dumps({
            "index": index,
            "font": to_runs(font_cps),
            "unihan": {"version": version, "ranges": to_runs(unihan_cps)},
            "note": "Unicode 收录判定口径：CHISE-IDS + cjkvi-ids 反查（Unihan 无 IDS 字段）；"
                    "未命中不等于 Unicode 绝对未收录。fontFlag=1 表示码位在中华书局宋体三平面 cmap 中。"
                    "font = 三平面 cmap 并集闭区间；unihan = Unihan 已分配汉字闭区间（单字直查用）。",
        }, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"wrote {OUT_INDEX} ({OUT_INDEX.stat().st_size // 1024} KB)")

    frequent = [f"{cp:X}" for cp, _ in freq.most_common(TOP_N)]
    OUT_FREQ.write_text("\n".join(frequent), encoding="utf-8")
    print(f"wrote {OUT_FREQ} (top {len(frequent)} component codepoints)")

    for probe_ids, probe_cp in [("⿰日月", "660E"), ("⿱十早", "2099D"), ("⿰𠦝一", None)]:
        got = index.get(probe_ids)
        print(f"  probe {probe_ids!r}: {got if got else '(not in index)'}")
    # 单字直查：码位本身在三平面 cmap / Unihan 的状态（与有无 IDS 描述无关）
    for ch in "袤口明":
        cp = ord(ch)
        print(f"  identity probe {ch} U+{cp:X}: font={cp in font_cps} unihan={cp in unihan_cps}")


if __name__ == "__main__":
    main()
