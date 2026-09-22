import PdaOverviewText from './PdaOverviewText'

/** PDA 以编码识别商品；总览压缩名称，进入作业详情后展示全名。 */
export default function PdaProductIdentity({ code, name, view }: {
  code?: string | null
  name?: string | null
  view: 'overview' | 'detail'
}) {
  const fullName = name || '—'
  return <div className="min-w-0">
    <p className="font-mono font-semibold text-foreground whitespace-normal [overflow-wrap:anywhere]">{code || '—'}</p>
    {view === 'overview'
      ? <PdaOverviewText>{fullName}</PdaOverviewText>
      : <p className="text-sm text-muted-foreground whitespace-normal [overflow-wrap:anywhere]">{fullName}</p>}
  </div>
}
