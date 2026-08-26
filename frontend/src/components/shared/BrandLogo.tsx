/**
 * BrandLogo — 公司 Logo（客户内场品牌位）
 *
 * 与 SystemBrand（极序品牌）的分工（2026-08-26 起）：
 *  - SystemBrand：产品门面位（ERP/PDA 登录页、PDA 首页）恒为极序品牌；
 *  - BrandLogo：客户内场位（ERP 顶栏、打印单据模板），公司 Logo 优先，
 *    未上传回退极序文字/不渲染。
 *
 * 读取公司 Logo（GET /api/settings/logo，公开接口——未登录也显示）。
 * 有 Logo：渲染 <img>（imgClassName 控制高度，宽自适应 object-contain）；
 * 无 Logo / 图片加载失败：渲染默认「Layers 图标 + 品牌色圆角色块」回退，
 *   或传 hideFallbackIcon 退回空（不渲染图标的位置）；或传 text 渲染纯文字。
 *
 * 使用 React Query 共享查询键（['brand-logo']），多点位只发一次请求；
 * 设置页上传成功后 invalidateQueries(['brand-logo']) 即可同步刷新全部品牌位
 * （后端 URL 带 v= 时间戳参数，图片天然破缓存）。
 * 图片一律 <img> 渲染（SVG 脚本不可执行）。
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Layers } from 'lucide-react'
import { getLogoApi } from '@/api/settings'
import { cn } from '@/lib/utils'

// 查询键：与设置页（pages/settings/index.tsx）上传后的 invalidate 键保持一致；
// 不导出常量，避免本文件触发 react-refresh/only-export-components warning。
const BRAND_LOGO_QUERY_KEY = ['brand-logo']

export default function BrandLogo(props: {
  /** 有 Logo 时 <img> 的尺寸样式（主传高度，如 h-6 / h-8 / h-14；宽度恒 w-auto） */
  imgClassName?: string
  /** 无 Logo 回退色块盒的样式（如 h-8 w-8 rounded-lg） */
  boxClassName?: string
  /** 回退 Layers 图标的大小 */
  iconClassName?: string
  className?: string
  /** 无 Logo 时不渲染回退图标（仅调用方文字保留，用于现状无图标的品牌位） */
  hideFallbackIcon?: boolean
  /**
   * 文字回退：无 Logo 且传入 text 时渲染「纯文字」（不渲染图标盒）——用于「有 Logo 只显图、
   * 无 Logo 显文字」的品牌位（如 ERP 顶栏）；传入后 textClassName 控制文字样式
   */
  text?: string
  textClassName?: string
  alt?: string
}) {
  const { imgClassName, boxClassName, iconClassName, className, hideFallbackIcon, text, textClassName, alt } = props
  // 未登录（登录页/PDA）也请求：接口公开。失败静默回退默认样式（skipGlobalError，不弹全局 toast）。
  const { data } = useQuery({
    queryKey: BRAND_LOGO_QUERY_KEY,
    queryFn: () => getLogoApi({ skipGlobalError: true }),
    staleTime: 5 * 60_000,
    retry: 1,
  })
  const [imgFailed, setImgFailed] = useState(false)
  const url = data?.url || ''

  if (url && !imgFailed) {
    return (
      <img
        src={url}
        alt={alt ?? '公司 Logo'}
        className={cn('w-auto object-contain', imgClassName, className)}
        onError={() => setImgFailed(true)}
      />
    )
  }
  if (text) {
    return <span className={cn(textClassName, className)}>{text}</span>
  }
  if (hideFallbackIcon) return null
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center bg-primary text-white', boxClassName, className)}>
      <Layers className={cn('size-5', iconClassName)} />
    </span>
  )
}
