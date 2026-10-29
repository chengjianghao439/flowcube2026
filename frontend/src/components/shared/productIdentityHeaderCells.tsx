export const fields = ['商品']
export const widths = ['min-w-80']
const compactWidths = ['min-w-64']
export type ProductIdentityHeaderProps = {
  density?: 'default' | 'compact'
  /** 单列商品宽度；旧五列配置已失效时使用组合列默认宽度。 */
  widthClasses?: readonly [string] | readonly [string, string, string, string, string]
}
export function productIdentityWidths(density: ProductIdentityHeaderProps['density'], widthClasses?: ProductIdentityHeaderProps['widthClasses']) {
  return widthClasses?.length === 1 ? widthClasses : density === 'compact' ? compactWidths : widths
}
export function productIdentityHeaderCells({ density, widthClasses }: ProductIdentityHeaderProps = {}) {
  return [<th key="商品" className={`${productIdentityWidths(density, widthClasses)[0]} px-3 py-3 text-left font-medium`}>商品</th>]
}
