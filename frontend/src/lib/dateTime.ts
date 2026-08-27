/**
 * 日期时间展示工具 —— 全站唯一的时间显示入口（261+ 调用点：DataTable 列、详情页、卡片、筛选默认值）。
 *
 * 【时区强制 2026-08-27】所有展示与「今天」计算一律强制北京时间 +08:00，不依赖运行宿主时区：
 *   - 后端连接池 timezone=+08:00 把 DB DATETIME 解析成「北京时刻」的 JS Date（时间轴正确）；
 *   - 但「用本地字段取年月日时分」（getFullYear/getHours）在宿主时区 ≠ +08 时（如美西、UTC 容器、手机改时区）
 *     就会输出错位的字段值。因此统一用 +8h 偏移 + getUTC* 字段法：
 *        beijingFields(date) = getUTC*(date + 8h)
 *     无论宿主时区是什么，取出的都是北京字面量。新增时间显示一律经这里，不要直接 getFullYear/getHours。
 */

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * 把未知值规整为 JS Date（时间轴语义 = “绝对时刻”）：
 *   - Date 实例：原样（时间轴已确定）；
 *   - 数字：毫秒时间戳；
 *   - 无时区后缀的字符串（'YYYY-MM-DD HH:mm:ss'、'YYYY-MM-DD'）：按北京时间 +08:00 解析——
 *     后端在 timezone=+08:00 下把这些字面量原样写库、再解析回「北京时刻」的 Date，前端补上同一偏移，
 *     解析出的绝对时刻与后端语义一致；若交给原生 parse 则会按宿主时区解释，时区错位。
 *   - 带 Z 或 ±HH:MM 后缀的字符串：直接 parse（自含偏移，绝对时刻确定）。
 */
function toDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value)
  const str = String(value)
  const hasExplicitZone = /(Z|[+-]\d{2}:?\d{2})$/.test(str.trim())
  if (!hasExplicitZone) {
    // 后端输出的无时区字面量 —— 按北京偏移 +08:00 解释（V8 内建解析在部分 webview
    // 对不同格式的默认时区解释不一致，这里显式统一）。
    const m = str.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/)
    if (m) {
      // 字段先按 UTC 拼装，再 −8h 得到该北京时刻的绝对时间（显示端 beijingFields 会 +8h 展示）
      const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0))
      return new Date(ms - 8 * 3600 * 1000)
    }
  }
  const date = new Date(str)
  return Number.isNaN(date.getTime()) ? null : date
}

/** 北京时间字段（+8h 偏移 + UTC 字段法，不依赖宿主时区） */
function beijingFields(date: Date): { y: number; mo: number; d: number; h: number; mi: number } {
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000)
  return {
    y: shifted.getUTCFullYear(),
    mo: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    mi: shifted.getUTCMinutes(),
  }
}

export function formatDisplayDateTime(value: unknown, fallback = '—'): string {
  const date = toDate(value)
  if (!date) return fallback
  const f = beijingFields(date)
  return `${f.y}-${pad(f.mo)}-${pad(f.d)} ${pad(f.h)}:${pad(f.mi)}`
}

export function formatDisplayDate(value: unknown, fallback = '—'): string {
  const date = toDate(value)
  if (!date) return fallback
  const f = beijingFields(date)
  return `${f.y}-${pad(f.mo)}-${pad(f.d)}`
}

/** 北京时间的今天 YYYY-MM-DD（2026-08-21：查询弹窗默认时间统一用这个） */
export function todayYmd(): string {
  const f = beijingFields(new Date())
  return `${f.y}-${pad(f.mo)}-${pad(f.d)}`
}

/** 北京时间的当前小时（0-23）：PDA 首页问候语等按「北京几点」而不是宿主时区的场景 */
export function beijingHour(): number {
  return beijingFields(new Date()).h
}
