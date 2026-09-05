/**
 * codeGenerator — 极序 Flow 统一编码生成器
 *
 * 三种编码类型：
 *
 *  1. 主数据编码（累计流水）：PREFIX + 6位数字
 *     示例：C000001 / S000001 / P000001 / H000001 / G000001
 *     规则：全局最大值 +1，不重置，软删除记录仍计入序号
 *
 *  2. 业务单据编码（日期流水）：PREFIX + YYYYMMDD + 3位序号
 *     示例：SO20260308001 / PO20260308001 / WT20260308001
 *     规则：每天独立计数，当天 001 起始
 *
 *  3. 容器条码（累计流水）：I/B + 6位数字
 *     示例：I000001 / B000001
 *     规则：全局最大值 +1，不重置
 *
 * 所有函数接受 conn（数据库连接或连接池），
 * 在调用方的事务内执行，由调用方的 UNIQUE 约束兜底防重。
 */

/**
 * 解析单据/主数据编码前缀（单号规则自定义）。
 *
 * 查询 sys_settings 表 `code_prefix_${prefix.toLowerCase()}` 键：
 *  - 有配置（非空值）→ 用配置值覆盖默认前缀（值本身不追加日期段，仅替换前缀字母段）；
 *  - 无配置或值为空 → 用原前缀，行为与历史完全一致。
 *
 * 设置项由迁移 seed（215_add_doc_code_prefix_settings.sql）预置，用户在「系统设置」
 * 页直接编辑；sys_settings.value 非空即生效。逐次查询（不缓存）保证改完设置立即可见，
 * 代价是每次生成编号多一条只读查询——单据创建是低频操作，可接受。
 *
 * 说明：仅业务单据编码（generateDailyCode）受前缀覆盖；主数据编码（generateMasterCode）
 * 不接入（历史设置值带连字符与累计流水格式不匹配，见 generateMasterCode 注释）。
 * 客户/供应商/商品编号前缀由 011 迁移的 code_prefix_customer/supplier/product 管理，
 * 但当前格式仍固定为「前缀 + 6 位数字」，与本文档 1 的规则一致。
 *
 * 同前缀多单据冲突处理：默认前缀 SC 被盘点单（inventory_checks）与客户对账单
 * （reconciliation_statements type=2）共用，若共用 `code_prefix_sc` 会互相污染。
 * 用 PREFIX_KEY_OVERRIDES 按 (table, prefix) 精确路由到独立设置键；其余单据走通用键。
 *
 * @param {object} conn   - mysql2 连接或连接池（与调用方同连接，事务内读取）
 * @param {string} prefix - 默认前缀，如 'SO'、'PO'
 * @param {string} [table] - 数据表名，用于同前缀冲突时的精确路由
 * @returns {Promise<string>} - 实际生效的前缀
 */
const PREFIX_KEY_OVERRIDES = {
  'reconciliation_statements:SC': 'code_prefix_scstmt',
}

async function resolvePrefix(conn, prefix, table = '') {
  const upper = String(prefix).toUpperCase()
  const key = PREFIX_KEY_OVERRIDES[`${table}:${upper}`] || `code_prefix_${upper.toLowerCase()}`
  try {
    const [rows] = await conn.query('SELECT value FROM sys_settings WHERE key_name = ?', [key])
    const value = rows?.[0]?.value
    const resolved = value != null ? String(value).trim() : ''
    return resolved || prefix
  } catch (_e) {
    // 表缺失等异常时回退默认前缀，绝不因设置查询失败阻断单据创建
    return prefix
  }
}

/**
 * 生成主数据编码（累计）。
 *
 * 注意：主数据编码（客户/供应商/商品等）刻意不接入 resolvePrefix 前缀覆盖——
 * 迁移 011 预置的 code_prefix_customer/supplier/product 历史值带连字符（'CUS-'），
 * 与累计流水格式（无连字符 6 位数字）不匹配，接入会让新老编号格式分叉。
 * 前缀自定义仅覆盖业务单据编码（generateDailyCode），见 resolvePrefix。
 *
 * @param {object} conn        - mysql2 连接或连接池
 * @param {string} prefix      - 编码前缀，如 'C'、'P'
 * @param {string} table       - 数据表名，如 'sale_customers'
 * @param {string} [codeField] - 编码列名，默认 'code'
 * @returns {Promise<string>}  - 如 'CUS000001'
 */
async function generateMasterCode(conn, prefix, table, codeField = 'code') {
  const prefixLen = prefix.length
  const [[{ maxNum }]] = await conn.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(\`${codeField}\`, ?) AS UNSIGNED)), 0) AS maxNum
     FROM \`${table}\`
     WHERE \`${codeField}\` REGEXP CONCAT('^', ?, '[0-9]{6}$')`,
    [prefixLen + 1, prefix],
  )
  return `${prefix}${String(Number(maxNum) + 1).padStart(6, '0')}`
}

const { beijingTodayYmd } = require('./backendTime')

