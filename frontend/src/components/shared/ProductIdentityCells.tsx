import type { ReactNode } from 'react'
import { fields, widths, productIdentityHeaderCells } from './productIdentityHeaderCells'
import { ProductIdentitySummary } from './ProductIdentitySummary'

type ProductIdentity = {
  productCode?: string | null; code?: string | null
  productName?: string | null; name?: string | null
  articleNumber?: string | null; spec?: string | null; color?: string | null
}
export function ProductIdentityHeaders() { return <>{productIdentityHeaderCells()}</> }
export function ProductIdentityCells({ product, nameContent, compact = false }: { product: ProductIdentity; nameContent?: ReactNode; compact?: boolean }) {
  if (compact) return <td className="px-4 py-3"><ProductIdentitySummary product={product} name={nameContent} /></td>
  const values = [product.productCode ?? product.code, product.articleNumber, product.spec, nameContent ?? product.productName ?? product.name, product.color]
  return <>{values.map((value, i) => <td key={fields[i]} className={`${widths[i]} px-3 py-3 break-words leading-6`}>{value == null || value === '' ? '—' : value}</td>)}</>
}

/** Single-product summaries retain labeled fields rather than concatenated metadata. */
export function ProductIdentityDetails({ product }: { product: ProductIdentity }) {
  const values = [product.productCode ?? product.code, product.articleNumber, product.spec, product.productName ?? product.name, product.color]
  return <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">{values.map((value, i) => <div key={fields[i]} className={i === 3 ? 'col-span-2' : ''}><dt className="mb-1 text-xs text-muted-foreground">{fields[i]}</dt><dd className="break-words leading-6">{value == null || value === '' ? '—' : value}</dd></div>)}</dl>
}
