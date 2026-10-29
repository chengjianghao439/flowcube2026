import { ProductIdentitySummary } from '@/components/shared/ProductIdentitySummary'
import type { PurchaseOrderItem } from '@/types/purchase'

export function InboundProductIdentity({ item }: { item: Pick<PurchaseOrderItem, 'productCode' | 'productName' | 'articleNumber' | 'spec' | 'color'> }) {
  return <ProductIdentitySummary product={item} />
}
