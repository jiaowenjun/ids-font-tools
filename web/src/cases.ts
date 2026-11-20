/** 用例集（与 testcases/ids.txt 同步维护；独立文件避免 App/视图循环依赖） */
export const CASES = [
  { ids: '⿰𠦝一', note: '目标例：跨 00/02 平面取字' },
  { ids: '⿰日月', note: '基准：应接近真实「明」' },
  { ids: '⿱十早', note: '𠦝 的 CHISE 拆解' },
  { ids: '⿰⿱十早一', note: '嵌套形式，与目标例应一致' },
  { ids: '⿲氵𠦝亍', note: '三元结构（CHISE: 𭱸）' },
  { ids: '⿴囗十', note: '全包围' },
  { ids: '⿺辶⿱十早', note: '半包围（辶）' },
  { ids: '⿳一一大', note: '上下三层（三元）' },
]
