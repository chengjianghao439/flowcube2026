import { qty as formatQty } from '@/lib/format'
import { Fragment } from 'react'
import type { ProcurementSupply } from '@/api/procurement-supply'

// 数量统一走 lib/format 的 qty（整数不补零、小数保留有效位），这里只负责拼单位
const qty = (value: number | undefined | null, unit = '') => {
  const text = formatQty(value)
  return unit && text !== '—' ? `${text} ${unit}` : text
}
type Props = { supply: ProcurementSupply; snapshot?: ProcurementSupply | null; mode?: 'plan' | 'replenishment' }

/** 只展示后端已判定的日期条件，不从总量覆盖推导按期到货。 */
export function ProcurementArrivalStatus({ supply: r }: Pick<Props, 'supply'>) {
  const unknown = r.inTransit > 0 && (r.arrivalUnconfirmedQty == null || r.lateSupplyQty == null)
  const late = (r.lateSupplyQty ?? 0) > 0
  const unconfirmed = (r.arrivalUnconfirmedQty ?? 0) > 0
  return <div className="space-y-1 text-xs leading-5">
    <p>{r.earliestDemandDate ? `最早销售交期：${r.earliestDemandDate}` : r.confirmedDemand > 0 ? '销售交期待确认' : '暂无销售交期'}</p>
    {late && <p className="font-medium text-foreground">晚于需求 {qty(r.lateSupplyQty, r.unit)}</p>}
    {unconfirmed && <p className="font-medium text-foreground">到货日待确认 {qty(r.arrivalUnconfirmedQty, r.unit)}</p>}
    {unknown && <p className="font-medium text-foreground">到货信息待核对</p>}
    {!unknown && !late && !unconfirmed && <p className="text-muted-foreground">{r.inTransit > 0 ? '仍需核对实际到货' : '暂无在途采购'}</p>}
  </div>
}

function Values({ rows, unit }: { rows: [string, number | undefined][]; unit: string }) {
  return <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2">
    {rows.map(([label, value]) => <Fragment key={label}><dt className="leading-5">{label}</dt><dd className="text-right tabular-nums">{qty(value, unit)}</dd></Fragment>)}
  </dl>
}

