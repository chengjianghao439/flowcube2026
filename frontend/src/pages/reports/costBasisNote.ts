import { money } from '@/lib/format'

/**
 * 行内成本来源（2026-09-27 P2）：让用户在**榜单每一行**就能看出这行毛利可不可信。
 * 缺失成本的订单会顶着 100% 毛利排在榜首，只有全局汇总提示定位不到它。
 *
 * 关键分支：**只有明确 `snapshot` 才敢说「出库成本快照」**。前后端滚动更新或 API 缺字段时
 * 拿到的是 `undefined`，若默认成"快照"就等于把"没查到来源"说成"全部可信"，因此退回"待核实"。
 * 导出供单测覆盖该分支（属纯展示逻辑，没有可替代的真实返回路径）。
 */
export function costBasisNote(row: {
  costBasis?: string | null
  estimatedCostAmount?: number
  missingCostLineCount?: number
}): { text: string; warn: boolean } {
  const miss = Number(row.missingCostLineCount || 0)
  const est = Number(row.estimatedCostAmount || 0)
  if (row.costBasis === 'mixed') return { text: `混合：${miss} 行缺失、约 ${money(est)} 按进价估算`, warn: true }
  if (row.costBasis === 'missing') return { text: `成本缺失（${miss} 行按 0 计，毛利偏高）`, warn: true }
  if (row.costBasis === 'estimated') return { text: '按当前进价估算', warn: false }
  if (row.costBasis === 'snapshot') return { text: '出库时记录的成本', warn: false }
  return { text: '成本来源待核实', warn: true }
}
