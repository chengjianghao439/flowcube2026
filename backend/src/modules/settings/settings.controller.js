const svc = require('./settings.service')
const { successResponse } = require('../../utils/response')
const AppError = require('../../utils/AppError')

const getAll = async(req,res,next)=>{ try{return successResponse(res,await svc.getAll(),'查询成功')}catch(e){next(e)} }
const update = async(req,res,next)=>{ try{await svc.updateMany(req.body);return successResponse(res,null,'保存成功')}catch(e){next(e)} }

// ─── 品牌 Logo ────────────────────────────────────────────────────────────

/**
 * 公开接口：返回当前公司 Logo 元数据（{ url, updatedAt }）。
 * 详情见 routes 注释：登录页/PDA 未登录态也要显示，故不挂 auth。
 * Logo 内容不敏感；前端 <img> 用返回的 url（v= 时间戳参数）渲染，天然破缓存。
 */
const getLogo = async (req, res, next) => {
  try {
    return successResponse(res, await svc.getLogo(), '查询成功')
  } catch (e) {
    next(e)
  }
}

/**
 * 公开接口：Logo 图片二进制流（前端 <img src> 直接加载）。
 * response 不走 successResponse 信封（那是 JSON 专用）；解码 data URL 输出图片字节。
 * 未上传时回 404，前端 onError 回退默认图标+文字。
 */
const getLogoImage = async (req, res, next) => {
  try {
    const dataUrl = await svc.getLogoImage()
    const m = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
    if (!m) {
      return res.status(404).json({ success: false, message: 'Logo 未设置', data: null, code: 'LOGO_NOT_SET' })
    }
    const body = Buffer.from(m[2], 'base64')
    res.set('Content-Type', m[1])
    // 浏览器行为区分：图标被 HTTP 缓存时（含 v 参数同 URL），GET 返回 304 省流量；
    // v 参数变化即全新 URL，正常回 200。
    res.set('Cache-Control', 'public, max-age=3600')
    return res.send(body)
  } catch (e) {
    next(e)
  }
}

// ── 图片内容安全校验（上传文件始终是风险点；前端 <img> 渲染不执行脚本，这里再兜一道）──

/** PNG/JPEG/WebP magic bytes 校验：防「mimetype 伪装成图片」的 HTML/脚本文件 */
function hasValidImageMagicBytes(buf, mime) {
  if (mime === 'image/png') return buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  if (mime === 'image/jpeg') return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  if (mime === 'image/webp') {
    // RIFF....WEBP
    return buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP'
  }
  return true // SVG 走文本黑名单校验
}

/**
 * SVG 是脚本载体：拒绝事件属性(on*=/javascript:)、<script>、外部引用
 * (<image>/<use> 指向 http(s) 的外部资源、<iframe>、<foreignObject>)。
 * 前端一律 <img> 渲染（不 innerHTML），脚本本不可执行，双保险。
 */
const SVG_BLACKLIST = [/<script/i, /\son[a-z]+\s*=/i, /\shref\s*=\s*["']?\s*(?:javascript:|https?:)/i, /<iframe/i, /<foreignObject/i, /<image[^>]*xlink:href/i]

function hasSafeSvg(content) {
  const s = content.toString('utf8', 0, Math.min(content.length, 512 * 1024))
  return !SVG_BLACKLIST.some(re => re.test(s))
}

const uploadLogo = async (req, res, next) => {
  try {
    if (!req.file) {
      throw new AppError('请选择要上传的图片文件', 400, 'LOGO_FILE_REQUIRED')
    }
    const { buffer, mimetype } = req.file
    if (!hasValidImageMagicBytes(buffer, mimetype)) {
      throw new AppError('文件内容与图片类型不符，上传被拒绝', 400, 'LOGO_MAGIC_BYTES_MISMATCH')
    }
    if (mimetype === 'image/svg+xml' && !hasSafeSvg(buffer)) {
      throw new AppError('SVG 内容包含脚本或外部引用，上传被拒绝', 400, 'LOGO_SVG_UNSAFE')
    }
    const dataUrl = `data:${mimetype};base64,${buffer.toString('base64')}`
    await svc.updateLogo(dataUrl)
    return successResponse(res, await svc.getLogo(), 'Logo 上传成功')
  } catch (e) {
    next(e)
  }
}

module.exports = { getAll, update, getLogo, getLogoImage, uploadLogo }
