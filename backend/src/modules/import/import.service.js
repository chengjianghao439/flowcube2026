const ExcelJS = require('exceljs')
const { Readable } = require('stream')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateMasterCode } = require('../../utils/codeGenerator')
const { MOVE_TYPE, writeInventoryLog } = require('../../engine/inventoryEngine')
const { adjustContainerStock, SOURCE_TYPE, getStockProjection } = require('../../engine/containerEngine')
const { normalizeSettlementType, normalizeTermsDays } = require('../../constants/settlementType')


async function buildWorkbookBuffer(sheets) {
  const workbook = new ExcelJS.Workbook()
  sheets.forEach(({ name, rows, widths }) => {
    const ws = workbook.addWorksheet(name)
    if (Array.isArray(widths)) ws.columns = widths.map((width) => ({ width }))
    rows.forEach((row) => ws.addRow(row))
  })
  return workbook.xlsx.writeBuffer()
}

/** 将 ExcelJS 单元格值归一化为基础类型；空单元格返回 ''，富文本/超链接/公式取其文本或结果。 */
function cellToValue(value) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('')
    if (value.result !== undefined) return value.result
    return ''
  }
  return value
}

/** 读取上传文件第一个工作表，返回以 0 为基准的二维数组（与旧的 sheet_to_json header:1 行为一致）。 */
async function readSheetRows(fileBuffer) {
  const workbook = new ExcelJS.Workbook()
  // xlsx 文件本质是 ZIP，以 "PK"(0x50 0x4B) 开头；否则按 CSV(UTF-8) 解析。
  const isXlsx = fileBuffer.length >= 2 && fileBuffer[0] === 0x50 && fileBuffer[1] === 0x4b
  if (isXlsx) {
    await workbook.xlsx.load(fileBuffer)
  } else {
    await workbook.csv.read(Readable.from(fileBuffer.toString('utf8')))
  }
  const sheet = workbook.worksheets[0]
  if (!sheet) return []
  const colCount = sheet.columnCount || 0
  const rows = []
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const out = []
    for (let c = 1; c <= colCount; c += 1) {
      out.push(cellToValue(row.getCell(c).value))
    }
    rows.push(out)
  })
  return rows
}

async function parseProductImportRows(fileBuffer) {
  const rows = await readSheetRows(fileBuffer)
  if (rows.length < 2) throw new AppError('文件无数据行', 400)
  return rows.slice(1).filter((row) => row[0] || row[1])
}

async function parseStockImportRows(fileBuffer) {
  const rows = await readSheetRows(fileBuffer)
  const dataRows = rows.slice(1).filter((row) => row[0])
  if (!dataRows.length) throw new AppError('文件无数据行', 400)
  return dataRows
}

async function buildProductTemplate() {
  const rows = [
    ['商品名称*', '单位*', '型号*', '颜色*', '供应商型号', '进价*', '销售价A', '销售价B', '销售价C', '销售价D'],
    ['示例商品', '个', 'ABC-100', '红色', 'ABC-替换件', '10.00', '15.00', '18.00', '20.00', '25.00'],
  ]
  const widths = [22, 6, 12, 8, 16, 10, 10, 10, 10, 10]
  return {
    filename: '商品导入模板.xlsx',
    buffer: await buildWorkbookBuffer([{ name: '商品导入', rows, widths }]),
  }
}

