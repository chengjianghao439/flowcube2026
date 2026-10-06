const AppError = require('../../utils/AppError')

function plasticAction(action) {
  const match = /^plastic_box\.(fill|repack)(?:\.([1-9]\d*))?$/.exec(typeof action === 'string' ? action : '')
  return match ? { kind: match[1], id: match[2] == null ? null : Number(match[2]) } : null
}
const isPlasticBoxAction = action => Boolean(plasticAction(action))
const validId = value => Number.isSafeInteger(value) && value > 0
const validBarcode = value => typeof value === 'string' && Boolean(value.trim()) && [...value].length <= 64
const invalid = () => { throw new AppError('塑料盒原操作结果身份不完整或与原流水不一致，请保留原请求并人工核对', 409, 'PLASTIC_BOX_RECEIPT_INVALID') }

/** 本人查询核原操作流水仓；之后调拨、清空或软删不改写历史授权依据。 */
async function assertPlasticBoxReceipt(conn, receipt, scopeWarehouseIds, context = {}) {
  const matched = plasticAction(context.matchedAction), requested = plasticAction(context.requestedAction)
  if (!matched && !requested) return
  if (context.isPda && (context.pdaWarehouseId == null || !validId(Number(context.pdaWarehouseId)))) {
    throw new AppError('设备尚未绑定有效仓库，无法核对塑料盒原操作', 403, 'PDA_WAREHOUSE_REQUIRED')
  }
  if (receipt.status !== 'success') return
  const boxId = receipt.resourceId, data = receipt.data
  if (!matched || receipt.resourceType !== 'inventory_container' || !validId(boxId) || !data
      || (matched.id != null && matched.id !== boxId)
      || (requested && (requested.kind !== matched.kind || requested.id != null && requested.id !== boxId))) invalid()

  const fill = matched.kind === 'fill'
  let sourceId, identities
  if (fill) {
    if (!validId(data.sourceContainerId) || data.sourceContainerId === boxId || !validBarcode(data.sourceBarcode)
        || data.targetContainerId !== boxId || data.newContainerId !== boxId
        || !/^B\d+$/.test(data.newBarcode || '') || data.targetBarcode !== data.newBarcode || data.newContainerKind !== 'plastic_box'
        || !validId(data.productId) || !validId(data.warehouseId) || data.sourceRemainingAfter !== 0
        || !Number.isFinite(data.targetQtyAfter) || data.targetQtyAfter <= 0) invalid()
    sourceId = data.sourceContainerId
    identities = [{ containerId: sourceId, barcode: data.sourceBarcode }, { containerId: boxId, barcode: data.newBarcode }]
  } else {
    if (data.boxId !== boxId || !Number.isFinite(data.boxRemainingAfter) || data.boxRemainingAfter < 0
        || !Array.isArray(data.created) || !data.created.length || data.created.length > 100) invalid()
    identities = data.created
    if (identities.some(item => !validId(item?.containerId) || item.containerId === boxId || !/^I\d+$/.test(item.barcode || '')
        || !Number.isFinite(item.qty) || item.qty <= 0)
        || new Set(identities.map(item => item.containerId)).size !== identities.length
        || new Set(identities.map(item => item.barcode)).size !== identities.length) invalid()
    sourceId = boxId
  }

  // 两侧流水必须同原来源、商品、仓和数量；不从响应warehouse或当前容器warehouse单独推断。
  // 目标ID有界批量读取；独立GET不获取库存锁，不读取当前余量或状态。
  const [rows] = await conn.query(
    `SELECT DISTINCT l.container_id,l.product_id,l.warehouse_id,l.quantity,
            c.barcode,c.product_id AS current_product_id,c.container_type,c.initial_qty,
            c.source_type,c.source_ref_type,c.source_ref_id,
            src.barcode AS source_barcode,src.product_id AS source_product_id,src.container_type AS source_container_type
       FROM inventory_logs l
       JOIN inventory_containers c ON c.id=l.container_id
       JOIN inventory_containers src ON src.id=?
       JOIN inventory_logs source_log
         ON source_log.container_id=src.id AND source_log.ref_type='container_split' AND source_log.ref_id=src.id
        AND source_log.log_source_type='container_split' AND source_log.log_source_ref_id=src.id
        AND source_log.product_id=l.product_id AND source_log.warehouse_id=l.warehouse_id AND source_log.quantity=l.quantity
      WHERE l.ref_type='container_split' AND l.ref_id=? AND l.log_source_type='container_split'
        AND l.log_source_ref_id=? AND l.container_id IN (?)`,
    [sourceId, sourceId, sourceId, identities.map(item => item.containerId)],
  )
  const warehouses = new Set(), products = new Set()
  for (const item of identities) {
    const found = rows.filter(row => Number(row.container_id) === item.containerId && row.barcode === item.barcode
      && validId(Number(row.product_id)) && validId(Number(row.warehouse_id))
      && Number(row.current_product_id) === Number(row.product_id) && Number(row.source_product_id) === Number(row.product_id)
      && Number(row.source_container_type) === (fill ? 1 : 2)
      && (fill ? row.source_barcode === data.sourceBarcode && Number(row.product_id) === data.productId && Number(row.warehouse_id) === data.warehouseId
          && Number(row.container_type) === (item.containerId === boxId ? 2 : 1)
        : /^B\d+$/.test(row.source_barcode || '') && Number(row.container_type) === 1 && Number(row.quantity) === item.qty
          && Number(row.initial_qty) === item.qty && row.source_type === 'container_split'
          && row.source_ref_type === 'plastic_box_repack' && Number(row.source_ref_id) === boxId))
    if (!found.length || new Set(found.map(row => `${row.product_id}:${row.warehouse_id}`)).size !== 1) invalid()
    warehouses.add(Number(found[0].warehouse_id)); products.add(Number(found[0].product_id))
  }
  if (warehouses.size !== 1 || products.size !== 1) invalid()
  const warehouseId = [...warehouses][0]
  const { assertInScope } = require('../../utils/warehouseScope')
  assertInScope(scopeWarehouseIds, warehouseId, '原塑料盒操作仓库')
  if (context.pdaWarehouseId != null && Number(context.pdaWarehouseId) !== warehouseId) {
    throw new AppError('原塑料盒操作不属于当前PDA绑定仓库', 403, 'PDA_WAREHOUSE_MISMATCH')
  }
}

module.exports = { isPlasticBoxAction, assertPlasticBoxReceipt }
