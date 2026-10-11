import type { ReactNode } from 'react'
import { TableTextPreview } from '@/components/shared/TableTextPreview'
import type { PurchaseOrderItem } from '@/types/purchase'

/** 商品身份仅集中展示，不解析销售商业行或价格。 */
export function PurchaseProductIdentity({ item, name }: { item: Pick<PurchaseOrderItem, 'productCode' | 'productName' | 'articleNumber' | 'spec' | 'color'>; name?: ReactNode }) {
  const details = [item.spec && `型号 ${item.spec}`, item.color && `颜色 ${item.color}`, item.articleNumber && `供应商型号 ${item.articleNumber}`].filter(Boolean).join(' · ')
  return <div className="min-w-0 space-y-1 whitespace-normal [overflow-wrap:anywhere]">
    <div className="font-medium leading-5"><span className="mr-2 font-mono text-xs text-muted-foreground">{item.productCode}</span>{name ?? item.productName}</div>
    {details && <div className="text-xs text-muted-foreground"><TableTextPreview previewLines={1} title="商品规格" value={details}>{details}</TableTextPreview></div>}
  </div>
}
