/**
 * sorting-bins.routes.js
 * 分拣格管理接口
 */
const { Router } = require('express')
const { z } = require('zod')
const svc = require('./sorting-bins.service')
const { successResponse } = require('../../utils/response')
const { authMiddleware } = require('../../middleware/auth')

const router = Router()
router.use(authMiddleware)

function vBody(schema) {
  return (req, res, next) => {
    const r = schema.safeParse(req.body)
    if (!r.success) return res.status(400).json({ success: false, message: r.error.errors.map(e => e.message).join('；'), data: null })
    req.body = r.data; next()
  }
}

// GET /api/sorting-bins/scan?code=xxx
// PDA 扫商品条码 → 查找对应任务的分拣格
router.get('/scan', async (req, res, next) => {
  try {
    const { code } = req.query
    if (!code) return res.status(400).json({ success: false, message: '条码不能为空', data: null })
    const data = await svc.scanProduct(String(code))
    return successResponse(res, data, '查询成功')
  } catch (e) { next(e) }
})

// GET /api/sorting-bins?warehouseId=&keyword=&status=
// 管理页：所有仓库的分拣格
router.get('/', async (req, res, next) => {
  try {
    const { keyword = '', status } = req.query
    const data = await svc.findAllWarehouses({ keyword, status: status ? +status : null })
    return successResponse(res, data, '查询成功')
  } catch (e) { next(e) }
})

// GET /api/sorting-bins/warehouse/:warehouseId
// PDA 或特定仓库查询
router.get('/warehouse/:warehouseId', async (req, res, next) => {
  try {
    const data = await svc.findAll(+req.params.warehouseId)
    return successResponse(res, data, '查询成功')
  } catch (e) { next(e) }
})

// POST /api/sorting-bins — 新建单个
router.post('/',
  vBody(z.object({
    code:        z.string().min(1).max(20),
    warehouseId: z.number().int().positive(),
    remark:      z.string().max(200).optional(),
  })),
  async (req, res, next) => {
    try {
      const data = await svc.create(req.body)
      return successResponse(res, data, '分拣格已创建')
    } catch (e) { next(e) }
  },
)

// POST /api/sorting-bins/batch — 批量创建（如 A01-A10）
router.post('/batch',
  vBody(z.object({
    warehouseId: z.number().int().positive(),
    prefix:      z.string().min(1).max(5),
    from:        z.number().int().min(1),
    to:          z.number().int().min(1),
  })),
  async (req, res, next) => {
    try {
      const data = await svc.batchCreate(req.body)
      return successResponse(res, data, `已创建 ${data.length} 个分拣格`)
    } catch (e) { next(e) }
  },
)

// PATCH /api/sorting-bins/:id — 修改备注
router.patch('/:id',
  vBody(z.object({ remark: z.string().max(200).optional() })),
  async (req, res, next) => {
    try {
      await svc.update(+req.params.id, req.body)
      return successResponse(res, null, '已更新')
    } catch (e) { next(e) }
  },
)

// POST /api/sorting-bins/:id/release — 管理员强制释放
router.post('/:id/release', async (req, res, next) => {
  try {
    await svc.forceRelease(+req.params.id)
    return successResponse(res, null, '分拣格已释放')
  } catch (e) { next(e) }
})

// DELETE /api/sorting-bins/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await svc.remove(+req.params.id)
    return successResponse(res, null, '已删除')
  } catch (e) { next(e) }
})

module.exports = router
