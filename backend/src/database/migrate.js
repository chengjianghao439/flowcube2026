/**
 * 数据库迁移运行器
 * 启动时自动检查并执行未运行的 .sql 文件，使部署无需手动建表
 */
const fs = require('fs')
const path = require('path')
const mysql2 = require('mysql2/promise')

async function runMigrations() {
  const cfg = {
    host:     process.env.DB_HOST     || '127.0.0.1',
    port:     Number(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'flowcube',
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

    // ── 货架主数据表（供 051 迁移与业务查询依赖）──────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS warehouse_racks (
        id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        warehouse_id BIGINT UNSIGNED NOT NULL              COMMENT '所属仓库',
        zone         VARCHAR(20)     NOT NULL DEFAULT ''   COMMENT '库区，如 A / B',
        code         VARCHAR(50)     NOT NULL              COMMENT '货架编码，如 A01',
        name         VARCHAR(100)    NOT NULL DEFAULT ''   COMMENT '货架名称',
        max_levels   TINYINT UNSIGNED NOT NULL DEFAULT 5   COMMENT '最大层数',
        max_positions TINYINT UNSIGNED NOT NULL DEFAULT 10 COMMENT '每层最大位数',
        status       TINYINT(1)      NOT NULL DEFAULT 1    COMMENT '1=启用 2=停用',
        remark       VARCHAR(200)    DEFAULT NULL,
        deleted_at   DATETIME        DEFAULT NULL,
        created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_rack_code (warehouse_id, code),
        INDEX idx_rack_warehouse (warehouse_id),
        INDEX idx_rack_zone (warehouse_id, zone)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='货架主数据'
    `)

    // 动态 ALTER TABLE：为 sale_customers 添加价格表字段
    await safeAlter(conn, `ALTER TABLE sale_customers ADD COLUMN price_list_id BIGINT UNSIGNED DEFAULT NULL AFTER is_active`)
    await safeAlter(conn, `ALTER TABLE sale_customers ADD COLUMN price_list_name VARCHAR(100) DEFAULT NULL AFTER price_list_id`)
    // 为 sale_orders 添加仓库任务关联字段
    await safeAlter(conn, `ALTER TABLE sale_orders ADD COLUMN task_id BIGINT UNSIGNED DEFAULT NULL AFTER remark`)
    await safeAlter(conn, `ALTER TABLE sale_orders ADD COLUMN task_no VARCHAR(30) DEFAULT NULL AFTER task_id`)
    // 为 sale_orders 添加发货/物流字段
    await safeAlter(conn, `ALTER TABLE sale_orders ADD COLUMN carrier VARCHAR(100) DEFAULT NULL COMMENT '承运商' AFTER task_no`)
    await safeAlter(conn, `ALTER TABLE sale_orders ADD COLUMN freight_type TINYINT DEFAULT NULL COMMENT '运费方式 1寄付 2到付 3第三方付' AFTER carrier`)
    await safeAlter(conn, `ALTER TABLE sale_orders ADD COLUMN receiver_name VARCHAR(100) DEFAULT NULL COMMENT '收货人' AFTER freight_type`)
    await safeAlter(conn, `ALTER TABLE sale_orders ADD COLUMN receiver_phone VARCHAR(50) DEFAULT NULL COMMENT '收货电话' AFTER receiver_name`)
    await safeAlter(conn, `ALTER TABLE sale_orders ADD COLUMN receiver_address VARCHAR(255) DEFAULT NULL COMMENT '收货地址' AFTER receiver_phone`)

    // 为 inventory_stock 添加库存预占字段
    await safeAlter(conn, `ALTER TABLE inventory_stock ADD COLUMN reserved DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '已预占数量' AFTER quantity`)
    // 为 inventory_stock 添加最近更新时间（由 MySQL ON UPDATE 自动维护，库存总览页使用）
    await safeAlter(conn, `ALTER TABLE inventory_stock ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最近更新时间' AFTER reserved`)

    // 为 inventory_logs 添加引擎可追溯字段
    // move_type: 1采购入库 2销售出库 3盘点 4调拨出 5调拨入 6采购退货出库 7销售退货入库 8仓库任务出库
    await safeAlter(conn, `ALTER TABLE inventory_logs ADD COLUMN move_type TINYINT UNSIGNED DEFAULT NULL AFTER id`)
    await safeAlter(conn, `ALTER TABLE inventory_logs ADD COLUMN ref_type VARCHAR(30) DEFAULT NULL AFTER operator_name`)
    await safeAlter(conn, `ALTER TABLE inventory_logs ADD COLUMN ref_id BIGINT UNSIGNED DEFAULT NULL AFTER ref_type`)
    await safeAlter(conn, `ALTER TABLE inventory_logs ADD COLUMN ref_no VARCHAR(30) DEFAULT NULL AFTER ref_id`)

    // ── product_categories 树形结构升级 ──────────────────────────────────────
    await safeAlter(conn, `ALTER TABLE product_categories ADD COLUMN code VARCHAR(50) DEFAULT NULL COMMENT '分类编码' AFTER name`)
    await safeAlter(conn, `ALTER TABLE product_categories ADD COLUMN parent_id BIGINT UNSIGNED DEFAULT NULL COMMENT '父分类ID' AFTER id`)
    await safeAlter(conn, `ALTER TABLE product_categories ADD COLUMN level TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '层级 1-4' AFTER parent_id`)
    await safeAlter(conn, `ALTER TABLE product_categories ADD COLUMN sort_order INT NOT NULL DEFAULT 0 COMMENT '排序' AFTER level`)
    await safeAlter(conn, `ALTER TABLE product_categories ADD COLUMN status TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1启用 0停用' AFTER sort_order`)
    await safeAlter(conn, `ALTER TABLE product_categories ADD COLUMN path VARCHAR(500) NOT NULL DEFAULT '' COMMENT '祖先路径 如 1/2/3' AFTER status`)
    await safeAlter(conn, `ALTER TABLE product_categories ADD COLUMN remark VARCHAR(500) DEFAULT NULL AFTER path`)
    await safeAlter(conn, `ALTER TABLE product_categories ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER remark`)
    await safeAlter(conn, `ALTER TABLE product_categories ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at`)

    // 为 sale_orders 添加承运商外键
    await safeAlter(conn, `ALTER TABLE sale_orders ADD COLUMN carrier_id BIGINT UNSIGNED DEFAULT NULL COMMENT '承运商ID' AFTER carrier`)

    // 为 carriers 添加承运商类型字段
    await safeAlter(conn, `ALTER TABLE carriers ADD COLUMN type VARCHAR(20) NOT NULL DEFAULT 'express' COMMENT '承运商类型：delivery=送货 express=快递 freight=快运 logistics=物流' AFTER name`)

    // 为 inventory_containers 添加库位关联
    await safeAlter(conn, `ALTER TABLE inventory_containers ADD COLUMN location_id BIGINT UNSIGNED DEFAULT NULL COMMENT '库位ID' AFTER warehouse_id`)
    await safeAlter(conn, `ALTER TABLE inventory_containers ADD INDEX idx_container_location (location_id)`)

    // 为 inventory_containers 添加任务锁定字段
    await safeAlter(conn, `ALTER TABLE inventory_containers ADD COLUMN locked_by_task_id BIGINT UNSIGNED DEFAULT NULL COMMENT '锁定该容器的仓库任务ID' AFTER location_id`)
    await safeAlter(conn, `ALTER TABLE inventory_containers ADD COLUMN locked_at DATETIME DEFAULT NULL COMMENT '锁定时间' AFTER locked_by_task_id`)
    await safeAlter(conn, `ALTER TABLE inventory_containers ADD INDEX idx_container_locked (locked_by_task_id)`)

    // ── 字段长度规范化（三端统一：DB / 后端 / 前端）──────────────────────────
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

    // 为 picking_waves 添加优先级字段（表由 025 创建，需在 SQL 执行后）
    await safeAlter(conn, `ALTER TABLE picking_waves ADD COLUMN priority TINYINT UNSIGNED NOT NULL DEFAULT 2 COMMENT '1紧急 2普通 3低' AFTER status`)

    // 为 warehouse_tasks 添加分拣格关联字段（030 迁移支持）
    await safeAlter(conn, `ALTER TABLE warehouse_tasks ADD COLUMN sorting_bin_id BIGINT UNSIGNED DEFAULT NULL COMMENT '分配的分拣格ID' AFTER remark`)
    await safeAlter(conn, `ALTER TABLE warehouse_tasks ADD COLUMN sorting_bin_code VARCHAR(20) DEFAULT NULL COMMENT '分拣格编号' AFTER sorting_bin_id`)

    // ── 货架主数据表（电脑端管理，库位由 PDA 上架时自动生成）────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS warehouse_racks (
        id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        warehouse_id BIGINT UNSIGNED NOT NULL              COMMENT '所属仓库',
        zone         VARCHAR(20)     NOT NULL DEFAULT ''   COMMENT '库区，如 A / B',
        code         VARCHAR(50)     NOT NULL              COMMENT '货架编码，如 A01',
        name         VARCHAR(100)    NOT NULL DEFAULT ''   COMMENT '货架名称',
        max_levels   TINYINT UNSIGNED NOT NULL DEFAULT 5   COMMENT '最大层数',
        max_positions TINYINT UNSIGNED NOT NULL DEFAULT 10 COMMENT '每层最大位数',
        status       TINYINT(1)      NOT NULL DEFAULT 1    COMMENT '1=启用 2=停用',
        remark       VARCHAR(200)    DEFAULT NULL,
        deleted_at   DATETIME        DEFAULT NULL,
        created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_rack_code (warehouse_id, code),
        INDEX idx_rack_warehouse (warehouse_id),
        INDEX idx_rack_zone (warehouse_id, zone)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='货架主数据'
    `)

    // ── 种入默认打印模板（仅在该类型无模板时执行）──────────────────────────
    await seedDefaultPrintTemplates(conn)

  } finally {
    await conn.end()
  }
}

/**
 * 为每种单据类型种入一个开箱即用的默认打印模板。
 * 布局坐标单位为 mm，与编辑器画布一致。
 */
async function seedDefaultPrintTemplates(conn) {
  const SEEDS = [
    {
      name:      '默认销售订单模板',
      type:      1,
      paperSize: 'A4',
      layout: {
        elements: [
          // ── 大标题 ──────────────────────────────────────────────────
          { id: 's_title',   type: 'title',   fieldKey: 'title',           label: '销售订单', x: 25,  y: 8,   width: 160, height: 10, fontSize: 18, fontWeight: 'bold',   textAlign: 'center', border: false },
          // ── 单据信息（右上角） ────────────────────────────────────────
          { id: 's_no',      type: 'text',    fieldKey: 'orderNo',         label: '单据编号', x: 110, y: 22,  width: 90,  height: 6,  fontSize: 9,  fontWeight: 'normal', textAlign: 'right',  border: false },
          { id: 's_date',    type: 'text',    fieldKey: 'orderDate',       label: '单据日期', x: 110, y: 30,  width: 90,  height: 6,  fontSize: 9,  fontWeight: 'normal', textAlign: 'right',  border: false },
          { id: 's_op',      type: 'text',    fieldKey: 'operator',        label: '经办人',   x: 110, y: 38,  width: 90,  height: 6,  fontSize: 9,  fontWeight: 'normal', textAlign: 'right',  border: false },
          // ── 客户 / 仓库（左侧） ──────────────────────────────────────
          { id: 's_cust',    type: 'text',    fieldKey: 'customerName',    label: '客户名称', x: 5,   y: 22,  width: 100, height: 6,  fontSize: 9,  fontWeight: 'normal', textAlign: 'left',   border: false },
          { id: 's_wh',      type: 'text',    fieldKey: 'warehouseName',   label: '仓库',     x: 5,   y: 30,  width: 100, height: 6,  fontSize: 9,  fontWeight: 'normal', textAlign: 'left',   border: false },
          // ── 分隔线 ───────────────────────────────────────────────────
          { id: 's_div1',    type: 'divider', fieldKey: 'divider',         label: '分隔线',   x: 5,   y: 47,  width: 198, height: 3,  fontSize: 10, fontWeight: 'normal', textAlign: 'left',   border: false },
          // ── 收货信息 ─────────────────────────────────────────────────
          { id: 's_rname',   type: 'text',    fieldKey: 'receiverName',    label: '收货人',   x: 5,   y: 52,  width: 50,  height: 6,  fontSize: 9,  fontWeight: 'normal', textAlign: 'left',   border: false },
          { id: 's_rphone',  type: 'text',    fieldKey: 'receiverPhone',   label: '联系电话', x: 60,  y: 52,  width: 70,  height: 6,  fontSize: 9,  fontWeight: 'normal', textAlign: 'left',   border: false },
          { id: 's_raddr',   type: 'text',    fieldKey: 'receiverAddress', label: '收货地址', x: 5,   y: 60,  width: 198, height: 6,  fontSize: 9,  fontWeight: 'normal', textAlign: 'left',   border: false },
          // ── 分隔线 ───────────────────────────────────────────────────
          { id: 's_div2',    type: 'divider', fieldKey: 'divider',         label: '分隔线',   x: 5,   y: 69,  width: 198, height: 3,  fontSize: 10, fontWeight: 'normal', textAlign: 'left',   border: false },
          // ── 商品明细表 ───────────────────────────────────────────────
          { id: 's_table',   type: 'table',   fieldKey: 'itemsTable',      label: '商品明细', x: 5,   y: 74,  width: 198, height: 100, fontSize: 9, fontWeight: 'normal', textAlign: 'left',   border: true,  tableColumns: ['code', 'name', 'unit', 'qty', 'price', 'amount'] },
          // ── 金额合计 ─────────────────────────────────────────────────
          { id: 's_total',   type: 'text',    fieldKey: 'totalAmount',     label: '金额合计', x: 120, y: 178, width: 83,  height: 8,  fontSize: 12, fontWeight: 'bold',   textAlign: 'right',  border: false },
          // ── 备注 ─────────────────────────────────────────────────────
          { id: 's_remark',  type: 'text',    fieldKey: 'remark',          label: '备注',     x: 5,   y: 190, width: 198, height: 14, fontSize: 9,  fontWeight: 'normal', textAlign: 'left',   border: true  },
        ]
      },
    },
    {
      name:      '默认货架条码标签模板',
      type:      5,
      paperSize: 'thermal80',
      layout: {
        elements: [
          { id: 'lb5_bc', type: 'barcode', fieldKey: 'rack_barcode', label: '货架条码', x: 4, y: 4, width: 72, height: 14, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
          { id: 'lb5_rc', type: 'text', fieldKey: 'rack_code', label: '货架编码', x: 4, y: 22, width: 72, height: 7, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
          { id: 'lb5_z', type: 'text', fieldKey: 'zone', label: '库区', x: 4, y: 32, width: 72, height: 7, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: false },
          { id: 'lb5_n', type: 'text', fieldKey: 'name', label: '名称', x: 4, y: 41, width: 72, height: 14, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: false },
        ],
      },
    },
    {
      name:      '默认库存条码标签模板',
      type:      6,
      paperSize: 'thermal80',
      layout: {
        elements: [
          { id: 'lb6_bc', type: 'barcode', fieldKey: 'container_code', label: '库存条码', x: 4, y: 4, width: 72, height: 14, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
          { id: 'lb6_pn', type: 'text', fieldKey: 'product_name', label: '品名', x: 4, y: 22, width: 72, height: 10, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
          { id: 'lb6_q', type: 'text', fieldKey: 'qty', label: '数量', x: 4, y: 36, width: 72, height: 7, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
        ],
      },
    },
    {
      name:      '默认物流条码标签模板',
      type:      7,
      paperSize: 'thermal80',
      layout: {
        elements: [
          { id: 'lb7_bc', type: 'barcode', fieldKey: 'box_code', label: '物流条码', x: 4, y: 4, width: 72, height: 14, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
          { id: 'lb7_tn', type: 'text', fieldKey: 'task_no', label: '任务号', x: 4, y: 22, width: 72, height: 7, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
          { id: 'lb7_cn', type: 'text', fieldKey: 'customer_name', label: '客户', x: 4, y: 32, width: 72, height: 8, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: false },
          { id: 'lb7_sm', type: 'text', fieldKey: 'summary', label: '摘要', x: 4, y: 43, width: 72, height: 14, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: false },
        ],
      },
    },
    {
      name:      '默认产品条码标签模板',
      type:      8,
      paperSize: 'thermal80',
      layout: {
        elements: [
          { id: 'lb8_bc', type: 'barcode', fieldKey: 'product_code', label: '产品条码', x: 4, y: 4, width: 72, height: 14, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
          { id: 'lb8_pn', type: 'text', fieldKey: 'product_name', label: '产品名称', x: 4, y: 22, width: 72, height: 10, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
          { id: 'lb8_sp', type: 'text', fieldKey: 'spec', label: '规格', x: 4, y: 36, width: 72, height: 7, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: false },
        ],
      },
    },
    {
      name:      '默认库存标签模板',
      type:      9,
      paperSize: 'thermal80',
      layout: {
        elements: [
          { id: 'lb9_bc', type: 'barcode', fieldKey: 'sku', label: 'SKU 条码', x: 4, y: 4, width: 72, height: 14, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
          { id: 'lb9_pn', type: 'text', fieldKey: 'product_name', label: '品名', x: 4, y: 22, width: 72, height: 10, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
          { id: 'lb9_q', type: 'text', fieldKey: 'qty', label: '数量', x: 4, y: 36, width: 36, height: 7, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: false },
          { id: 'lb9_wh', type: 'text', fieldKey: 'warehouse', label: '仓库', x: 42, y: 36, width: 34, height: 7, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: false },
        ],
      },
    },
  ]

  for (const seed of SEEDS) {
    const [[row]] = await conn.query(
      'SELECT id FROM print_templates WHERE type=? AND name=? LIMIT 1',
      [seed.type, seed.name]
    )
    if (row) continue   // 已存在则跳过

    await conn.query(
      `INSERT INTO print_templates (name, type, paper_size, layout_json, is_default) VALUES (?,?,?,?,1)`,
      [seed.name, seed.type, seed.paperSize, JSON.stringify(seed.layout)]
    )
    console.log(`[Migrate] ✓ 种入默认打印模板：${seed.name}`)
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
