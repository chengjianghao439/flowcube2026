export const fields = ['编码', '供应商型号', '型号', '名称', '颜色']
export const widths = ['min-w-40', 'min-w-40', 'min-w-36', 'min-w-56', 'min-w-28']

export function productIdentityHeaderCells() {
  return fields.map((label, i) => <th key={label} className={`${widths[i]} px-3 py-3 text-left font-medium`}>{label}</th>)
}
