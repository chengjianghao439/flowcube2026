import { formatDisplayDateTime } from '@/lib/dateTime'
import { formatPrintStatus } from '@/utils/displayFormatters'
import type { BarcodePrintJobInfo } from '@/types/print-jobs'

const REF_LABELS: Record<string, string> = {
  inventory_container: '库存条码记录',
  package: '箱贴记录',
  waybill: '运单记录',
}

function printResultHint(status: BarcodePrintJobInfo['statusKey']) {
  if (status === 'success') return '客户端已回报成功，请现场核对标签纸张。'
  if (status === 'queued' || status === 'printing') return '打印结果尚待确认，请核对工作站和现场纸张。'
  if (status === 'failed' || status === 'timeout') return '请先核对工作站、打印机和纸张。'
  return '请根据客户端回报和现场纸张核对结果。'
}

/** 展示已打开的打印任务及其客户端回报。 */
export default function PrintRequestDetails({ job, hasNewerJob }: { job: BarcodePrintJobInfo; hasNewerJob: boolean }) {
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
    ['打印任务状态', state],
    ['打印机', job.printerName || '未记录'],
    ['打印机编号', job.printerCode || '未记录'],
    ['客户端回报时间', formatDisplayDateTime(job.acknowledgedAt, '未记录')],
    ...(referenceLabel && job.refId != null ? [['关联业务', `${referenceLabel} #${job.refId}`]] : []),
    ...(job.refCode ? [['关联条码', job.refCode]] : []),
    ...(job.sourcePrintJobId != null ? [['来源打印记录', `#${job.sourcePrintJobId}`]] : []),
  ]
  return (
    <div className="space-y-4 px-5 py-4 text-sm">
      {hasNewerJob && <p className="text-muted-foreground" role="status">列表已有更新的打印任务。关闭后可查看最新记录。</p>}
      <dl className="grid grid-cols-1 gap-x-5 gap-y-3 leading-5 sm:grid-cols-2">
        {fields.map(([label, value]) => <div key={label} className="min-w-0 space-y-0.5">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="[overflow-wrap:anywhere]">{value}</dd>
        </div>)}
        {job.errorMessage && <div className="min-w-0 space-y-0.5 sm:col-span-2">
          <dt className="text-xs text-muted-foreground">错误</dt>
          <dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">{job.errorMessage}</dd>
        </div>}
      </dl>
      <p className="border-t pt-3 text-xs leading-5 text-muted-foreground">
        份数为本次请求数量。{printResultHint(job.statusKey)}
      </p>
    </div>
  )
}
