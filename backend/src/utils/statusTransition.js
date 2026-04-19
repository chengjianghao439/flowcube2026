const AppError = require('./AppError')

function assertSqlIdentifier(value, label) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(`Invalid SQL identifier for ${label}: ${value}`)
  }
}

function normalizeStatusList(fromStatus) {
  const list = Array.isArray(fromStatus) ? fromStatus : [fromStatus]
  if (!list.length) throw new Error('fromStatus is required')
  return list
}

function buildSetClause(extraSet = {}) {
  const entries = Object.entries(extraSet)
  if (!entries.length) return { sql: '', params: [] }
  const assignments = []
  const params = []
  for (const [column, value] of entries) {
    assertSqlIdentifier(column, 'column')
    assignments.push(`${column} = ?`)
    params.push(value)
  }
  return { sql: `, ${assignments.join(', ')}`, params }
}

async function lockStatusRow(conn, {
  table,
  id,
  columns = '*',
  entityName = '记录',
  deletedAt = true,
}) {
  assertSqlIdentifier(table, 'table')
  const whereDeleted = deletedAt ? ' AND deleted_at IS NULL' : ''
  const [[row]] = await conn.query(
    `SELECT ${columns} FROM ${table} WHERE id = ?${whereDeleted} FOR UPDATE`,
    [id],
  )
  if (!row) throw new AppError(`${entityName}不存在`, 404)
  return row
}

async function compareAndSetStatus(conn, {
  table,
  id,
  fromStatus,
  toStatus,
  entityName = '单据',
  statusColumn = 'status',
  extraSet = {},
}) {
  assertSqlIdentifier(table, 'table')
  assertSqlIdentifier(statusColumn, 'statusColumn')
  const fromList = normalizeStatusList(fromStatus)
  const placeholders = fromList.map(() => '?').join(',')
  const { sql: extraSql, params: extraParams } = buildSetClause(extraSet)
  const [result] = await conn.query(
    `UPDATE ${table}
     SET ${statusColumn} = ?${extraSql}
     WHERE id = ? AND ${statusColumn} IN (${placeholders})`,
    [toStatus, ...extraParams, id, ...fromList],
  )
  if (result.affectedRows !== 1) {
    throw new AppError(`${entityName}状态已变化，请刷新后重试`, 409)
  }
  return result
}

module.exports = {
  lockStatusRow,
  compareAndSetStatus,
}
