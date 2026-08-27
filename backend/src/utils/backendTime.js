/**
 * backendTime — 后端「北京时间(+08:00)」取今天/格式化的统一入口
 *
 * 【时区固化 2026-08-27】业务时间的唯一权威时区是北京时间。全链一致后：
 *   - 容器/进程 TZ=Asia/Shanghai（Dockerfile.backend + docker-compose mysql/backend）
 *   - 连接池 timezone=+08:00（写）= 读取时按 +08:00 解析（mysql2 parseDateTime
 *     拼接 '+08:00'，Node Date 时间轴正确）
 *   - MySQL 服务端 system_time_zone = CST（TZ 环境变量），NOW()/CURRENT_TIMESTAMP
 *     默认值不再与连接池差 8 小时
 *
 * 注意：本工具返回的「今天」语义 = 北京时间当天；`new Date()` 本身时间轴正确
 * （UTC 时刻唯一），不随 TZ 变。场景：与 DB 按日期（DATE/DATETIME 字面量）
 * 匹配时，新增代码一律经这里取「北京今天」，不要直接 toISOString().slice(0,10)
 * 或裸 new Date().getFullYear()（除非 TZ 已定——但显式使用本工具可读性最好）。
 */

/** 北京时间的 YYYY-MM-DD（今天；offset+8 小时再取 UTC 字段，中国无夏令时偏移安全） */
function beijingTodayYmd(date = new Date()) {
  const d = new Date(date.getTime() + 8 * 3600 * 1000)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** 北京时间今天 + days 天的 YYYY-MM-DD */
function beijingYmdAddDays(days, base = new Date()) {
  const d = new Date(base.getTime() + days * 86400000)
  return beijingTodayYmd(d)
}

module.exports = { beijingTodayYmd, beijingYmdAddDays }