async function importProducts({ fileBuffer }) {
  const dataRows = await parseProductImportRows(fileBuffer)

  let success = 0
  let skip = 0
  const errors = []

  const toPrice = (v) => {
    if (v === '' || v === null || v === undefined) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  for (let index = 0; index < dataRows.length; index += 1) {
    const [name, unit, spec, color, articleNumber, costPrice, salePriceA, salePriceB, salePriceC, salePriceD] = dataRows[index]
    if (!name || !unit || !spec || !color || !costPrice) {
      errors.push(`第${index + 2}行：名称、单位、型号、颜色、进价为必填`)
      continue
    }

    try {
      const code = await generateMasterCode(pool, 'P', 'product_items')

      // 供应商型号：供应商给的型号文本，人工填写、缺省 NULL（2026-09 起不再自动生成货号/补齐6位）
      const finalArticle = String(articleNumber || '').trim() || null

      const cp = toPrice(costPrice)
      const pa = toPrice(salePriceA)
      const pb = toPrice(salePriceB)
      const pc = toPrice(salePriceC)
      const pd = toPrice(salePriceD)

      const cut = (v, max) => {
        const s = String(v || '').trim()
        return s ? s.slice(0, max) : null
      }

      await pool.query(
        `INSERT INTO product_items
          (code, name, unit, spec, color, article_number, cost_price, sale_price, sale_price_a, sale_price_b, sale_price_c, sale_price_d)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          code,
          cut(name, 150),
          cut(unit, 20),
          cut(spec, 200),
          cut(color, 60),
          finalArticle,
          cp ?? 0,
          pa ?? 0,
          pa,
          pb,
          pc,
          pd,
        ],
      )
      success += 1
    } catch (error) {
      errors.push(`第${index + 2}行：${error instanceof AppError ? error.message : '导入失败（数据格式或约束不符）'}`)
    }
  }

  return {
    data: { success, skip, errors },
    message: `导入完成：成功${success}条，跳过${skip}条${errors.length ? `，失败${errors.length}条` : ''}`,
  }
}

async function buildStockTemplate() {
  const [products] = await pool.query(
    'SELECT code, name, unit FROM product_items WHERE deleted_at IS NULL ORDER BY code LIMIT 100',
  )
  const [warehouses] = await pool.query(
    'SELECT id, name FROM inventory_warehouses WHERE deleted_at IS NULL AND is_active=1',
  )

  const stockRows = [
    ['商品编码*（需已存在）', '仓库ID*', '库存数量*'],
    ...products.flatMap((product) => warehouses.map((warehouse) => [product.code, warehouse.id, 0])),
  ]
  const warehouseRows = [
    ['仓库ID', '仓库名称'],
    ...warehouses.map((warehouse) => [warehouse.id, warehouse.name]),
  ]

  return {
    filename: '库存初始化模板.xlsx',
    buffer: await buildWorkbookBuffer([
      { name: '库存初始化', rows: stockRows },
      { name: '仓库参考', rows: warehouseRows },
    ]),
  }
}

async function createImportBatch(fileName) {
  try {
    const [result] = await pool.query(
      'INSERT INTO inventory_import_batches (file_name, row_count) VALUES (?, 0)',
      [fileName || 'stock.xlsx'],
    )
    return result.insertId
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') {
      throw new AppError('缺少表 inventory_import_batches，请先执行迁移 038_inventory_full_loop_source.sql', 500)
    }
    throw error
  }
}

async function importSingleStockRow({
  batchId,
  rowIndex,
  row,
  userId,
  operatorName,
  scopeWarehouseIds,
}) {
  const [code, warehouseId, qty] = row
  if (!code || !warehouseId || qty === '') {
    return { ok: false, error: `第${rowIndex + 2}行：数据不完整` }
  }

  // 仓库 scope 校验（2026-08-30 审计）：文件内 warehouseId 由用户控制，限仓用户不得对他仓做库存调整
  if (Array.isArray(scopeWarehouseIds) && !scopeWarehouseIds.includes(Number(warehouseId))) {
    return { ok: false, error: `第${rowIndex + 2}行：无权限操作仓库 ${warehouseId}` }
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[product]] = await connection.query(
      'SELECT id, name, unit FROM product_items WHERE code=? AND deleted_at IS NULL',
      [String(code).trim()],
    )
    if (!product) {
      await connection.rollback()
      return { ok: false, error: `第${rowIndex + 2}行：商品编码"${code}"不存在` }
    }

    const [[warehouse]] = await connection.query(
      'SELECT id FROM inventory_warehouses WHERE id=? AND deleted_at IS NULL AND is_active=1',
      [+warehouseId],
    )
    if (!warehouse) {
      await connection.rollback()
      return { ok: false, error: `第${rowIndex + 2}行：仓库 ${warehouseId} 不存在或已停用` }
    }

    const target = Number(qty)
    if (!Number.isFinite(target) || target < 0) {
      await connection.rollback()
      return { ok: false, error: `第${rowIndex + 2}行：库存数量无效` }
    }

    const { quantity: current } = await getStockProjection(connection, {
      productId: product.id,
      warehouseId: +warehouseId,
      lock: true,
    })
    const diff = target - current
    if (diff === 0) {
      await connection.commit()
      return { ok: true }
    }

    const { before, after, createdContainerId, primaryDeductContainerId } = await adjustContainerStock(connection, {
      productId: product.id,
      productName: product.name,
      warehouseId: +warehouseId,
      qty: diff,
      unit: product.unit,
      sourceType: SOURCE_TYPE.IMPORT,
      sourceRefId: batchId,
      sourceRefType: 'import',
      sourceRefNo: `IMP${batchId}`,
      remark: `库存Excel导入 第${rowIndex + 2}行`,
    })

    const containerId = diff > 0 ? createdContainerId : primaryDeductContainerId
    const logType = diff > 0 ? 1 : 2
    await writeInventoryLog(connection, {
      moveType: MOVE_TYPE.STOCKCHECK,
      type: logType,
      productId: product.id,
      warehouseId: +warehouseId,
      quantity: Math.abs(diff),
      beforeQty: before,
      afterQty: after,
      refType: 'import',
      refId: batchId,
      refNo: `IMP${batchId}`,
      containerId,
      sourceType: SOURCE_TYPE.IMPORT,
      sourceRefId: batchId,
      remark: `库存Excel导入 第${rowIndex + 2}行`,
      operatorId: userId,
      operatorName,
    })

    await connection.commit()
    return { ok: true }
  } catch (error) {
    await connection.rollback()
    // 错误脱敏（2026-08-22 加固）：不回显 MySQL 原始 message（schema 细节）
    const safe = error instanceof AppError ? error.message : '导入失败（数据格式或约束不符）'
    return { ok: false, error: `第${rowIndex + 2}行：${safe}` }
  } finally {
    connection.release()
  }
}

async function importStock({ fileBuffer, originalName, operator, scopeWarehouseIds = null }) {
  const dataRows = await parseStockImportRows(fileBuffer)
  const batchId = await createImportBatch(originalName)
  const userId = operator?.userId ?? null
  const operatorName = operator?.realName || operator?.operatorName || '未知'

  let success = 0
  const errors = []
  for (let index = 0; index < dataRows.length; index += 1) {
    const result = await importSingleStockRow({
      batchId,
      rowIndex: index,
      row: dataRows[index],
      userId,
      operatorName,
      scopeWarehouseIds,
    })
    if (result.ok) {
      success += 1
    } else {
      errors.push(result.error)
    }
  }

  await pool.query('UPDATE inventory_import_batches SET row_count=? WHERE id=?', [success, batchId])

  return {
    data: { batchId, success, errors },
    message: `导入完成：成功${success}条${errors.length ? `，失败${errors.length}条` : ''}`,
  }
}

// ── 客户导入 ──────────────────────────────────────────────────────────────────
// 列：code/name/contact/phone/settlement_type/credit_limit
// 与 customers.service.create 口径一致：名称查重、结算方式归一、账期归零、授信额度可空。

async function buildCustomerTemplate() {
  const rows = [
    ['客户编码', '客户名称*', '联系人', '电话', '结算方式', '授信额度'],
    ['C0001', '示例客户', '张三', '13800000000', '现结', '50000'],
  ]
  const widths = [14, 24, 12, 16, 12, 14]
  return {
    filename: '客户导入模板.xlsx',
    buffer: await buildWorkbookBuffer([{ name: '客户导入', rows, widths }]),
  }
}

async function importCustomers({ fileBuffer }) {
  const rows = await readSheetRows(fileBuffer)
  const dataRows = rows.slice(1).filter((row) => row[0] || row[1])
  if (!dataRows.length) throw new AppError('文件无数据行', 400)

  let success = 0
  const errors = []
  const cut = (v, max) => {
    const s = String(v ?? '').trim()
    return s ? s.slice(0, max) : null
  }

  for (let index = 0; index < dataRows.length; index += 1) {
    const [code, name, contact, phone, settlementType, creditLimit] = dataRows[index]
    const normalizedName = String(name ?? '').trim()
    if (!normalizedName) {
      errors.push(`第${index + 2}行：客户名称为必填`)
      continue
    }
    try {
      // 名称唯一（与 customers.service.ensureCustomerNameUnique 同口径）
      const [dup] = await pool.query(
        'SELECT id FROM sale_customers WHERE name=? AND deleted_at IS NULL LIMIT 1',
        [normalizedName],
      )
      if (dup[0]) {
        errors.push(`第${index + 2}行：客户名称"${normalizedName}"已存在`)
        continue
      }

      // 编码：留空自动生成，填写则查重后使用
      let finalCode = String(code ?? '').trim()
      if (!finalCode) {
        finalCode = await generateMasterCode(pool, 'CUS', 'sale_customers')
      } else {
        const [codeDup] = await pool.query(
          'SELECT id FROM sale_customers WHERE code=? AND deleted_at IS NULL LIMIT 1',
          [finalCode],
        )
        if (codeDup[0]) {
          errors.push(`第${index + 2}行：客户编码"${finalCode}"已存在`)
          continue
        }
      }

      const settle = normalizeSettlementType(settlementType)
      const terms = normalizeTermsDays(settle, null)
      const limit = creditLimit === '' || creditLimit === null || creditLimit === undefined
        ? null
        : Math.max(0, Number(creditLimit))

      await pool.query(
        `INSERT INTO sale_customers
           (code,name,contact,phone,price_level,settlement_type,payment_terms_days,credit_limit)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          finalCode,
          normalizedName,
          cut(contact, 50),
          cut(phone, 20),
          'A',
          settle,
          terms,
          limit,
        ],
      )
      success += 1
    } catch (error) {
      errors.push(`第${index + 2}行：${error instanceof AppError ? error.message : '导入失败（数据格式或约束不符）'}`)
    }
  }

  return {
    data: { success, errors },
    message: `导入完成：成功${success}条${errors.length ? `，失败${errors.length}条` : ''}`,
  }
}

