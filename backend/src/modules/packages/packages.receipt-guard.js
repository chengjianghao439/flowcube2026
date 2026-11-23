const AppError = require('../../utils/AppError')
const { pdaSessionRequired } = require('../../middleware/pdaSession')
const { assertTaskScope } = require('../warehouse-tasks/warehouse-tasks.helpers')

const PRINT_LABEL_BASE_ACTION = 'package.print-label'
const CREATE_PACKAGE_ACTION = 'package.create'
const requireDevice = pdaSessionRequired()

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
        '箱贴打印结果缺少可核对的打印任务信息，请人工核对打印记录后再操作',
        409,
        'PACKAGE_LABEL_RECEIPT_UNVERIFIED',
      )
    }
    return
  }

  const resourceId = receipt.resourceId
  if (resourceId != null && (job.refType !== 'package' || Number(job.refId) !== Number(resourceId))) {
    throw new AppError(
      `上次箱贴打印的结果指向的是其它箱子（打印任务 #${job.id ?? '未知'} → 箱 ${job.refId ?? '未知'}），`
      + '请先在打印记录页核对原打印，再决定是否重打',
      409,
      'PACKAGE_LABEL_RECEIPT_MISMATCH',
    )
  }
}

async function assertCreatePackageReceipt(conn, receipt, context, req, res) {
  const { requestedAction, matchedAction } = context
  if (receipt.status !== 'success') return
  const { data, resourceType, resourceId } = receipt
  const scopedAction = `${CREATE_PACKAGE_ACTION}.${resourceId}`
  const invalid = () => new AppError('建箱结果与原任务或箱码不一致，请保留记录并核对', 409, 'PACKAGE_CREATE_RECEIPT_INVALID')
  if (matchedAction !== scopedAction || resourceType !== 'warehouse_task'
      || !Number.isSafeInteger(resourceId) || resourceId <= 0 || data?.warehouseTaskId !== resourceId
      || !Number.isSafeInteger(data?.id) || data.id <= 0 || !/^L\d+$/.test(data.barcode)
      || (baseActionOf(requestedAction) === CREATE_PACKAGE_ACTION
          && requestedAction !== CREATE_PACKAGE_ACTION && requestedAction !== scopedAction)) throw invalid()
  await new Promise((resolve, reject) => requireDevice(req, res, error => error ? reject(error) : resolve()))
  const [[task]] = await conn.query(
    `SELECT t.warehouse_id FROM packages p
     JOIN warehouse_tasks t ON t.id=p.warehouse_task_id AND t.deleted_at IS NULL
     WHERE p.id=? AND p.barcode=? AND t.id=?`,
    [data.id, data.barcode, resourceId],
  )
  if (!task) throw invalid()
  if (req.pda?.warehouseId == null) throw new AppError('设备尚未绑定仓库，无法核对建箱结果', 403, 'PDA_WAREHOUSE_REQUIRED')
  assertTaskScope(task, { scopeWarehouseIds: req.user?.warehouseIds ?? null, pdaWarehouseId: req.pda.warehouseId })
}

module.exports = { assertPrintLabelReceiptConsistent, assertCreatePackageReceipt, CREATE_PACKAGE_ACTION }
