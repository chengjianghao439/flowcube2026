import { useContext, type ReactNode } from 'react'
import { PageHeaderContext } from './PageHeaderContext'

interface PageHeaderProps {
  title: string
  description?: ReactNode
  actions?: ReactNode
}

export default function PageHeader({ title, description, actions }: PageHeaderProps) {
  const group = useContext(PageHeaderContext)
  return (
    <>
      <div className="mb-4 flex min-w-0 flex-col items-start justify-between gap-3 sm:flex-row">
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-xl font-semibold leading-7 text-foreground">{group?.title ?? title}</h1>
          {description && (
            <div className="mt-1 max-w-4xl text-sm leading-6 text-muted-foreground">{description}</div>
          )}
        </div>
        {actions && (
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-4 sm:w-auto sm:shrink-0 sm:justify-end">{actions}</div>
        )}
      </div>
      {group?.navigation}
    </>
  )
}
