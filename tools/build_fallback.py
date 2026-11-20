#!/usr/bin/env python3
"""从 CHISE / cjkvi-ids 的 IDS 数据库生成缺字兜底映射 chise-fallback.json。

用途：方案 A 渲染时若 glyphs.json 缺某构件（用户输入任意 IDS），
用该字的官方 IDS 描述递归拆解（如 𠦝 → ⿱十早）。

子集策略：全量映射数 MB 过大；取 CHISE 描述中出现频率最高的前 N 个构件字
（多对多时保留全部候选，首个为首选）。

用法: python3 tools/build_fallback.py [N]     # N 默认 3000
输出: web/public/chise-fallback.json  { "<HEX>": ["⿱十早", ...] }
"""
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = [
    ROOT / "references" / "chise-ids",
    ROOT / "references" / "cjkvi-ids",
]
OUT = ROOT / "web" / "public" / "chise-fallback.json"
TOP_N = int(sys.argv[1]) if len(sys.argv) > 1 else 3000

IDS_OPERATORS = set("⿰⿱⿲⿳⿴⿵⿶⿷⿸⿹⿺⿻⿼⿽")


def parse_line(line: str):
    """TSV: U+XXXX\\t字\\tIDS[;IDS...] → (cp_hex, char, [ids...])"""
    parts = line.rstrip("\n").split("\t")
    if len(parts) < 3 or not parts[0].startswith("U+"):
        return None
    cp = parts[0][2:].upper()
    char = parts[1]
    ids_list = [s for s in parts[2].split(";") if s]
    # 过滤含 &#数字; 之外实体的描述（&GT-...; 等 CHISE 私有引用无法渲染）
    ids_list = [
        s for s in ids_list
        if all(c not in IDS_OPERATORS or True for c in s) and "&" not in s and "*" not in s and "?" not in s and "%" not in s
    ]
    if not ids_list:
        return None
    return cp, char, ids_list


def main():
    # 收集：cp → 候选 IDS 列表（保序去重）；同时统计构件字频率
    mapping: dict[str, list[str]] = {}
    freq = Counter()
    src_files = []
    for src in SOURCES:
        if src.is_dir():
            src_files += sorted(p for p in src.glob("*.txt") if "IDS" in p.name or p.name == "ids.txt")

    for path in src_files:
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith(";") or line.startswith("#"):
                continue
            parsed = parse_line(line)
            if not parsed:
                continue
            cp, char, ids_list = parsed
            for ids in ids_list:
                # 单字符描述（字自身）无拆解意义，跳过
                if len([c for c in ids]) < 2:
                    continue
                mapping.setdefault(cp, [])
                if ids not in mapping[cp]:
                    mapping[cp].append(ids)
                for c in ids:
                    if c not in IDS_OPERATORS:
                        freq[c] += 1

    # 取频率前 N 的构件字 + testcases 中的字，只保留这些码位的映射
    keep = {f"{ord(c):X}" for c, _ in freq.most_common(TOP_N)}
    tc = ROOT / "testcases" / "ids.txt"
    for line in tc.read_text(encoding="utf-8").splitlines():
        for c in line.split("#")[0]:
            if not c.isspace() and c not in IDS_OPERATORS:
                keep.add(f"{ord(c):X}")

    subset = {cp: ids for cp, ids in mapping.items() if cp in keep and ids}
    # 排序：候选多的在前无意义；按码位排序即可
    subset = dict(sorted(subset.items()))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(subset, ensure_ascii=False), encoding="utf-8")
    print(f"sources: {len(src_files)} files")
    print(f"total mappings: {len(mapping)}, kept (top {TOP_N} components + testcases): {len(subset)}")
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")
    for probe in ["2099D", "4E00", "65E9"]:
        print(f"  probe U+{probe}: {subset.get(probe, '(not kept)')[:2] if subset.get(probe) else '(none)'}")


if __name__ == "__main__":
    main()
