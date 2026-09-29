const { Router } = require('express')
const { z }      = require('zod')
const ctrl       = require('./packages.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { pdaOnly } = require('../../middleware/pdaOnly')
const { pdaSessionRequired, pdaSessionOptional } = require('../../middleware/pdaSession')
const { validateBody } = require('../../utils/route')

const router = Router()

router.use(authMiddleware)

// GET  /api/packages?taskId=:taskId     — 查询任务下所有箱子
router.get('/', requirePermission(PERMISSIONS.WAREHOUSE_TASK_VIEW), ctrl.list)

// GET  /api/packages/barcode/:barcode  — 按条码查询箱子（PDA 扫码出库）
router.get('/barcode/:barcode', requirePermission(PERMISSIONS.WAREHOUSE_TASK_VIEW), ctrl.getByBarcode)

// 打包是现场扫码作业：建箱、装箱、移出、作废、完成一律要求 X-Client: pda。
// 缺了这道闸门，ERP 端可以凭 warehouse_task.pack 权限直接构造请求把箱子"打包完成"，
// 绕过现场实物核对——出库确认扫的是箱码，箱里到底装没装货就没人验过了。
// print-label（补打）与两个 GET 不加：补打是打印动作，ERP 端也该能发起。
//
// POST /api/packages                 — 创建箱子
router.post('/',
  pdaOnly,
  pdaSessionRequired(),
  requirePermission(PERMISSIONS.WAREHOUSE_TASK_PACK),
  validateBody(z.object({
    warehouseTaskId: z.number().int().positive('warehouseTaskId 必填'),
    remark:          z.string().max(200).optional(),
  })),
  ctrl.create,
)

// POST /api/packages/:id/add-item    — 向箱子添加商品
// 两种形态二选一：
//   · 商品码：`{ productCode, qty }`（旧 SKU 份额，行为不变）
//   · 取货标签：`{ labelContainerId, qty? }`——**qty 省略即整份装入该标签的未装余量**
//     （扫码作业的默认语义：扫一张标签就把这张标签的货全放进去，不是 1 件）
router.post('/:id/add-item',
  pdaOnly,
  pdaSessionRequired(),
  requirePermission(PERMISSIONS.WAREHOUSE_TASK_PACK),
  validateBody(z.object({
    productCode:      z.string().min(1).optional(),
    labelBarcode:     z.string().min(1).optional(),
    qty:              z.number().positive('数量必须大于 0').optional(),
  }).refine(v => Boolean(v.productCode) !== Boolean(v.labelBarcode), {
    message: '商品条码与取货标签必须且只能提供一个',
  })),
  ctrl.addItem,
)

// POST /api/packages/:id/remove-item — 从箱子移出商品
router.post('/:id/remove-item',
  pdaOnly,
  pdaSessionRequired(),
  requirePermission(PERMISSIONS.WAREHOUSE_TASK_PACK),
  validateBody(z.object({
    itemId: z.number().int().positive('itemId 必填'),
    qty:    z.number().positive('数量必须大于 0').optional(),
  })),
  ctrl.removeItem,
)

// POST /api/packages/:id/void        — 作废单箱
router.post('/:id/void', pdaOnly, pdaSessionRequired(), requirePermission(PERMISSIONS.WAREHOUSE_TASK_PACK), ctrl.voidPackage)

// PUT  /api/packages/:id/finish      — 完成打包
router.put('/:id/finish', pdaOnly, pdaSessionRequired(), requirePermission(PERMISSIONS.WAREHOUSE_TASK_PACK), ctrl.finish)

// POST /api/packages/:id/print-label — 补打箱贴
// 补打是打印动作，ERP 端也该能发起 → 用 pdaSessionOptional：纯 PC 请求（无 PDA 标记）走
// 权限 + 仓库数据范围；**一旦带了** X-Client: pda 或 X-PDA-Session，就按 PDA 口径完整校验设备，
// 并把设备仓交给 service 与箱所属仓比对。少了这层，拿着 A 仓的 PDA 能给 B 仓的箱补打箱贴。
router.post('/:id/print-label', pdaSessionOptional(), requirePermission(PERMISSIONS.PRINT_JOB_REPRINT), ctrl.printLabel)

module.exports = router
