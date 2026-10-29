import { ProductIdentitySummary } from '@/components/shared/ProductIdentitySummary'
import { ReportTable } from '@/components/shared/ReportTable'
type Line = {
  kind: string; productCode: string | null; productName: string | null; quantity: string | null; unitPrice: string | null; amount: string | null; unit: string | null
  baseUnitPriceExact: string | null; entryUnitPrice: string | null; entryQty: string | null; entryQtyBasis: string | null; originalEntryQty: string | null; entryUnit: string | null; conversionRate: number | null; kitVersionId: number | null; snapshotRevision: number | null; priceType: string | null
  components: { productCode: string | null; productName: string | null; requiredQty: string | null; referencePrice: string | null; saleItemId: number | null }[]
}
type Change = { key: string; action: 'added' | 'removed' | 'changed'; before: Line | null; after: Line | null }
type Payload = { reason: string | null; rows: Change[]; applicant: string | null; approver: string | null; hiddenRowCount: number }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown) => typeof value === 'string' ? value : null
const numericId = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null
const decimal = (value: unknown, scale: number) => typeof value === 'string' && new RegExp(`^-?\\d+\\.\\d{${scale}}$`).test(value) ? value : null
function line(value: unknown): Line | null {
  if (!object(value) || typeof value.kind !== 'string' || !['physical','ordinary','kit','price'].includes(value.kind)) return null
  if (!Array.isArray(value.components) || value.components.length > 200) return null
  return { kind:value.kind,baseUnitPriceExact:text(value.baseUnitPriceExact),entryUnitPrice:decimal(value.entryUnitPrice,4),productCode:text(value.productCode),productName:text(value.productName),quantity:decimal(value.quantity,2),unitPrice:decimal(value.unitPrice,4),amount:decimal(value.amount,4),unit:text(value.unit),entryQty:decimal(value.entryQty,2),entryQtyBasis:text(value.entryQtyBasis),originalEntryQty:decimal(value.originalEntryQty,2),entryUnit:text(value.entryUnit),conversionRate:typeof value.conversionRate === 'number' && Number.isFinite(value.conversionRate) ? value.conversionRate : null,kitVersionId:numericId(value.kitVersionId),snapshotRevision:numericId(value.snapshotRevision),priceType:text(value.priceType),components:value.components.flatMap(c => object(c) ? [{productCode:text(c.productCode),productName:text(c.productName),requiredQty:decimal(c.requiredQty,2),referencePrice:decimal(c.referencePrice,4),saleItemId:numericId(c.saleItemId)}] : []) }
}
function readChangePayload(value: unknown): Payload | null {
  if (!object(value) || value.version !== 1 || !['line_changes','price_history_refs'].includes(String(value.kind)) || value.quantityScale !== 2 || value.priceScale !== 4 || !Array.isArray(value.rows)) return null
  const rows: Change[] = []
  for (const row of value.rows) {
    if (!object(row) || typeof row.key !== 'string' || !['added','removed','changed'].includes(String(row.action))) return null
    const before = row.before == null ? null : line(row.before), after = row.after == null ? null : line(row.after)
    if ((row.before != null && !before) || (row.after != null && !after) || (!before && !after)) return null
    rows.push({ key:row.key,action:row.action as Change['action'],before,after })
  }
  const actors = object(value.actors) ? value.actors : {}
  return {reason:text(value.reason),rows,applicant:object(actors.applicant) ? text(actors.applicant.name) : null,approver:object(actors.approver) ? text(actors.approver.name) : null,hiddenRowCount:Number.isSafeInteger(value.hiddenRowCount) && Number(value.hiddenRowCount)>0 ? Number(value.hiddenRowCount) : 0}
}
function Value({ value }: { value: Line | null }) {
  if (!value) return <span className="text-muted-foreground">无此行</span>
  return <div className="space-y-1 tabular-nums">
    {value.quantity != null && <p>数量 {value.quantity} {value.unit}</p>}
    <p>{value.priceType || '单价'} {value.unitPrice ?? '未记录'}</p>
    {value.baseUnitPriceExact && Number(value.baseUnitPriceExact) !== Number(value.unitPrice) && <p className="text-xs text-muted-foreground">基本单价（保存值）{value.baseUnitPriceExact}</p>}
    {value.amount != null && <p>金额 {value.amount}</p>}
    {value.entryQty != null && value.entryUnit && value.entryUnit !== value.unit && <p className="text-xs text-muted-foreground">{value.entryQtyBasis === 'current_conversion' ? '当前换算量' : '录入'} {value.entryQty} {value.entryUnit}{value.entryUnitPrice ? ` · 单价 ${value.entryUnitPrice}` : ''}{value.conversionRate ? `（换算率 ${value.conversionRate}）` : ''}</p>}
    {value.originalEntryQty && value.entryUnit && value.entryQtyBasis === 'current_conversion' && <p className="text-xs text-muted-foreground">原录入依据 {value.originalEntryQty} {value.entryUnit}{value.entryQty == null ? ' · 当前量无法按两位换算' : ''}</p>}
    {value.kitVersionId && <p className="text-xs text-muted-foreground">套件版本 #{value.kitVersionId} · 保存的资料 {value.snapshotRevision ?? '未记录'}</p>}
    {!!value.components.length && <ul className="space-y-1 text-xs text-muted-foreground">{value.components.map((c,index) => <li key={index}><ProductIdentitySummary product={c} />{c.requiredQty ?? '未记录'} · 参考价 {c.referencePrice ?? '未记录'}{c.saleItemId ? ` · 关联行 #${c.saleItemId}` : ''}</li>)}</ul>}
  </div>
}
export function OrderChangeDetails({ payload }: { payload: unknown }) {
  const change = readChangePayload(payload)
  if (!change) return null
  return <div className="mt-2 space-y-2 text-xs">
    <p className="break-words leading-5"><span className="text-muted-foreground">原因：</span>{change.reason || '未记录'}</p>
    {change.hiddenRowCount > 0 && <p className="text-muted-foreground">部分明细因范围未展示</p>}
    {!!change.rows.length && <details className="rounded-md border">
      <summary className="cursor-pointer px-3 py-2 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">查看 {change.rows.length} 行变更</summary>
      <div className="overflow-x-auto px-3 pb-3"><ReportTable className="w-full min-w-[480px] text-xs"><thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 font-medium">商品 / 变更</th><th className="px-3 py-2 font-medium">改前</th><th className="px-3 py-2 font-medium">改后</th></tr></thead><tbody className="divide-y">{change.rows.map((row,index) => <tr key={`${row.key}-${index}`}><td className="max-w-48 py-2 align-top"><ProductIdentitySummary product={row.after || row.before || {}} /><p className="mt-1 text-muted-foreground">{{added:'新增',removed:'删除',changed:'变更'}[row.action]}</p></td><td className="px-3 py-2 align-top"><Value value={row.before} /></td><td className="px-3 py-2 align-top"><Value value={row.after} /></td></tr>)}</tbody></ReportTable></div>
      {(change.applicant || change.approver) && <p className="px-3 pb-3 text-muted-foreground">申请人：{change.applicant || '未记录'} · 批准人：{change.approver || '未记录'}</p>}
    </details>}
  </div>
}
