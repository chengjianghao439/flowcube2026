const XLSX = require('xlsx')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { MOVE_TYPE } = require('../../engine/inventoryEngine')
const { adjustContainerStock, SOURCE_TYPE, getStockProjection } = require('../../engine/containerEngine')
const { loadPriceRates, computeTierPrices } = require('../../utils/priceLevels')

function createWorkbookBuffer(sheets) {
  const workbook = XLSX.utils.book_new()
  sheets.forEach(({ name, sheet }) => XLSX.utils.book_append_sheet(workbook, sheet, name))
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
}

function readSheetRows(fileBuffer) {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
}

function parseProductImportRows(fileBuffer) {
  const rows = readSheetRows(fileBuffer)
  if (rows.length < 2) throw new AppError('文件无数据行', 400)
  return rows.slice(1).filter((row) => row[0] || row[1])
}

function parseStockImportRows(fileBuffer) {
  const rows = readSheetRows(fileBuffer)
  const dataRows = rows.slice(1).filter((row) => row[0])
  if (!dataRows.length) throw new AppError('文件无数据行', 400)
  return dataRows
}

async function buildProductTemplate() {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['商品编码*', '商品名称*', '单位*', '规格', '条码', '成本价', '备注'],
    ['P001', '示例商品', '个', '标准规格', '', '10.00', ''],
  ])
  sheet['!cols'] = [12, 22, 6, 14, 14, 10, 20].map((width) => ({ wch: width }))
  return {
    filename: '商品导入模板.xlsx',
    buffer: createWorkbookBuffer([{ name: '商品导入', sheet }]),
  }
}

async function importProducts({ fileBuffer }) {
  const dataRows = parseProductImportRows(fileBuffer)
  const rates = await loadPriceRates(pool)

  let success = 0
  let skip = 0
  const errors = []

  for (let index = 0; index < dataRows.length; index += 1) {
    const [code, name, unit, spec, barcode, costPrice, remark] = dataRows[index]
    if (!code || !name || !unit) {
      errors.push(`第${index + 2}行：编码、名称、单位为必填`)
      continue
    }

    try {
      const [existing] = await pool.query(
        'SELECT id FROM product_items WHERE code=? AND deleted_at IS NULL',
        [String(code).trim()],
      )
      if (existing.length) {
        skip += 1
        continue
      }

      const prices = computeTierPrices(costPrice, rates)
      await pool.query(
        `INSERT INTO product_items
          (code,name,unit,spec,barcode,cost_price,sale_price,sale_price_a,sale_price_b,sale_price_c,sale_price_d,remark)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          String(code).trim(),
          String(name).trim(),
          String(unit).trim(),
          spec || null,
          barcode || null,
          prices.costPrice,
          prices.salePrice,
          prices.salePriceA,
          prices.salePriceB,
          prices.salePriceC,
          prices.salePriceD,
          remark || null,
        ],
      )
      success += 1
    } catch (error) {
      errors.push(`第${index + 2}行：${error.message}`)
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

  const stockSheet = XLSX.utils.aoa_to_sheet([
    ['商品编码*（需已存在）', '仓库ID*', '库存数量*'],
    ...products.flatMap((product) => warehouses.map((warehouse) => [product.code, warehouse.id, 0])),
  ])
  const warehouseSheet = XLSX.utils.aoa_to_sheet([
    ['仓库ID', '仓库名称'],
    ...warehouses.map((warehouse) => [warehouse.id, warehouse.name]),
  ])

  return {
    filename: '库存初始化模板.xlsx',
    buffer: createWorkbookBuffer([
      { name: '库存初始化', sheet: stockSheet },
      { name: '仓库参考', sheet: warehouseSheet },
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

async function loadOperatorName(userId) {
  const [[user]] = await pool.query('SELECT real_name FROM sys_users WHERE id=?', [userId])
  return user?.real_name || '未知'
}

async function importSingleStockRow({
  batchId,
  rowIndex,
  row,
  userId,
  operatorName,
}) {
  const [code, warehouseId, qty] = row
  if (!code || !warehouseId || qty === '') {
    return { ok: false, error: `第${rowIndex + 2}行：数据不完整` }
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
    await connection.query(
      `INSERT INTO inventory_logs
         (move_type, type, product_id, warehouse_id, supplier_id,
          quantity, before_qty, after_qty, unit_price,
          ref_type, ref_id, ref_no,
          container_id, log_source_type, log_source_ref_id,
          remark, operator_id, operator_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        MOVE_TYPE.STOCKCHECK,
        logType,
        product.id,
        +warehouseId,
        null,
        Math.abs(diff),
        before,
        after,
        null,
        'import',
        batchId,
        `IMP${batchId}`,
        containerId,
        SOURCE_TYPE.IMPORT,
        batchId,
        `库存Excel导入 第${rowIndex + 2}行`,
        userId,
        operatorName,
      ],
    )

    await connection.commit()
    return { ok: true }
  } catch (error) {
    await connection.rollback()
    return { ok: false, error: `第${rowIndex + 2}行：${error.message}` }
  } finally {
    connection.release()
  }
}

async function importStock({ fileBuffer, originalName, userId }) {
  const dataRows = parseStockImportRows(fileBuffer)
  const batchId = await createImportBatch(originalName)
  const operatorName = await loadOperatorName(userId)

  let success = 0
  const errors = []
  for (let index = 0; index < dataRows.length; index += 1) {
    const result = await importSingleStockRow({
      batchId,
      rowIndex: index,
      row: dataRows[index],
      userId,
      operatorName,
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

module.exports = {
  buildProductTemplate,
  importProducts,
  buildStockTemplate,
  importStock,
}