/**
 * 生成业务单据编码（日期流水）。
 *
 * 使用 UPDATE + LAST_INSERT_ID 原子递增，避免 COUNT 并发竞争。
 *
 * @param {object} conn        - mysql2 连接（建议在事务内调用以保证读写一致性）
 * @param {string} prefix      - 单据前缀，如 'SO'、'PO'
 * @param {string} table       - 数据表名
 * @param {string} codeField   - 编码列名，如 'order_no'
 * @returns {Promise<string>}  - 如 'SO20260308001'
 */
async function generateDailyCode(conn, prefix, table, codeField) {
  const resolvedPrefix = await resolvePrefix(conn, prefix, table)
  // 北京时间的 YYYYMMDD（显式 backendTime：单号按业务日期分天，不依赖进程 TZ）
  const dateStr = beijingTodayYmd().replace(/-/g, '')
  const todayPrefix = `${resolvedPrefix}${dateStr}`
  const seqKey = `${table}:${codeField}:${dateStr}`

  // LAST_INSERT_ID 依赖连接一致性；若传入的是 pool 则需要获取专用连接
  const isPool = typeof conn.getConnection === 'function'
  let dedicated = null
  const db = isPool ? (dedicated = await conn.getConnection()) : conn
  try {
    // 先确保行存在（幂等），再用 UPDATE + LAST_INSERT_ID 原子递增
    await db.query(
      `INSERT INTO daily_sequences (seq_key, seq_value) VALUES (?, 0)
       ON DUPLICATE KEY UPDATE seq_key = seq_key`,
      [seqKey],
    )
    await db.query(
      `UPDATE daily_sequences SET seq_value = LAST_INSERT_ID(seq_value + 1) WHERE seq_key = ?`,
      [seqKey],
    )
    const [[{ seq }]] = await db.query('SELECT LAST_INSERT_ID() AS seq')
    return `${todayPrefix}${String(seq).padStart(3, '0')}`
  } finally {
    if (dedicated) dedicated.release()
  }
}

/**
 * 生成容器条码（累计，全局不归零）。
 *
 * 用 daily_sequences 表做原子自增（seq_key 不带日期，语义上是"全局累计流水"，
 * 表结构和字段类型都能承载，详见 087 迁移），避免旧版 SELECT MAX(...)+1 方案
 * 在并发收货下的撞号风险（无 FOR UPDATE，两个事务可能读到同一个 MAX 值）。
 * seq_key 对应的行首次生成时，用现有 inventory_containers 里的最大编号播种，
 * 避免和历史数据的 barcode 唯一键冲突；之后只走原子 UPDATE，不再扫描大表。
 *
 * @param {object} conn  - mysql2 连接或连接池
 * @param {'I'|'B'} [prefix='I'] - I=库存条码，B=塑料盒条码
 * @returns {Promise<string>}  - 如 'I000001' / 'B000001'
 */
async function generateContainerCode(conn, prefix = 'I') {
  const upper = String(prefix || 'I').toUpperCase()
  const seqKey = `inventory_containers:barcode:${upper}`

  const isPool = typeof conn.getConnection === 'function'
  let dedicated = null
  const db = isPool ? (dedicated = await conn.getConnection()) : conn
  try {
    // 0 表示尚未播种。先插入占位行，再锁定递增；已初始化路径不读取容器表。
    // 重复键走 UPDATE 获取排他锁，避免 INSERT IGNORE 共享锁并发升级死锁。
    await db.query(
      'INSERT INTO daily_sequences (seq_key, seq_value) VALUES (?, 0) ON DUPLICATE KEY UPDATE seq_key = seq_key',
      [seqKey],
    )
    const [advanced] = await db.query(
      'UPDATE daily_sequences SET seq_value = LAST_INSERT_ID(seq_value + 1) WHERE seq_key = ? AND seq_value > 0',
      [seqKey],
    )
    if (!advanced.affectedRows) {
      const [[{ maxNum: seedMax }]] = upper === 'B'
        ? await db.query(
            `SELECT COALESCE(MAX(CAST(SUBSTRING(barcode, 2) AS UNSIGNED)), 0) AS maxNum
             FROM inventory_containers WHERE barcode LIKE 'B%' FOR UPDATE`,
          )
        : await db.query(
            `SELECT COALESCE(MAX(CAST(
                CASE
                  WHEN barcode LIKE 'I%' THEN SUBSTRING(barcode, 2)
                  WHEN barcode LIKE 'CNT%' THEN SUBSTRING(barcode, 4)
                  ELSE NULL
                END AS UNSIGNED
              )), 0) AS maxNum
             FROM inventory_containers WHERE barcode LIKE 'I%' OR barcode LIKE 'CNT%' FOR UPDATE`,
          )

      // 多个首次调用可能一起读到种子；GREATEST 保留先完成者的递增结果，不回退序列。
      await db.query(
        'UPDATE daily_sequences SET seq_value = LAST_INSERT_ID(GREATEST(seq_value, ?) + 1) WHERE seq_key = ?',
        [seedMax, seqKey],
      )
    }
    const [[{ seq }]] = await db.query('SELECT LAST_INSERT_ID() AS seq')
    return `${upper}${String(seq).padStart(6, '0')}`
  } finally {
    if (dedicated) dedicated.release()
  }
}

module.exports = { generateMasterCode, generateDailyCode, generateContainerCode, resolvePrefix }
