import type { ReactNode } from 'react'

/** 单据与主数据列表共用：名称为主，编码与补充信息为辅。 */
export function RecordIdentity({ title, code, detail }: { title: ReactNode; code?: ReactNode; detail?: ReactNode }) {
  return <div className="min-w-0 space-y-1 py-1">
    <div className="break-words font-medium leading-5 text-foreground">{title}</div>
    {code && <div className="break-all font-mono text-xs leading-5 text-muted-foreground">{code}</div>}
    {detail && <div className="break-words text-xs leading-5 text-muted-foreground">{detail}</div>}
  </div>
}
