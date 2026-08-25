const { Router } = require('express')
const multer = require('multer')
const ctrl = require('./settings.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const AppError = require('../../utils/AppError')

const router = Router()

// Logo 图片上传：memoryStorage（校验后转 base64 写库，不落盘），2MB 上限
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
    if (allowed.includes(file.mimetype)) cb(null, true)
    else cb(new AppError('仅支持 PNG / JPEG / WebP / SVG 图片（≤2MB）', 400, 'LOGO_TYPE_UNSUPPORTED'))
  },
})

// multer 的错误必须转成 AppError 才走得到全局 errorHandler 的业务分支；
// 默认 MulterError / 普通 Error 会落「未知错误」→ 500。文件过大给用户明确 400 文案。
function handleLogoUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError('Logo 文件超过 2MB 上限', 400, 'LOGO_TOO_LARGE'))
      }
      return next(err) // AppError（fileFilter 拒绝）或未知错误原样上抛
    }
    next()
  })
}

// 公开路由：GET /api/settings/logo 与 /logo/image 必须放在 authMiddleware 之前——
// Logo 图片要在登录页（未登录）与 PDA（可能无 JWT）显示，<img> 又无法带 Bearer；
// Logo 非敏感信息（与 favicon 同类）。仅返回 Logo 元数据/图片字节，无任何业务数据。
// 注意：POST /logo（上传）不是公开接口，必须放在 authMiddleware 之后（见下方）。
router.get('/logo', ctrl.getLogo)
router.get('/logo/image', ctrl.getLogoImage)

router.use(authMiddleware)
router.get('/', requirePermission(PERMISSIONS.SETTINGS_VIEW), ctrl.getAll)
router.put('/', requirePermission(PERMISSIONS.SETTINGS_UPDATE), ctrl.update)
router.post('/logo', requirePermission(PERMISSIONS.SETTINGS_UPDATE), handleLogoUpload, ctrl.uploadLogo)
module.exports = router
