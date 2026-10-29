import type { ReactNode } from 'react'
import type { TableColumn } from '@/types'
import { ProductIdentitySummary, type ProductIdentitySummaryValue } from './ProductIdentitySummary'

/** 只投影当前行身份字段；别名、链接与编辑入口由调用方显式提供。 */
export function productIdentityColumns(keys: { code?: string; name?: string; compact?: boolean; nameContent?: (row: ProductIdentitySummaryValue & Record<string, unknown>) => ReactNode } = {}): TableColumn<object>[] {
  return [{ key: 'productIdentity', title: '商品', width: 360, minWidth: 240, render: (_, row) => {
    const value = row as ProductIdentitySummaryValue & Record<string, unknown>
    const product = { ...value, productCode: (keys.code ? value[keys.code] : value.productCode ?? value.code) as string | null | undefined, productName: (keys.name ? value[keys.name] : value.productName ?? value.name) as string | null | undefined }
    return <ProductIdentitySummary product={product} name={keys.nameContent?.(value)} />
  } }]
}
