export const fields = ['编码', '供应商型号', '型号', '名称', '颜色']
export const widths = ['min-w-40', 'min-w-40', 'min-w-36', 'min-w-56', 'min-w-28']
const compactWidths = ['min-w-24', 'min-w-20', 'min-w-20', 'min-w-32', 'min-w-16']
export type ProductIdentityHeaderProps = { density?: 'default' | 'compact' }
export function productIdentityWidths(density: ProductIdentityHeaderProps['density']) {
  return density === 'compact' ? compactWidths : widths
}

export function productIdentityHeaderCells({ density }: ProductIdentityHeaderProps = {}) {
  return fields.map((label, i) => <th key={label} className={`${productIdentityWidths(density)[i]} px-3 py-3 text-left font-medium`}>{label}</th>)
}
