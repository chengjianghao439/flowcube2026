import { useContext, type ReactNode } from 'react'
import { PageHeaderContext } from './PageHeaderContext'

interface PageHeaderProps {
  title: string
  /** 页头唯一的小字说明：有提示显示完整提示，无提示显示具体用途。 */
  description: ReactNode
  /** 单据、编辑和未保存状态，与标题同行。 */
  status?: ReactNode
  actions?: ReactNode
}

export default function PageHeader({ title, description, status, actions }: PageHeaderProps) {
  const group = useContext(PageHeaderContext)
  return (
    <div className="desktop-page-heading mb-5 min-w-0 shrink-0">
      <div className="desktop-page-header flex min-h-9 min-w-0 flex-col flex-wrap items-start justify-between gap-3 sm:flex-row">
        <div className="desktop-page-heading-main min-w-0 flex-1">
          <div className="desktop-page-identity flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="min-w-0 max-w-full break-words text-xl font-semibold leading-7 text-foreground">{group?.title ?? title}</h1>
            {status && (
              <div className="desktop-page-status flex min-w-0 flex-wrap items-center gap-2 text-sm">{status}</div>
            )}
          </div>
          <p className="desktop-page-description mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        {actions && (
          <div className="flex w-full max-w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">{actions}</div>
        )}
      </div>
      {group?.navigation && <div className="desktop-page-navigation mt-4">{group.navigation}</div>}
    </div>
  )
}
