import type { ReactNode } from 'react'
import { ProductIdentitySummary } from '@/components/shared/ProductIdentitySummary'
import { TableTextPreview } from '@/components/shared/TableTextPreview'
import type { PurchaseOrderItem } from '@/types/purchase'

/** 商品身份仅集中展示，不解析销售商业行或价格。 */
export function PurchaseProductIdentity({ item, name }: { item: Pick<PurchaseOrderItem, 'productCode' | 'productName' | 'articleNumber' | 'spec' | 'color'>; name?: ReactNode }) {
  const details = [item.spec && `型号 ${item.spec}`, item.color && `颜色 ${item.color}`, item.articleNumber && `供应商型号 ${item.articleNumber}`].filter(Boolean).join(' · ')
  return <ProductIdentitySummary product={item} name={name} details={<TableTextPreview previewLines={1} title="商品规格" value={details}>{details}</TableTextPreview>} />
}
