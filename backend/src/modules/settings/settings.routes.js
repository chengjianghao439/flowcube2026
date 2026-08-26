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

// 桌面端（Electron file:// 页面，Origin: null）跨源 <img> 加载 Logo 图片流时，
// 会被 Helmet 默认的 Cross-Origin-Resource-Policy: same-origin 拦截——元数据接口
// 走 fetch/axios 还能靠 CORS 反射协商，图片 <img> 无协商余地，只能在 onError 回退
// 默认图标（症状：浏览器显示 Logo、桌面端不显示）。该接口公开且只回 Logo 图片
// 字节（无业务数据，本就可匿名访问），去掉 CORP 无安全损失；CORS 等其余头不变。
// 2026-08-26 修复「桌面端不显示 Logo，浏览器端正常」。
function allowCrossOriginEmbed(req, res, next) {
  res.removeHeader('Cross-Origin-Resource-Policy')
  next()
}

// 公开路由：GET /api/settings/logo 与 /logo/image 必须放在 authMiddleware 之前——
// 消费方（ERP 顶栏、设置页预览、单据打印模板）全部用 <img src> 渲染，<img> 无法带 Bearer 头；
// Logo 非敏感信息（与 favicon 同类）。仅返回 Logo 元数据/图片字节，无任何业务数据。
// 2026-08-26 双区品牌后：登录页/PDA 登录页/PDA 首页改显系统品牌（SystemBrand，内置图标），
// 不再消费公司 Logo——但上述 <img> 场景仍要求公开，豁免保持不变。
// 注意：POST /logo（上传）不是公开接口，必须放在 authMiddleware 之后（见下方）。
router.get('/logo', allowCrossOriginEmbed, ctrl.getLogo)
router.get('/logo/image', allowCrossOriginEmbed, ctrl.getLogoImage)

router.use(authMiddleware)
router.get('/', requirePermission(PERMISSIONS.SETTINGS_VIEW), ctrl.getAll)
router.put('/', requirePermission(PERMISSIONS.SETTINGS_UPDATE), ctrl.update)
router.post('/logo', requirePermission(PERMISSIONS.SETTINGS_UPDATE), handleLogoUpload, ctrl.uploadLogo)
module.exports = router