// ── 供应商导入 ──────────────────────────────────────────────────────────────────
// 列：code/name/contact/phone/settlement_type/payment_terms_days/lead_time_days/address
// 与 suppliers.service.create 口径一致：名称查重、结算方式归一、账期归零、提前期可空。
//
// 注意两处必须与 suppliers.service 对齐：
//   1. 编码前缀用 'SUP'（与 create 的 generateMasterCode(pool,'SUP',...) 一致），
//      不能用 'S'——前缀不一致会导致 S000001 与 SUP000001 两套编码并存，且 generateMasterCode
//      按前缀 REGEXP 查最大值时互不匹配，编号会重复。
//   2. 结算方式列接受数字（1现结/2月结），与前端 SettlementTypeField 提交值一致；
//      也兼容中文（现结/月结）——normalizeSettlementType 只认数字，中文会落回月结，
//      所以这里先做一次中文→数字映射再交给它。

const SETTLEMENT_TYPE_BY_NAME = { 现结: 1, 月结: 2 }

async function buildSupplierTemplate() {
  const rows = [
    ['供应商编码', '供应商名称*', '联系人', '电话', '结算方式(1现结/2月结)', '账期（天）', '采购提前期（天）', '地址'],
    ['S0001', '示例供应商', '李四', '13900000000', '2', '30', '7', '北京市朝阳区'],
  ]
  const widths = [14, 24, 12, 14, 22, 14, 16, 30]
  return {
    filename: '供应商导入模板.xlsx',
    buffer: await buildWorkbookBuffer([{ name: '供应商导入', rows, widths }]),
  }
}

