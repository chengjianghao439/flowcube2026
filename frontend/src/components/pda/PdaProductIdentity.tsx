import { ProductIdentitySummary, type ProductIdentitySummaryValue } from '@/components/shared/ProductIdentitySummary'

/** PDA 与桌面共用商品身份层级，作业总览也完整显示当前数据。 */
export default function PdaProductIdentity({ product, code, name, spec, color, articleNumber }: {
  product?: ProductIdentitySummaryValue
  code?: string | null
  name?: string | null
  spec?: string | null
  color?: string | null
  articleNumber?: string | null
  view?: 'overview' | 'detail'
}) {
  return <ProductIdentitySummary product={{ ...product, code: code ?? product?.code, name: name ?? product?.name, spec: spec ?? product?.spec, color: color ?? product?.color, articleNumber: articleNumber ?? product?.articleNumber }} />
}
