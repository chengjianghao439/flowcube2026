/**
 * 数据库迁移运行器
 * 当前已改为显式执行：由 scripts/migrate.js 或 npm run migrate 触发。
 */
const fs = require('fs')
const path = require('path')
const mysql2 = require('mysql2/promise')
const { env } = require('../config/env')

async function runMigrations() {
  const cfg = {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    multipleStatements: true,
  }

  const conn = await mysql2.createConnection(cfg)
  try {
    // 先确保迁移记录表存在
    await conn.query(`
      CREATE TABLE IF NOT EXISTS db_migrations (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        filename VARCHAR(200) NOT NULL,
        executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id), UNIQUE KEY uk_file (filename)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    // 扫描 SQL 文件（排除 migrate.js 自身）
    const dir = path.join(__dirname)
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.sql'))
      .sort()

    // 先执行按编号排序的 SQL 建表迁移，保证基础表存在后再做增量 ALTER
    let ran = 0
    for (const file of files) {
      const [[existing]] = await conn.query(
        'SELECT id FROM db_migrations WHERE filename=?', [file]
      )
      if (existing) continue

      const sql = fs.readFileSync(path.join(dir, file), 'utf8')
      await conn.query(sql)
      await conn.query('INSERT INTO db_migrations (filename) VALUES (?)', [file])
      console.log(`[Migrate] ✓ ${file}`)
      ran++
    }

    if (ran === 0) {
      console.log('[Migrate] 所有迁移均已执行，无需更新')
    } else {
      console.log(`[Migrate] 完成，共执行 ${ran} 个迁移文件`)
    }

    // ── 字段长度规范化（三端统一：DB / 后端 / 前端）──────────────────────────
    // 这批 MODIFY 语句会触发表重建，启动期容易卡住；默认不在每次启动都执行。
    // 如需离线做一次性字段收口，可临时设置 RUN_SCHEMA_NORMALIZATION=1。
    if (String(process.env.RUN_SCHEMA_NORMALIZATION || '').trim() === '1') {
      // 客户表
      await safeModify(conn, `ALTER TABLE sale_customers MODIFY COLUMN name    VARCHAR(20) NOT NULL COMMENT '客户名称'`)
      await safeModify(conn, `ALTER TABLE sale_customers MODIFY COLUMN contact VARCHAR(5)  DEFAULT NULL COMMENT '联系人'`)
      await safeModify(conn, `ALTER TABLE sale_customers MODIFY COLUMN phone   VARCHAR(11) DEFAULT NULL COMMENT '联系电话'`)
      await safeModify(conn, `ALTER TABLE sale_customers MODIFY COLUMN address VARCHAR(30) DEFAULT NULL COMMENT '地址'`)
      await safeModify(conn, `ALTER TABLE sale_customers MODIFY COLUMN remark  VARCHAR(30) DEFAULT NULL COMMENT '备注'`)
      // 供应商表
      await safeModify(conn, `ALTER TABLE supply_suppliers MODIFY COLUMN name    VARCHAR(20) NOT NULL COMMENT '供应商名称'`)
      await safeModify(conn, `ALTER TABLE supply_suppliers MODIFY COLUMN contact VARCHAR(5)  DEFAULT NULL COMMENT '联系人'`)
      await safeModify(conn, `ALTER TABLE supply_suppliers MODIFY COLUMN phone   VARCHAR(11) DEFAULT NULL COMMENT '联系电话'`)
      await safeModify(conn, `ALTER TABLE supply_suppliers MODIFY COLUMN address VARCHAR(30) DEFAULT NULL COMMENT '地址'`)
      await safeModify(conn, `ALTER TABLE supply_suppliers MODIFY COLUMN remark  VARCHAR(30) DEFAULT NULL COMMENT '备注'`)
      // 承运商表
      await safeModify(conn, `ALTER TABLE carriers MODIFY COLUMN name    VARCHAR(10) NOT NULL COMMENT '承运商名称'`)
      await safeModify(conn, `ALTER TABLE carriers MODIFY COLUMN contact VARCHAR(5)  DEFAULT NULL COMMENT '联系人'`)
      await safeModify(conn, `ALTER TABLE carriers MODIFY COLUMN phone   VARCHAR(11) DEFAULT NULL COMMENT '联系电话'`)
      await safeModify(conn, `ALTER TABLE carriers MODIFY COLUMN remark  VARCHAR(30) DEFAULT NULL COMMENT '备注'`)
      // 商品表
      await safeAlter(conn, `ALTER TABLE product_items ADD COLUMN cost_price DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '成本价' AFTER barcode`)
      await safeModify(conn, `ALTER TABLE product_items MODIFY COLUMN spec   VARCHAR(5)  DEFAULT NULL COMMENT '规格型号'`)
      await safeModify(conn, `ALTER TABLE product_items MODIFY COLUMN remark VARCHAR(30) DEFAULT NULL COMMENT '备注'`)
      // 销售订单表
      await safeModify(conn, `ALTER TABLE sale_orders MODIFY COLUMN receiver_name    VARCHAR(5)   DEFAULT NULL COMMENT '收货人'`)
      await safeModify(conn, `ALTER TABLE sale_orders MODIFY COLUMN receiver_phone   VARCHAR(11)  DEFAULT NULL COMMENT '收货电话'`)
      await safeModify(conn, `ALTER TABLE sale_orders MODIFY COLUMN receiver_address VARCHAR(30)  DEFAULT NULL COMMENT '收货地址'`)
      await safeModify(conn, `ALTER TABLE sale_orders MODIFY COLUMN remark           VARCHAR(30)  DEFAULT NULL COMMENT '备注'`)
    }

  } finally {
    await conn.end()
  }
}

// 忽略"列已存在"(1060) 和"重复索引名"(1061) 错误
async function safeAlter(conn, sql) {
  try { await conn.query(sql) } catch (e) { if (e.errno !== 1060 && e.errno !== 1061) throw e }
}

// MODIFY COLUMN 长度缩短时如有超长数据会报 1406，直接忽略（开发阶段无历史数据）
async function safeModify(conn, sql) {
  try { await conn.query(sql) } catch (e) {
    if (e.errno === 1406) {
      console.warn(`[Migrate] ⚠ 跳过字段缩减（存在超长数据）: ${sql.substring(0, 80)}`)
    } else { throw e }
  }
}

module.exports = { runMigrations }
