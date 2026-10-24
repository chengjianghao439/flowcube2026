import type { ReactNode } from 'react'

export interface ProductIdentitySummaryValue {
  productCode?: string | null; code?: string | null
  productName?: string | null; name?: string | null
  articleNumber?: string | null; spec?: string | null; color?: string | null
}

/** 单据商品列集中展示原行身份字段，不补查主数据或改写提交内容。 */
export function ProductIdentitySummary({ product, name, details }: { product: ProductIdentitySummaryValue; name?: ReactNode; details?: ReactNode }) {
  const code = product.productCode ?? product.code
  const metadata = [product.spec && `型号 ${product.spec}`, product.color && `颜色 ${product.color}`, product.articleNumber && `供应商型号 ${product.articleNumber}`].filter(Boolean).join(' · ')
  return <div className="min-w-0 space-y-1 whitespace-normal [overflow-wrap:anywhere]">
    <div className="font-medium leading-5">{code && <span className="mr-2 font-mono text-xs text-muted-foreground">{code}</span>}{name ?? product.productName ?? product.name ?? '—'}</div>
    {metadata && <div className="text-xs leading-5 text-muted-foreground">{details ?? metadata}</div>}
  </div>
}