export function ProcurementSupplyExplanation({ supply: r, snapshot, mode = 'plan' }: Props) {
  const bufferLabel = mode === 'replenishment' ? '目标库存（已含安全库存）' : '安全库存'
  const comparison: [string, keyof ProcurementSupply][] = [
    ['未发销售', 'confirmedDemand'], ['预测需求', 'forecastDemand'], ['实物库存', 'onHand'], ['在途采购', 'inTransit'],
    ['其他采购计划', 'planCoverage'], ['未转采购的申请', 'requisitionCoverage'], ['采购单草稿', 'draftCoverage'],
    [bufferLabel, mode === 'replenishment' ? 'targetStock' : 'safetyStock'],
    ['包装倍数', 'packMultiple'], ['最低起订', 'minimumOrderQty'], ['净需求', 'netRequirement'], ['建议采购', 'suggestedQty'],
  ]
  return <div className="space-y-4 text-sm">
    <div className="rounded-md bg-muted px-4 py-3">
      <p className="flex flex-wrap gap-x-6 gap-y-1 font-medium"><span>净需求 {qty(r.netRequirement, r.unit)}</span><span>建议采购 {qty(r.suggestedQty, r.unit)}</span></p>
      <p className="mt-2 text-xs leading-5">{r.packMultiple === 0 ? '包装倍数不限' : `包装倍数 ${qty(r.packMultiple, r.unit)}`} · {r.minimumOrderQty === 0 ? '最低起订不限' : `最低起订 ${qty(r.minimumOrderQty, r.unit)}`} · 多购 {qty(r.excessQty, r.unit)}</p>
      {r.entryUnit && r.entryUnit !== r.unit && <p className="mt-1 text-xs text-muted-foreground">1 {r.entryUnit} = {qty(r.conversionRate, r.unit)}；上方数量均按{r.unit}展示。</p>}
    </div>
    <section aria-label="到货条件" className="space-y-2">
      <h3 className="font-medium">到货条件</h3>
      <ProcurementArrivalStatus supply={r} />
      <p className="text-xs leading-5 text-muted-foreground">总量覆盖不代表按期到货。先核对销售交期、催货或调拨；计划和申请尚未成为供应商承诺。</p>
      {!!r.expectedArrivals?.length && <details className="text-xs"><summary className="cursor-pointer py-1 font-medium">查看预计到货批次（{r.expectedArrivals.length}）</summary><ul className="mt-2 space-y-1">{r.expectedArrivals.map((arrival, index) => <li key={index}>{arrival.expectedDate || '日期待确认'}：{qty(arrival.quantity, r.unit)}</li>)}</ul></details>}
    </section>
    {snapshot === null && <p className="text-xs text-muted-foreground">该计划没有保存生成时的需求数据，无法对照历史覆盖情况。</p>}
    {snapshot && <details className="border-t pt-3"><summary className="cursor-pointer font-medium">对照生成时与当前数据</summary><div className="mt-3 overflow-x-auto"><table className="w-full text-xs"><caption className="pb-2 text-left text-muted-foreground">“—”表示原记录未提供，不按零处理；差异仅供核对，不自动调整采购量。</caption><thead><tr className="border-b"><th className="py-2 text-left">项目</th><th className="py-2 text-right">生成时</th><th className="py-2 text-right">当前</th></tr></thead><tbody>{comparison.map(([label, key]) => <tr key={key} className="border-b border-border/50"><th className="py-2 text-left font-normal">{label}</th><td className="py-2 text-right tabular-nums">{qty(snapshot[key] as number | undefined, snapshot.unit)}</td><td className="py-2 text-right tabular-nums">{qty(r[key] as number | undefined, r.unit)}</td></tr>)}</tbody></table></div></details>}
    <details className="border-t pt-3"><summary className="cursor-pointer font-medium">查看需求与覆盖明细</summary><div className="mt-4 space-y-5"><p className="text-xs text-muted-foreground">“—”表示本次数据未提供该项明细，不按零处理。</p>
      <section className="space-y-3"><h3 className="font-medium">需求与库存缓冲</h3><Values unit={r.unit} rows={[
        ['未发销售（含未占库订单）',r.confirmedDemand],['其中销售草稿',r.draftSalesDemand],['预测需求',r.forecastDemand],['消耗销售后的剩余预测',r.residualForecast],['有效预占',r.reserved],['需求基数（销售、预测、预占取最大）',r.grossDemand],[bufferLabel,mode === 'replenishment' ? r.targetStock : r.safetyStock],
      ]} /></section>
      <section className="space-y-3"><h3 className="font-medium">已有实物与采购</h3><Values unit={r.unit} rows={[
        ['实物库存（含已预占）',r.onHand],['在途采购（已提交 / 待审批，未上架）',r.inTransit],['其中销售预计绑定（不重复扣除）',r.expectedBound],
      ]} /></section>
      <section className="space-y-3"><h3 className="font-medium">尚未转为正式采购的覆盖</h3><Values unit={r.unit} rows={[
        ['其他待处理采购计划',r.planCoverage],['未转采购的申请（草稿 / 审批中 / 已批准）',r.requisitionCoverage],['采购单草稿',r.draftCoverage],['待处理覆盖合计',r.provisionalCoverage],
      ]} /></section>
      <p className="text-xs leading-5 text-muted-foreground">净需求 = max（0，需求基数 + {mode === 'replenishment' ? '目标库存' : '安全库存'} − 实物 − 在途采购 − 待处理覆盖）。计划、申请只计未转换部分；取消或减量后释放覆盖。{mode === 'plan' ? '当前计划待处理行不计入其他计划。' : ''}生成和转换时由后端重新核对。</p>
    </div></details>
  </div>
}
