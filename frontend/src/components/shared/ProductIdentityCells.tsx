import type { ReactNode } from 'react'
import { productIdentityWidths, productIdentityHeaderCells, type ProductIdentityHeaderProps } from './productIdentityHeaderCells'
import { ProductIdentitySummary, type ProductIdentitySummaryValue } from './ProductIdentitySummary'

export function ProductIdentityHeaders(props: ProductIdentityHeaderProps) { return <>{productIdentityHeaderCells(props)}</> }
export function ProductIdentityCells({ product, nameContent, density, widthClasses }: { product: ProductIdentitySummaryValue; nameContent?: ReactNode; compact?: boolean } & ProductIdentityHeaderProps) {
  return <td className={`${productIdentityWidths(density, widthClasses)[0]} px-3 py-3 align-top`}><ProductIdentitySummary product={product} name={nameContent} /></td>
}

/** 详情与列表共用完整商品身份，不补查未提供的元数据。 */
export function ProductIdentityDetails({ product }: { product: ProductIdentitySummaryValue }) {
  return <ProductIdentitySummary product={product} />
}
