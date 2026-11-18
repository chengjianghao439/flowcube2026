'use strict'

const { createHash } = require('node:crypto')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')

function stockImportRequestKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)) {
    throw new AppError('库存导入请求标识无效', 400, 'STOCK_IMPORT_KEY_INVALID')
  }
  return value
}

function stockImportOwner(operator) {
  const userId = Number(operator?.userId)
  if (!Number.isSafeInteger(userId) || userId < 1) throw new AppError('请重新登录后再导入库存', 401)
  return userId
}

function authorizedRun(row, scopeWarehouseIds) {
  if (!row) return null
  const warehouseIds = Array.isArray(row.warehouse_ids) ? row.warehouse_ids : JSON.parse(row.warehouse_ids)
  if (Array.isArray(scopeWarehouseIds) && warehouseIds.some(id => !scopeWarehouseIds.includes(id))) {
    throw new AppError('原批次涉及已无权限的仓库', 403, 'WAREHOUSE_SCOPE_DENIED')
  }
  return { batchId: row.batch_id, bodySha256: row.body_sha256, warehouseIds, totalRows: Number(row.total_rows) }
}

async function findRun(userId, requestKey) {
  const [[row]] = await pool.query(
    'SELECT batch_id, body_sha256, warehouse_ids, total_rows FROM inventory_stock_import_runs WHERE user_id=? AND request_key=?',
    [userId, requestKey],
  )
  return row
}

async function openStockImportRun({ scopeWarehouseIds, fileBuffer, originalName, operator, requestKey, dataRows }) {
  const userId = stockImportOwner(operator)
  const bodySha256 = createHash('sha256').update(fileBuffer).digest('hex')
  const key = stockImportRequestKey(requestKey ?? `stock-import:${bodySha256}`)
  const check = row => {
    const run = authorizedRun(row, scopeWarehouseIds)
    if (run.bodySha256 !== bodySha256 || run.totalRows !== dataRows.length) {
      throw new AppError('同一导入批次只能继续使用原文件', 409, 'STOCK_IMPORT_CONTENT_CHANGED')
    }
    return { ...run, requestKey: key }
  }
  const existing = await findRun(userId, key)
  if (existing) return check(existing)

  // Preserve row-level scope errors and prevent a retry from widening the original batch.
  const warehouseIds = Array.from(new Set(dataRows.map(row => Number(row[1]))))
    .filter(id => Number.isSafeInteger(id) && id > 0 && (!Array.isArray(scopeWarehouseIds) || scopeWarehouseIds.includes(id)))
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [batch] = await conn.query('INSERT INTO inventory_import_batches (file_name, row_count) VALUES (?, 0)', [originalName || 'stock.xlsx'])
    await conn.query(
      'INSERT INTO inventory_stock_import_runs (user_id, request_key, batch_id, body_sha256, warehouse_ids, total_rows) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, key, batch.insertId, bodySha256, JSON.stringify(warehouseIds), dataRows.length],
    )
    await conn.commit()
    return { batchId: batch.insertId, bodySha256, warehouseIds, totalRows: dataRows.length, requestKey: key }
  } catch (error) {
    await conn.rollback()
    if (error.code !== 'ER_DUP_ENTRY') throw error
  } finally {
    conn.release()
  }

  // A concurrent uploader won the unique identity. Its batch owns the work.
  const winner = await findRun(userId, key)
  if (!winner) throw new AppError('库存导入批次冲突，请稍后用原文件重试', 409, 'STOCK_IMPORT_BATCH_CONFLICT')
  return check(winner)
}

async function claimRow(conn, batchId, rowIndex) {
  await conn.query(
    `INSERT INTO inventory_stock_import_rows (batch_id, row_index) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE row_index=inventory_stock_import_rows.row_index`,
    [batchId, rowIndex],
  )
  const [[row]] = await conn.query(
    'SELECT applied FROM inventory_stock_import_rows WHERE batch_id=? AND row_index=? FOR UPDATE',
    [batchId, rowIndex],
  )
  return Boolean(row.applied)
}

async function hasLaterAppliedRow(conn, batchId, rowIndex, productId, warehouseId) {
  const [[later]] = await conn.query(
    `SELECT 1 FROM inventory_stock_import_rows
      WHERE batch_id=? AND product_id=? AND warehouse_id=? AND row_index>? AND applied=1 LIMIT 1`,
    [batchId, productId, warehouseId, rowIndex],
  )
  return Boolean(later)
}

async function completeRow(conn, batchId, rowIndex, productId, warehouseId) {
  await conn.query(
    `UPDATE inventory_stock_import_rows SET applied=1, error_message=NULL, product_id=?, warehouse_id=?
      WHERE batch_id=? AND row_index=?`,
    [productId, warehouseId, batchId, rowIndex],
  )
  await conn.query('UPDATE inventory_import_batches SET row_count=row_count+1 WHERE id=?', [batchId])
}

async function recordRowFailure(batchId, rowIndex, message) {
  const characters = Array.from(message)
  const summary = characters.length > 500 ? characters.slice(0, 499).join('') + '…' : message
  await pool.query(
    `INSERT INTO inventory_stock_import_rows (batch_id, row_index, error_message) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE error_message=IF(applied=1, error_message, ?)`,
    [batchId, rowIndex, summary, summary],
  )
}

async function readProgress({ batchId, totalRows, requestKey }) {
  const [rows] = await pool.query(
    'SELECT row_index, applied, error_message FROM inventory_stock_import_rows WHERE batch_id=? ORDER BY row_index',
    [batchId],
  )
  const success = rows.filter(row => row.applied).length
  return { batchId, requestKey, success, totalRows, errors: rows.filter(row => !row.applied && row.error_message).map(row => row.error_message) }
}

async function getStockImportStatus({ requestKey, operator, scopeWarehouseIds }) {
  const key = stockImportRequestKey(requestKey)
  const run = authorizedRun(await findRun(stockImportOwner(operator), key), scopeWarehouseIds)
  if (!run) throw new AppError('未找到该库存导入批次', 404, 'STOCK_IMPORT_NOT_FOUND')
  return readProgress({ ...run, requestKey: key })
}

module.exports = { openStockImportRun, getStockImportStatus, readProgress, claimRow, hasLaterAppliedRow, completeRow, recordRowFailure }
