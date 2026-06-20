const ExcelJS = require('exceljs')
const { Readable } = require('stream')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateMasterCode } = require('../../utils/codeGenerator')
const { MOVE_TYPE } = require('../../engine/inventoryEngine')
const { adjustContainerStock, SOURCE_TYPE, getStockProjection } = require('../../engine/containerEngine')


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
    ['商品名称*', '单位*', '型号*', '颜色*', '货号', '进价*', '销售价A', '销售价B', '销售价C', '销售价D'],
    ['示例商品', '个', 'ABC-100', '红色', 'H001', '10.00', '15.00', '18.00', '20.00', '25.00'],
  ]
  const widths = [22, 6, 12, 8, 10, 10, 10, 10, 10, 10]
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

      // 货号：手动填写则补齐6位，否则自动生成5开头的6位货号
      const art = String(articleNumber || '').trim()
      let finalArticle = null
      if (art) {
        if (!/^\d+$/.test(art) || art.length > 6) {
          errors.push(`第${index + 2}行：货号必须为不超过6位的数字`)
          continue
        }
        finalArticle = art.padStart(6, '0')
      } else {
        const [[{ maxArt }]] = await pool.query(
          `SELECT COALESCE(MAX(CAST(article_number AS UNSIGNED)), 500000) AS maxArt
           FROM product_items
           WHERE article_number REGEXP '^5[0-9]{5}$'`,
        )
        finalArticle = String(Number(maxArt) + 1).padStart(6, '0')
      }

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

async function importStock({ fileBuffer, originalName, operator }) {
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