async function importSuppliers({ fileBuffer }) {
  const rows = await readSheetRows(fileBuffer)
  const dataRows = rows.slice(1).filter((row) => row[0] || row[1])
  if (!dataRows.length) throw new AppError('文件无数据行', 400)

  let success = 0
  const errors = []
  const cut = (v, max) => {
    const s = String(v ?? '').trim()
    return s ? s.slice(0, max) : null
  }

  for (let index = 0; index < dataRows.length; index += 1) {
    const [code, name, contact, phone, settlementType, paymentTermsDays, leadTimeDays, address] = dataRows[index]
    // name 与前端 LimitedInput maxLength={20} 对齐，避免超 DB VARCHAR(100) 整行失败
    const normalizedName = String(name ?? '').trim().slice(0, 20)
    if (!normalizedName) {
      errors.push(`第${index + 2}行：供应商名称为必填`)
      continue
    }
    // phone 非空时校验 11 位手机号（与前端 PHONE_RE 一致），非法直接留痕跳过
    const normPhone = String(phone ?? '').trim()
    if (normPhone && !/^1\d{10}$/.test(normPhone)) {
      errors.push(`第${index + 2}行：电话"${normPhone}"不是有效的 11 位手机号`)
      continue
    }
    try {
      // 名称唯一（与 suppliers.service.ensureSupplierNameUnique 同口径）
      const [dup] = await pool.query(
        'SELECT id FROM supply_suppliers WHERE name=? AND deleted_at IS NULL LIMIT 1',
        [normalizedName],
      )
      if (dup[0]) {
        errors.push(`第${index + 2}行：供应商名称"${normalizedName}"已存在`)
        continue
      }

      // 编码：留空自动生成，填写则查重后使用（前缀必须与 create 一致，用 'SUP'）
      let finalCode = String(code ?? '').trim()
      if (!finalCode) {
        finalCode = await generateMasterCode(pool, 'SUP', 'supply_suppliers')
      } else {
        const [codeDup] = await pool.query(
          'SELECT id FROM supply_suppliers WHERE code=? AND deleted_at IS NULL LIMIT 1',
          [finalCode],
        )
        if (codeDup[0]) {
          errors.push(`第${index + 2}行：供应商编码"${finalCode}"已存在`)
          continue
        }
      }

      // 结算方式：优先数字，兼容中文（normalizeSettlementType 只认数字，中文需先映射）
      const settleRaw = String(settlementType ?? '').trim()
      let settle = Number(settleRaw)
      if (!Number.isFinite(settle) && SETTLEMENT_TYPE_BY_NAME[settleRaw] != null) {
        settle = SETTLEMENT_TYPE_BY_NAME[settleRaw]
      }
      const settleNormalized = normalizeSettlementType(settle)
      const terms = normalizeTermsDays(settleNormalized, paymentTermsDays)
      const leadTime = leadTimeDays === '' || leadTimeDays == null || leadTimeDays === undefined
        ? 0
        : Math.max(0, Number(leadTimeDays))

      await pool.query(
        `INSERT INTO supply_suppliers
           (code,name,contact,phone,email,address,settlement_type,payment_terms_days,lead_time_days,is_active)
         VALUES (?,?,?,?,?,?,?,?,?,1)`,
        [
          finalCode,
          normalizedName,
          cut(contact, 5),
          normPhone || null,
          null, // email 不在模板里
          cut(address, 30),
          settleNormalized,
          terms,
          leadTime,
        ],
      )
      success += 1
    } catch (error) {
      errors.push(`第${index + 2}行：${error instanceof AppError ? error.message : '导入失败（数据格式或约束不符）'}`)
    }
  }

  return {
    data: { success, errors },
    message: `导入完成：成功${success}条${errors.length ? `，失败${errors.length}条` : ''}`,
  }
}

