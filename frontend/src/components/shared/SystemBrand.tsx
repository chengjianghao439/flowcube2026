/**
 * SystemBrand — 系统品牌（极序 Flow）标识。
 *
 * 与 BrandLogo（公司 Logo）的分工（2026-08-26 起）：
 *  - SystemBrand：产品门面位（ERP/PDA 登录页、PDA 首页）恒为极序品牌，
 *    不受公司 Logo 上传影响——这些页面是「极序 Flow」的产品本身；
 *  - BrandLogo：客户内场位（ERP 顶栏、打印单据模板），公司 Logo 优先，
 *    未上传回退极序文字/不渲染。
 *
 * 使用已确认的蓝底双曲线 F 本地资源（Vite 哈希打包，与 BrandLogo 默认回退同款），
 * 零接口请求、零 React Query——登录页未登录态也不发任何请求。
 */

import flowIcon from '@/assets/brand/flow-icon.png'
import { cn } from '@/lib/utils'

export default function SystemBrand(props: {
  /** 色块盒样式（如 h-8 w-8 rounded-lg / h-14 w-14 rounded-2xl） */
  boxClassName?: string
  /** 图像样式；默认填满盒子，源图自带安全留白 */
  iconClassName?: string
  className?: string
  /** 不渲染图标盒——仅保留调用方自己的文字标识 */
  hideFallbackIcon?: boolean
}) {
  const { boxClassName, iconClassName, className, hideFallbackIcon } = props
  if (hideFallbackIcon) return null
  return (
    <span
      role="img"
      aria-label="极序 Flow"
      className={cn('inline-flex size-8 shrink-0 items-center justify-center overflow-hidden', boxClassName, className)}
    >
      <img src={flowIcon} alt="" aria-hidden="true" className={cn('size-full object-contain', iconClassName)} />
    </span>
  )
}
