import type { ReactNode } from 'react'
import { ProductIdentitySummary } from '@/components/shared/ProductIdentitySummary'
import type { PurchaseOrderItem } from '@/types/purchase'

/** 商品身份仅集中展示，不解析销售商业行或价格。 */
export function PurchaseProductIdentity({ item, name }: { item: Pick<PurchaseOrderItem, 'productCode' | 'productName' | 'articleNumber' | 'spec' | 'color'>; name?: ReactNode }) {
  return <ProductIdentitySummary product={item} name={name} />
}
