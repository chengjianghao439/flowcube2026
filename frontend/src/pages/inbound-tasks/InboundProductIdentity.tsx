import { TableTextPreview } from '@/components/shared/TableTextPreview'
import type { PurchaseOrderItem } from '@/types/purchase'

/** 沿用采购身份层级，收货默认每层一行；截断时复用现有原生展开，不丢完整识别信息。 */
export function InboundProductIdentity({ item }: { item: Pick<PurchaseOrderItem, 'productCode' | 'productName' | 'articleNumber' | 'spec' | 'color'> }) {
  const details = [item.spec && `型号 ${item.spec}`, item.color && `颜色 ${item.color}`, item.articleNumber && `供应商型号 ${item.articleNumber}`].filter(Boolean).join(' · ')
  return <div className="min-w-0 space-y-1 whitespace-normal [overflow-wrap:anywhere]">
    <div className="font-medium leading-5"><TableTextPreview previewLines={1} title="商品名称" value={`${item.productCode} ${item.productName}`}><span className="mr-2 font-mono text-xs text-muted-foreground">{item.productCode}</span>{item.productName}</TableTextPreview></div>
    {details && <div className="text-xs text-muted-foreground"><TableTextPreview previewLines={1} title="商品规格" value={details}>{details}</TableTextPreview></div>}
  </div>
}
