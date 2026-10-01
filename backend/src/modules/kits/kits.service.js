'use strict'
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { normalizePagination } = require('../../utils/pagination')
const { assertInScope } = require('../../utils/warehouseScope')
const { getStockProjections } = require('../../engine/containerEngine')
const { beginCreationOperationRequest, beginResourceOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { assertPrice, snapshotComponents } = require('./kits.composition')

async function transaction(fn, { readOnly = false } = {}) {
  const conn = await pool.getConnection()
  try {
    if (readOnly) await conn.query('START TRANSACTION READ ONLY')
    else await conn.beginTransaction()
    const result = await fn(conn)
    await conn.commit()
    return result
  } catch (e) {
    await conn.rollback()
    if (e.code === 'ER_DUP_ENTRY') throw new AppError('套件编码已存在', 409, 'KIT_CODE_EXISTS')
    throw e
  } finally { conn.release() }
}
function requiredKey(value) {
  const key = String(value || '').trim()
  if (!key || key.length > 128) throw new AppError('请提供稳定的请求键', 400, 'REQUEST_KEY_REQUIRED')
  return key
}
function definitionView(row, version) {
  return { id: Number(row.id), code: row.code, name: row.name, isActive: !!Number(row.is_active), deletedAt: row.deleted_at, revision: Number(row.revision), currentVersionId: Number(row.current_version_id), version }
}
async function loadVersions(conn, ids) {
  const uniqueIds = [...new Set(ids.map(Number))]
  if (!uniqueIds.length) return new Map()
  if (uniqueIds.length > 200) throw new AppError('版本查询超过上限', 400, 'KIT_GROUP_LIMIT')
  const [versions] = await conn.query('SELECT id,kit_id,version_no,reference_unit_price,created_by,created_at FROM kit_definition_versions WHERE id IN (?)', [uniqueIds])
  const [rows] = await conn.query(
    `SELECT c.id,c.version_id,c.product_id,c.base_qty,c.reference_price,c.amount_weight,c.weight_source,c.sort_no,
            p.code,p.name,p.unit,p.is_active,p.deleted_at,p.allow_decimal_qty
     FROM kit_definition_components c LEFT JOIN product_items p ON p.id=c.product_id
     WHERE c.version_id IN (?) ORDER BY c.version_id,c.sort_no,c.id`, [uniqueIds])
  const byVersion = new Map()
  for (const c of rows) {
    const list = byVersion.get(Number(c.version_id)) || []
    list.push({ id: Number(c.id), productId: Number(c.product_id), baseQty: Number(c.base_qty), referencePrice: Number(c.reference_price), amountWeight: c.amount_weight, weightSource: c.weight_source, sortNo: Number(c.sort_no), productCode: c.code, productName: c.name, unit: c.unit, productActive: Number(c.is_active) === 1 && c.deleted_at == null && c.code != null, allowDecimal: c.allow_decimal_qty == null || Number(c.allow_decimal_qty) === 1 })
    byVersion.set(Number(c.version_id), list)
  }
  return new Map(versions.map(v => [Number(v.id), { id: Number(v.id), kitId: Number(v.kit_id), versionNo: Number(v.version_no), referenceUnitPrice: Number(v.reference_unit_price), createdBy: v.created_by == null ? null : Number(v.created_by), createdAt: v.created_at, referenceBasis: 'version_product_a_snapshot_or_explicit_weights', referenceSnapshotAt: null, referenceBasisExplanation: '组成明确提交时保存当时A价或显式权重；未提交组成而仅修改套报价时沿用原版本参考依据。createdAt仅表示该版本创建时间，原始采样时间未单独保存', components: byVersion.get(Number(v.id)) || [] }]))
}
async function detailIn(conn, id, versionId) {
  const [[row]] = await conn.query('SELECT * FROM kit_definitions WHERE id=?', [id])
  if (!row) throw new AppError('套件不存在', 404, 'KIT_NOT_FOUND')
  const selected = Number(versionId ?? row.current_version_id)
  const version = (await loadVersions(conn, [selected])).get(selected)
  if (!version || version.kitId !== Number(row.id)) throw new AppError('套件版本不存在', 404, 'KIT_VERSION_NOT_FOUND')
  return definitionView(row, version)
}
function findById(id, versionId) { return transaction(conn => detailIn(conn, id, versionId), { readOnly: true }) }
async function listIn(conn, { page = 1, pageSize = 20, keyword = '' }) {
  const pagination = normalizePagination({ page, pageSize: Math.min(100, pageSize) })
  const like = `%${keyword}%`
  const [rows] = await conn.query('SELECT * FROM kit_definitions WHERE deleted_at IS NULL AND (code LIKE ? OR name LIKE ?) ORDER BY code,id LIMIT ? OFFSET ?', [like, like, pagination.pageSize, pagination.offset])
  const [[{ total }]] = await conn.query('SELECT COUNT(*) total FROM kit_definitions WHERE deleted_at IS NULL AND (code LIKE ? OR name LIKE ?)', [like, like])
  const versions = await loadVersions(conn, rows.map(r => r.current_version_id))
  return { list: rows.map(r => definitionView(r, versions.get(Number(r.current_version_id)) || null)), pagination: { page: pagination.page, pageSize: pagination.pageSize, total: Number(total) } }
}
function findAll(params) { return transaction(conn => listIn(conn, params), { readOnly: true }) }
async function warehouseIn(conn, id, scope) {
  assertInScope(scope, id, '套件库存预览')
  const [[row]] = await conn.query('SELECT id,name,is_active FROM inventory_warehouses WHERE id=? AND deleted_at IS NULL', [id])
  if (!row || Number(row.is_active) !== 1) throw new AppError('仓库不存在或已停用', 400, 'KIT_WAREHOUSE_UNAVAILABLE')
  return row
}
function disabledReasons(definition) {
  const reasons = []
  if (!definition.isActive || definition.deletedAt) reasons.push({ code: 'KIT_UNAVAILABLE', message: '套件已停用或删除，不能用于新选择' })
  if (!definition.version || !definition.version.components.length) reasons.push({ code: 'KIT_VERSION_INVALID', message: '套件组成版本无效' })
  for (const c of definition.version?.components || []) {
    if (!c.productActive) reasons.push({ code: 'KIT_COMPONENT_UNAVAILABLE', productId: c.productId, message: `组件「${c.productName || c.productId}」不存在、已停用或删除` })
    else if (!c.allowDecimal && !Number.isInteger(c.baseQty)) reasons.push({ code: 'QTY_INTEGER_REQUIRED', productId: c.productId, message: `组件「${c.productName}」当前只允许整数，需维护套件版本` })
  }
  return reasons
}
async function findForFinder(params) {
  return transaction(async conn => {
    await warehouseIn(conn, params.warehouseId, params.scopeWarehouseIds)
    const result = await listIn(conn, params)
    const pairs = result.list.flatMap(k => k.version?.components.map(c => ({ productId: c.productId, warehouseId: params.warehouseId })) || [])
    const stocks = await getStockProjections(conn, pairs)
    result.list = result.list.map(k => {
      const reasons = disabledReasons(k)
      const components = k.version?.components || []
      const standaloneCompleteSetsByCurrentStock = components.length ? Math.min(...components.map(c => {
        const stock = stocks.get(`${c.productId}:${params.warehouseId}`)
        // Quantities have a 0.01 unit: subtract integer units before division, avoiding .30-.20 artifacts.
        const availableUnits = Math.max(0, Math.round((stock?.quantity || 0) * 100) - Math.round((stock?.reserved || 0) * 100))
        return Math.floor(availableUnits / Math.round(c.baseQty * 100))
      })) : 0
      return { ...k, selectable: reasons.length === 0, disabledReasons: reasons, standaloneCompleteSetsByCurrentStock, inventoryBasis: 'current_physical_available', inventoryExplanation: '单个套件的现货参考，多个套件共享组件时须按整单预览；未考虑整容器独占，不保证可拣或交期', readyDate: null }
    })
    return result
  }, { readOnly: true })
}
async function componentsIn(conn, input) {
  if (!Array.isArray(input) || !input.length || input.length > 50) throw new AppError('套件须包含 1 至 50 个组件', 400, 'KIT_COMPONENT_LIMIT')
  const ids = [...new Set(input.map(c => Number(c.productId)))]
  // Lock product policies/A prices for the entire version snapshot; no loop queries.
  const [rows] = await conn.query('SELECT id,name,sale_price_a,allow_decimal_qty,is_active,deleted_at FROM product_items WHERE id IN (?) ORDER BY id FOR SHARE', [ids])
  const products = new Map(rows.map(p => [Number(p.id), p]))
  const snapshot = snapshotComponents(input, products)
  if (rows.some(p => Number(p.is_active) !== 1 || p.deleted_at != null)) throw new AppError('套件组件必须是启用且未删除的真实商品', 400, 'KIT_COMPONENT_UNAVAILABLE')
  return snapshot
}
async function writeVersion(conn, kitId, versionNo, price, components, userId) {
  const [version] = await conn.query('INSERT INTO kit_definition_versions (kit_id,version_no,reference_unit_price,created_by) VALUES (?,?,?,?)', [kitId, versionNo, price, userId])
  const versionId = Number(version.insertId)
  if (!components.length) throw new AppError('套件版本不能没有组件', 400, 'KIT_COMPONENT_LIMIT')
  await conn.query('INSERT INTO kit_definition_components (version_id,product_id,base_qty,reference_price,amount_weight,weight_source,sort_no) VALUES ?', [components.map(c => [versionId, c.productId, c.baseQty, c.referencePrice, c.amountWeight, c.weightSource, c.sortNo])])
  return versionId
}
async function create(input, ctx) {
  const requestKey = requiredKey(ctx.requestKey)
  return transaction(async conn => {
    const state = await beginCreationOperationRequest(conn, { requestKey, action: 'kit.create', userId: ctx.userId, payload: input })
    if (state.replay) return state.responseData
    const price = assertPrice(input.referenceUnitPrice, '每套参考价')
    const components = await componentsIn(conn, input.components)
    const [created] = await conn.query('INSERT INTO kit_definitions (code,name,is_active) VALUES (?,?,?)', [input.code, input.name, input.isActive === false ? 0 : 1])
    const kitId = Number(created.insertId)
    const versionId = await writeVersion(conn, kitId, 1, price, components, ctx.userId)
    await conn.query('UPDATE kit_definitions SET current_version_id=? WHERE id=?', [versionId, kitId])
    const data = await detailIn(conn, kitId)
    await completeOperationRequest(conn, state, { data, message: '创建成功', resourceType: 'kit', resourceId: kitId })
    return data
  })
}
function componentSignature(components) {
  return JSON.stringify(components.map(c => [c.productId, c.baseQty, c.referencePrice, String(c.amountWeight), c.weightSource, c.sortNo]))
}
async function mutate(id, input, ctx, deleting) {
  const requestKey = requiredKey(ctx.requestKey)
  return transaction(async conn => {
    const [[master]] = await conn.query('SELECT * FROM kit_definitions WHERE id=? FOR UPDATE', [id])
    if (!master) throw new AppError('套件不存在', 404, 'KIT_NOT_FOUND')
    const state = await beginResourceOperationRequest(conn, { requestKey, action: deleting ? 'kit.delete' : 'kit.update', userId: ctx.userId, resourceType: 'kit', resourceId: id })
    if (state.replay) return state.responseData
    if (Number(input.revision) !== Number(master.revision)) throw new AppError('套件已被其他操作更新，请保留本次输入并刷新核对', 409, 'KIT_REVISION_CONFLICT')
    if (master.deleted_at) throw new AppError('套件已删除', 409, 'KIT_UNAVAILABLE')
    let versionId = Number(master.current_version_id)
    if (!deleting) {
      const old = (await loadVersions(conn, [versionId])).get(versionId)
      if (!old) throw new AppError('当前套件版本无效', 409, 'KIT_VERSION_INVALID')
      const price = input.referenceUnitPrice === undefined ? old.referenceUnitPrice : assertPrice(input.referenceUnitPrice, '每套参考价')
      const components = input.components === undefined ? old.components : await componentsIn(conn, input.components)
      if (price !== old.referenceUnitPrice || componentSignature(components) !== componentSignature(old.components)) versionId = await writeVersion(conn, id, old.versionNo + 1, price, components, ctx.userId)
    }
    if (deleting) await conn.query('UPDATE kit_definitions SET deleted_at=NOW(),is_active=0,revision=revision+1 WHERE id=? AND revision=?', [id, master.revision])
    else await conn.query('UPDATE kit_definitions SET code=?,name=?,is_active=?,current_version_id=?,revision=revision+1 WHERE id=? AND revision=?', [input.code ?? master.code, input.name ?? master.name, input.isActive === undefined ? master.is_active : Number(input.isActive), versionId, id, master.revision])
    const data = await detailIn(conn, id)
    await completeOperationRequest(conn, state, { data, message: deleting ? '删除成功' : '更新成功', resourceType: 'kit', resourceId: id })
    return data
  })
}
function update(id, input, ctx) { return mutate(id, input, ctx, false) }
function softDelete(id, input, ctx) { return mutate(id, input, ctx, true) }
async function preview(input,ctx) {
  return transaction(conn=>require('../sale/sale.commercial-preview').resolvePreview(conn,{customerId:input.customerId,warehouseId:input.warehouseId,commercialGroups:input.groups,scopeWarehouseIds:ctx.scopeWarehouseIds},[],{lineKeyMax:100}),{readOnly:true})
}
module.exports = { findAll, findById, findForFinder, create, update, softDelete, preview, loadVersions, disabledReasons, definitionView }
