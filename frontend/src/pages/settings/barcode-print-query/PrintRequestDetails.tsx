import { Badge } from '@/components/ui/badge'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { formatPrintStatus } from '@/utils/displayFormatters'
import type { BarcodePrintJobInfo } from '@/types/print-jobs'

const REF_LABELS: Record<string, string> = {
  inventory_container: '库存条码记录',
  package: '箱贴记录',
  waybill: '运单记录',
}

/** 排队请求的原始资料；份数与客户端回报都不能替代现场核纸。 */
export default function PrintRequestDetails({ job }: { job: BarcodePrintJobInfo | null }) {
  if (!job) return null
  const purpose = job.requestPurpose === 'initial' ? '初打' : job.requestPurpose === 'reprint' ? '补打' : '未记录'
  const requester = `${job.createdByName || '未记录'}${job.createdById != null ? `（#${job.createdById}）` : ''}`
  const copies = job.requestedCopies != null ? `${job.requestedCopies} 份` : '未记录'
  const state = job.statusKey === 'success' ? '客户端回报成功' : formatPrintStatus(job.statusKey, job.printStateLabel, job.errorMessage)
  const referenceLabel = job.refType ? REF_LABELS[job.refType] : null
  const fields = [
    ['记录 ID', `#${job.id}`],
    ['请求目的', purpose],
    ['请求人', requester],
    ['请求时间', formatDisplayDateTime(job.createdAt, '未记录')],
    ['请求份数', copies],
    ['状态', state],
    ['客户端回报时间', formatDisplayDateTime(job.acknowledgedAt, '未记录')],
    ...(referenceLabel && job.refId != null ? [['关联业务', `${referenceLabel} #${job.refId}`]] : []),
    ...(job.refCode ? [['关联条码', job.refCode]] : []),
    ...(job.sourcePrintJobId != null ? [['来源打印记录', `#${job.sourcePrintJobId}`]] : []),
    ['错误', job.errorMessage || '未记录'],
  ]
  return (
    <div className="space-y-1">
      {job.requestPurpose === 'reprint' && <Badge variant="outline" className="text-xs font-normal" data-print-purpose="reprint">补打</Badge>}
      <details className="text-xs">
        <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">打印记录</summary>
        <dl className="mt-2 space-y-1.5 leading-5">
          {fields.map(([label, value]) => <div key={label} className="space-y-0.5">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>)}
        </dl>
        <p className="mt-2 leading-5 text-muted-foreground">份数是本次请求数量。客户端回报不代表实际出纸，请现场核对标签纸张。</p>
      </details>
    </div>
  )
}
