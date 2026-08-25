const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')

async function getAll() {
  const [rows] = await pool.query('SELECT key_name, value, label, type, remark FROM sys_settings ORDER BY id ASC')
  const map = {}
  rows.forEach(r => { map[r.key_name] = { value: r.value, label: r.label, type: r.type, remark: r.remark } })
  // company_logo 的 value 是 base64 data URL（可达 ~2.8MB），不进列表响应——
  // 前端读 logo 走专门的 /settings/logo（元数据）+ /settings/logo/image（图片流），
  // 这里把 value 置空只保留 meta，避免系统设置页一次拉动几 MB。
  const list = rows.map(r => (r.key_name === 'company_logo' ? { ...r, value: '' } : r))
  const mapSafe = {}
  Object.entries(map).forEach(([k, v]) => { mapSafe[k] = k === 'company_logo' ? { ...v, value: '' } : v })
  return { list, map: mapSafe }
}
/**
 * 批量保存设置项。必须在事务里：这是「一个表单一次提交」的语义，
 * 逐条裸更新时中途失败会存下半套设置——用户看到的是保存失败，实际前几项已经生效了。
 *
 * 安全（2026-08-22 加固）：key 白名单——只允许更新系统声明的设置键，
 * 防持 settings.update 权限者塞任意 key_name（如把审批阈值置 0 关闭审批）。
 * 白名单 = 当前 sys_settings 表里已有的键；新增键需走迁移 seed。
 * 2026-08-25 再收紧：type='image'/'timestamp' 的键（公司 Logo）禁止走本批量接口——
 * 它们有独立的校验链路（POST /settings/logo 的魔术字节/SVG 黑名单校验），
 * 且基础参数表单一次提交会把整组键（含 logo 键的空值）打进来，不拦会误清 Logo。
 */
async function updateMany(updates) {
  // updates: { key_name: new_value, ... }
  const entries = Object.entries(updates || {})
  if (!entries.length) return
  const [knownRows] = await pool.query("SELECT key_name, type FROM sys_settings")
  const knownKeys = new Set(knownRows.map(r => r.key_name))
  const specialTypes = new Set(knownRows.filter(r => r.type === 'image' || r.type === 'timestamp').map(r => r.key_name))
  for (const [key] of entries) {
    if (!knownKeys.has(key)) {
      throw new AppError(`未知设置项：${key}`, 400, 'SETTINGS_KEY_NOT_ALLOWED')
    }
    if (specialTypes.has(key)) {
      throw new AppError(`设置项 ${key} 有独立上传/时间戳管理，请勿通过此处修改`, 400, 'SETTINGS_KEY_SPECIAL')
    }
  }
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    for (const [key, value] of entries) {
      await conn.query('UPDATE sys_settings SET value=? WHERE key_name=?', [value, key])
    }
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

// ─── 品牌 Logo ────────────────────────────────────────────────────────────

// base64 上限：前端限制 2MB 文件 → base64 ≈ 2.8MB + data URL 前缀，留 2 倍余量
const LOGO_DATA_URL_MAX_LENGTH = 12 * 1024 * 1024

/**
 * 读取公司 Logo 元数据（公开接口，登录页/PDA 未登录也需展示）。
 *
 * 返回 { url, updatedAt }：
 * - url 指向 /api/settings/logo/image（v= 时间戳参数随之变化）；
 * - 未上传（空值）返回 url:''，前端回退默认图标+文字。
 * 图片二进制由 getLogoImage 输出；本端点只给 <img src> 用的 URL 与 React Query 的查询值。
 */
async function getLogo() {
  const [rows] = await pool.query(
    "SELECT key_name, value FROM sys_settings WHERE key_name IN ('company_logo','company_logo_updated_at')"
  )
  const map = {}
  rows.forEach(r => { map[r.key_name] = r.value })
  const dataUrl = map.company_logo || ''
  const updatedAt = map.company_logo_updated_at || null
  if (!dataUrl) return { url: '', updatedAt }
  const v = updatedAt ? encodeURIComponent(updatedAt) : ''
  return { url: `/api/settings/logo/image?v=${v}`, updatedAt }
}

/**
 * 返回 Logo 的真实二进制 response（不挂 authMiddleware，见 routes 注释）。
 * 前端 <img> 直接 src 本端点；二进制不能走 successResponse 信封。
 */
async function getLogoImage() {
  const [rows] = await pool.query("SELECT value FROM sys_settings WHERE key_name='company_logo'")
  const dataUrl = rows[0]?.value || ''
  return dataUrl
}

/**
 * 保存公司 Logo（data URL）。
 *
 * 校验与 key 白名单不同：本函数只接受「已通过 controller 图片校验」的 data URL，
 * 这里再兜一道格式与长度防线（service 是 SQL 与业务规则的唯一入口，不能信任入参）。
 * 连带更新 updated_at 键（YYYYMMDDHHMMSS 串），使图片 URL 的 v= 参数变化。
 */
async function updateLogo(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    throw new AppError('Logo 数据格式不正确', 400, 'LOGO_INVALID')
  }
  if (dataUrl.length > LOGO_DATA_URL_MAX_LENGTH) {
    throw new AppError('Logo 文件过大', 400, 'LOGO_TOO_LARGE')
  }
  const [rows] = await pool.query("SELECT key_name FROM sys_settings WHERE key_name='company_logo'")
  if (!rows.length) {
    // 迁移 218 会 seed 该键；此处兜底防「迁移未跑而代码已上线」的部署竞态
    throw new AppError('Logo 设置项不存在：请先执行数据库迁移', 500, 'LOGO_SETTING_MISSING')
  }
  const [tsRows] = await pool.query("SELECT key_name FROM sys_settings WHERE key_name='company_logo_updated_at'")
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14) // YYYYMMDDHHMMSS
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('UPDATE sys_settings SET value=? WHERE key_name=?', [dataUrl, 'company_logo'])
    await conn.query('UPDATE sys_settings SET value=? WHERE key_name=?', [
      tsRows.length ? timestamp : '',
      'company_logo_updated_at',
    ])
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

module.exports = { getAll, updateMany, getLogo, getLogoImage, updateLogo }
