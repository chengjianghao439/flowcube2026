const AppError = require('../../utils/AppError')

const PRINT_LABEL_BASE_ACTION = 'package.print-label'

/** 从 base / scoped action 取回 base（`package.print-label.12` → `package.print-label`） */
function baseActionOf(action) {
  const m = /^(.*)\.([1-9]\d*)$/.exec(String(action ?? ''))
  return m ? m[1] : String(action ?? '')
}

/**
 * 箱贴（`package.print-label`）**已确认成功**回执的自洽校验 —— 纯函数，不改任何状态。
 *
 * 背景：修复「同一个 `X-Request-Key` 被用到另一只箱上」之前落库的成功回执，可能是
 * 「**B 箱的资源 id + A 箱的 job**」（`jobUniqueKey` 当时只带 requestKey，createRecord
 * 命中前一箱的活跃 job 就原样返回）。这类历史行**既不能原键重放、也不能当查询结果交给前端**：
 * 前端一看到 `status === 'success'` 就会清掉待确认记录并当作本次成功，之后再没有任何地方校验。
 *
 * 只对箱贴动作、且 `status === 'success'` 时生效；`noPrinter`（`queued=false`、无 job）放行。
 * 不一致时抛 409 要求**人工核对原打印** —— 既不改写历史行，也不自动补打一张（重复出纸同样是事故）。
 */
function assertPrintLabelReceiptConsistent(action, receipt) {
  if (baseActionOf(action) !== PRINT_LABEL_BASE_ACTION) return
  if (!receipt || receipt.status !== 'success') return

  const job = receipt.data?.job
  if (!job) {
    // `queued=true` 却没有 job 信息 ⇒ 无法判定这批箱贴是不是本箱的，只提示人工核对，不猜成新打印
    if (receipt.data?.queued === true) {
      throw new AppError(
        '箱贴打印回执缺少可核对的打印任务信息，请人工核对打印记录后再操作',
        409,
        'PACKAGE_LABEL_RECEIPT_UNVERIFIED',
      )
    }
    return
  }

  const resourceId = receipt.resourceId
  if (resourceId != null && (job.refType !== 'package' || Number(job.refId) !== Number(resourceId))) {
    throw new AppError(
      `上次箱贴打印的回执指向的是其它箱子（打印任务 #${job.id ?? '未知'} → 箱 ${job.refId ?? '未知'}），`
      + '请先在打印记录页核对原打印，再决定是否重打',
      409,
      'PACKAGE_LABEL_RECEIPT_MISMATCH',
    )
  }
}

module.exports = { assertPrintLabelReceiptConsistent, baseActionOf, PRINT_LABEL_BASE_ACTION }
