import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { CurrentReorderSource } from '@/types/sale-reorder'
import { validReorderQuantity } from '@/lib/saleReorder'
export function ReorderSourcePanel({ data, error, loading, imported, disabled, onImport, onReload }: { data: CurrentReorderSource | null; error: string; loading: boolean; imported: boolean; disabled: boolean; onImport: (includeQuantity: boolean) => void; onReload: () => void }) {
  const [include, setInclude] = useState(false)
  const errors = data?.items.filter(i => i.error) ?? []
  return <div className="rounded-md border p-3 space-y-2 text-sm">
    <p>这是新单，按当前资料和价格核对。仅带客户和商品或套定义；出库仓库、运输、收货信息需重新选择。</p>
    {loading && <p role="status">读取原单与当前资料…</p>}
    {error && <p role="alert">{error}</p>}
    {data && <>
      <p>来源：{data.source.orderNo} · {data.source.items.length} 行</p>
      {data.customerError && <p role="alert">{data.customerError}</p>}
      {errors.map((i, n) => <p role="alert" key={n}>原行 {data.items.indexOf(i) + 1}：{i.error}；未删除该行，请在空白新建中重新选择。</p>)}
      {data.items.some(i => i.identity.kind === 'ordinary' && i.product?.unit !== i.identity.baseUnit) && <p>基本单位已变化，旧数量不带入，请人工输入当前基本量。</p>}
      {data.items.some(i => i.identity.kind === 'kit' && i.kit?.currentVersionId !== i.identity.originalKitVersionId) && <p>套组成已更新，本单采用当前版本；旧套数不带入，请核对后人工输入。</p>}
      {data.source.model === 'ordinary' && new Set(data.source.items.filter(i => i.kind === 'ordinary').map(i => i.productId)).size < data.source.items.length && <p>同一商品的旧分仓行合并为当前基本单位一行；不沿用旧仓库。</p>}
      {include && <p>仅带入符合当前单位、精度和数量上限的原量；原量为0、单位或套版本变化、合并后超限的行保留为0，请人工输入。</p>}
      {data.items.some(i => i.identity.kind === 'ordinary' ? !validReorderQuantity(i.identity.baseQty, i.product?.allowDecimalQty === false) : !validReorderQuantity(i.identity.quantity, true)) && <p>部分原数量为0或不符合当前录入规则，商品身份仍保留，请核对后输入本次数量。</p>}
      {!imported && <label className="flex items-center gap-2"><input type="checkbox" checked={include} onChange={e => setInclude(e.target.checked)} disabled={disabled} />带入原基本量／套数（默认不带）</label>}
      <Button variant="outline" disabled={disabled || imported || !!data.customerError || !!errors.length} onClick={() => onImport(include)}>{imported ? '已载入，数量和成交价请再次核对' : '载入当前客户和商品'}</Button>
    </>}
    {(error || data?.customerError || errors.length > 0) && <Button variant="outline" disabled={disabled} onClick={onReload}>重新核对当前资料</Button>}
  </div>
}
