#!/usr/bin/env python3
"""从 CHISE / cjkvi-ids 的 IDS 数据库生成缺字兜底映射 chise-fallback.json。

用途：方案 A 渲染时若 glyphs.json 缺某构件（用户输入任意 IDS），
用该字的官方 IDS 描述递归拆解（如 𠦝 → ⿱十早、𡿸 → ⿳巛一囚）。

子集策略（v2 · 可解析闭包）：v1 只保留「高频构件自身」的映射，导致
罕见构件（如 U+21FF8 𡿸，字体有、字形库无）无兜底可查而显示缺字。
正确口径：保留**每码位一条可解析候选**——候选的全部组件 ∈ 字形库 ∪
可解析映射（记忆化递归 + 环保护），保证任意命中映射都能拆解到底、
无死胡同；库内字不需要兜底，直接排除。

用法: python3 tools/build_fallback.py
输出: web/public/chise-fallback.json  { "<HEX>": "⿱十早" }
"""
import json
import sys
from pathlib import Path

sys.setrecursionlimit(20000)

ROOT = Path(__file__).resolve().parent.parent
SOURCES = [
    ROOT / "references" / "chise-ids",
    ROOT / "references" / "cjkvi-ids",
]
OUT = ROOT / "web" / "public" / "chise-fallback.json"
GLYPHS = ROOT / "web" / "public" / "glyphs.json"

IDS_OPERATORS = set("⿰⿱⿲⿳⿴⿵⿶⿷⿸⿹⿺⿻⿼⿽")


def parse_line(line: str):
    """TSV: U+XXXX\\t字\\tIDS[;IDS...] → (cp_hex, char, [ids...])"""
    parts = line.rstrip("\n").split("\t")
    if len(parts) < 3 or not parts[0].startswith("U+"):
        return None
    cp = parts[0][2:].upper()
    char = parts[1]
    # 过滤含 CHISE 私有实体/通配符的描述（&GT-...; 等无法渲染）
    ids_list = [s for s in parts[2].split(";") if s and "&" not in s and "*" not in s and "?" not in s and "%" not in s]
    return (cp, char, ids_list) if ids_list else None


def collect() -> dict[str, list[str]]:
    mapping: dict[str, list[str]] = {}
    src_files = []
    for src in SOURCES:
        if src.is_dir():
            src_files += sorted(p for p in src.glob("*.txt") if "IDS" in p.name or p.name == "ids.txt")
    for path in src_files:
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith((";", "#")):
                continue
            parsed = parse_line(line)
            if not parsed:
                continue
            cp, _char, ids_list = parsed
            for ids in ids_list:
                if len(ids) < 2:  # 单字符描述无拆解意义
                    continue
                mapping.setdefault(cp, [])
                if ids not in mapping[cp]:
                    mapping[cp].append(ids)
    print(f"sources: {len(src_files)} files, total mappings: {len(mapping):,} 码位")
    return mapping


def main():
    mapping = collect()
    avail = set(json.loads(GLYPHS.read_text(encoding="utf-8"))["glyphs"].keys())
    print(f"字形库可用锚点: {len(avail):,} 字形")

    memo: dict[str, bool] = {}

    def usable(cp: str, seen: tuple[str, ...]) -> bool:
        if cp in avail:
            return True
        if cp in memo:
            return memo[cp]
        if cp in seen:  # 环保护（如 A↔B 互相引用）
            return False
        ok = any(
            all(c in IDS_OPERATORS or usable(f"{ord(c):X}", seen + (cp,)) for c in ids)
            for ids in mapping.get(cp, [])
        )
        memo[cp] = ok
        return ok

    # 每码位保留第一条可解析候选（源文件序即 CHISE 优先序）
    subset: dict[str, str] = {}
    for cp in sorted(mapping):
        if cp in avail:
            continue
        for ids in mapping[cp]:
            if all(c in IDS_OPERATORS or usable(f"{ord(c):X}", (cp,)) for c in ids):
                subset[cp] = ids
                break

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(subset, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {OUT} ({len(subset):,} 码位, {OUT.stat().st_size // 1024} KB)")
    for probe in ["2099D", "21FF8", "313BC"]:
        print(f"  probe U+{probe}: {subset.get(probe, '(不在闭包)')}")


if __name__ == "__main__":
    main()
