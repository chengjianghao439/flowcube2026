import type { ReactNode } from 'react'

type ProductIdentity = {
  productCode?: string | null; code?: string | null
  productName?: string | null; name?: string | null
  articleNumber?: string | null; spec?: string | null; color?: string | null
}
const fields = ['编码', '供应商型号', '型号', '名称', '颜色']
const widths = ['min-w-40', 'min-w-40', 'min-w-36', 'min-w-56', 'min-w-28']

export function ProductIdentityHeaders() {
  return <>{fields.map((label, i) => <th key={label} className={`${widths[i]} px-3 py-3 text-left font-medium`}>{label}</th>)}</>
}
export function ProductIdentityCells({ product, nameContent }: { product: ProductIdentity; nameContent?: ReactNode }) {
  const values = [product.productCode ?? product.code, product.articleNumber, product.spec, nameContent ?? product.productName ?? product.name, product.color]
  return <>{values.map((value, i) => <td key={fields[i]} className={`${widths[i]} px-3 py-3 break-words leading-6`}>{value == null || value === '' ? '—' : value}</td>)}</>
}

/** Grid-based detail dialogs use the same five independent identity fields. */
export function ProductIdentityGridHeaders() {
  return <>{fields.map(label => <div key={label} className="px-3">{label}</div>)}</>
}
export function ProductIdentityGridCells({ product }: { product: ProductIdentity }) {
  const values = [product.productCode ?? product.code, product.articleNumber, product.spec, product.productName ?? product.name, product.color]
  return <>{values.map((value, i) => <div key={fields[i]} className="break-words px-3 leading-6">{value == null || value === '' ? '—' : value}</div>)}</>
}

/** Single-product summaries retain labeled fields rather than concatenated metadata. */
export function ProductIdentityDetails({ product }: { product: ProductIdentity }) {
  const values = [product.productCode ?? product.code, product.articleNumber, product.spec, product.productName ?? product.name, product.color]
  return <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">{values.map((value, i) => <div key={fields[i]} className={i === 3 ? 'col-span-2' : ''}><dt className="mb-1 text-xs text-muted-foreground">{fields[i]}</dt><dd className="break-words leading-6">{value == null || value === '' ? '—' : value}</dd></div>)}</dl>
}