// ── 价格表明细导入 ────────────────────────────────────────────────────────────
// 列：list_id/product_code/sale_price。product_code 按商品编码解析（需已存在），
// 行级回执与商品导入一致；重复 (list_id, product_code) 行后写覆盖前者。

async function buildPriceListTemplate() {
  const [lists] = await pool.query(
    'SELECT id, name FROM price_lists WHERE deleted_at IS NULL ORDER BY id',
  )
  const rows = [
    ['价格表ID*', '商品编码*', '销售价*'],
    ...lists.map(l => [l.id, `商品编码（价格表：${l.name}）`, '15.00']),
  ]
  return {
    filename: '价格表明细导入模板.xlsx',
    buffer: await buildWorkbookBuffer([{ name: '价格表明细', rows, widths: [12, 24, 12] }]),
  }
}

async function importPriceListItems({ fileBuffer }) {
  const rows = await readSheetRows(fileBuffer)
  const dataRows = rows.slice(1).filter((row) => row[0] || row[1])
  if (!dataRows.length) throw new AppError('文件无数据行', 400)

  // 按 (list_id, product_code) 去重：重复行以后写为准
  const merged = new Map()
  for (const row of dataRows) {
    const key = `${String(row[0]).trim()}|${String(row[1]).trim()}`
    merged.set(key, row)
  }
  const listIds = new Set()
  for (const row of merged.values()) listIds.add(String(row[0]).trim())

  // 预载价格表与商品（一次查询，避免逐行 N+1；不存在/停用的商品跳过并留痕）
  const listWhere = [...listIds].length
    ? listIds
    : []
  const validListIds = new Set()
  if (listWhere.length) {
    const placeholders = listWhere.map(() => '?').join(',')
    const [lists] = await pool.query(
      `SELECT id FROM price_lists WHERE deleted_at IS NULL AND id IN (${placeholders})`,
      listWhere,
    )
    lists.forEach(l => validListIds.add(String(l.id)))
  }
  const [products] = await pool.query('SELECT code, id, name, unit FROM product_items WHERE deleted_at IS NULL')
  const productByCode = new Map()
  products.forEach(p => productByCode.set(String(p.code), p))

  let success = 0
  const errors = []

  for (const row of merged.values()) {
    const [listIdRaw, productCodeRaw, priceRaw] = row
    const listId = String(listIdRaw ?? '').trim()
    const productCode = String(productCodeRaw ?? '').trim()
    const lineNo = dataRows.indexOf(row) + 2
    const label = `第${lineNo}行`

    if (!listId || !productCode || priceRaw === '' || priceRaw === null || priceRaw === undefined) {
      errors.push(`${label}：价格表ID、商品编码、销售价为必填`)
      continue
    }
    if (!validListIds.has(listId)) {
      errors.push(`${label}：价格表 ${listId} 不存在或已删除`)
      continue
    }
    const product = productByCode.get(productCode)
    if (!product) {
      errors.push(`${label}：商品编码"${productCode}"不存在`)
      continue
    }
    const price = Number(priceRaw)
    if (!Number.isFinite(price) || price < 0) {
      errors.push(`${label}：销售价无效`)
      continue
    }

    try {
      await pool.query(
        `INSERT INTO price_list_items (list_id,product_id,product_code,product_name,unit,sale_price)
         VALUES (?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE sale_price = VALUES(sale_price)`,
        [Number(listId), product.id, product.code, product.name, product.unit, price],
      )
      success += 1
    } catch (error) {
      // 错误脱敏（与 importProducts/importCustomers 一致）：MySQL 原始 message 含表名/唯一键名/字段值，
      // 回显会泄露 schema 细节（审计 2026-08-30）
      errors.push(`${label}：${error instanceof AppError ? error.message : '导入失败（数据格式或约束不符）'}`)
    }
  }

  return {
    data: { success, errors },
    message: `导入完成：成功${success}条${errors.length ? `，失败${errors.length}条` : ''}`,
  }
}

module.exports = {
  buildProductTemplate,
  importProducts,
  buildStockTemplate,
  importStock,
  buildCustomerTemplate,
  importCustomers,
  buildSupplierTemplate,
  importSuppliers,
  buildPriceListTemplate,
  importPriceListItems,
}
