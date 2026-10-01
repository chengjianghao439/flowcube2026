'use strict'
// Authoritative commercial resolution on the caller's connection, before any stock mutation.
const AppError = require('../../utils/AppError')
const { assertInScope } = require('../../utils/warehouseScope')
const { assertQtyPrecision, assertQtyScale } = require('../../utils/qtyPrecision')
const { foldEntryItemsBatch, round8, roundQty } = require('../../utils/unitConversion')
const { loadVersions, disabledReasons, definitionView } = require('../kits/kits.service')
const { assertPrice, assertPositiveQty, amountFromPriceQuantity, allocateCents } = require('../kits/kits.composition')
const { projectCommercialCumulative } = require('./sale.commercial-money.math')
function identity(input) {
  const { quantity, ...rest } = input
  return JSON.stringify(Object.keys(rest).sort().map(k => [k, rest[k]]))
}
function snapshot(group) {
  return { kind: group.kind, originalQty: group.originalQty, grossAmount: group.grossAmount, unitPrice: group.unitPrice, components: group.components.map(c => ({ id: c.id ?? c.productId, sortNo: c.sortNo, allocatedAmount: c.allocatedAmount })) }
}
function materialize(groups, products, warehouses) {
  const physical = new Map()
  let totalCents = 0
  for (const g of groups) {
    const money = projectCommercialCumulative(snapshot(g), g.targetQty)
    totalCents += money.grossCents
    for (const [n, c] of g.components.entries()) {
      const qty = g.kind === 'kit' ? roundQty(c.baseQty * g.targetQty) : g.targetQty
      assertQtyScale(c.baseQty * g.targetQty, '套内配件数量')
      if (qty > 9999999999.99) throw new AppError('套内配件数量超出允许范围', 400, 'QTY_INVALID')
      const key = `${c.productId}:${g.warehouseId}`
      const old = physical.get(key) || { productId: c.productId, warehouseId: g.warehouseId, quantity: 0, amountCents: 0 }
      old.quantity = roundQty(old.quantity + qty)
      old.amountCents += money.components[n].amountCents
      physical.set(key, old)
    }
  }
  if (physical.size > 200) throw new AppError('销售单展开后的商品明细不能超过 200 条', 400, 'KIT_PHYSICAL_LIMIT')
  if (totalCents > 999999999999) throw new AppError('总金额超出存储范围', 400, 'KIT_AMOUNT_OVERFLOW')
  const items = [...physical.values()].sort((a,b) => a.productId-b.productId || a.warehouseId-b.warehouseId).map(p => {
    const product = products.get(p.productId), warehouse = warehouses.get(p.warehouseId)
    const unitPrice = p.quantity ? round8(p.amountCents / 100 / p.quantity) : 0
    if (unitPrice >= 10000000000 || p.quantity > 9999999999.99) throw new AppError('商品单价或数量超出允许范围', 400, 'KIT_PHYSICAL_OVERFLOW')
    return { ...p, productCode: product.code, productName: product.name, unit: product.unit, articleNumber: product.article_number, spec: product.spec, color: product.color, warehouseName: warehouse.name, unitPrice, amount: p.amountCents / 100, entryUnit: product.unit, entryQty: p.quantity, conversionRate: 1 }
  })
  return { groups, items, total: totalCents / 100 }
}
async function resolve(conn, { customerId, warehouseId, commercialGroups, scopeWarehouseIds = null }, saved = [], {readOnly=false,formal=true,lineKeyMax=80} = {}) {
  const lockSql=readOnly?'':' FOR SHARE'
  if (!Array.isArray(commercialGroups) || !commercialGroups.length || commercialGroups.length > 200) throw new AppError('销售单须包含 1 至 200 条成交明细', 400, 'KIT_GROUP_LIMIT')
  if (new Set(commercialGroups.map(g => g.lineKey)).size !== commercialGroups.length) throw new AppError('成交明细重复，请保留输入并重新核对', 400, 'KIT_LINE_KEY_DUPLICATE')
  for (const g of commercialGroups) if (!g.lineKey || String(g.lineKey).length > lineKeyMax || !['kit','ordinary'].includes(g.kind)) throw new AppError('成交明细无法识别，请保留输入并更新客户端', 400, 'SALE_COMMERCIAL_INVALID')
  const oldByKey = new Map(saved.map(g => [g.lineKey, g]))
  const keep = new Map(), fresh = []
  for (const raw of commercialGroups) {
    const input = { ...raw, warehouseId: Number(raw.warehouseId || warehouseId) }
    assertInScope(scopeWarehouseIds, input.warehouseId, '套单成交明细')
    const qty = assertPositiveQty(input.quantity)
    if (input.kind === 'kit' && !Number.isSafeInteger(qty)) throw new AppError('套数须为正整数', 400, 'KIT_QUANTITY_INTEGER')
    const old = oldByKey.get(input.lineKey)
    if (old && (input.kind !== 'ordinary' || input.priceSource === 'manual' || Number(old.metadata.priceCustomerId)===Number(customerId)) && identity(input) === identity(old.metadata.input) && (input.kind==='ordinary'?roundQty(qty*Number(old.metadata.entry.conversionRate)):qty)<=old.targetQty) {
      const targetQty = old.kind === 'ordinary' ? roundQty(qty * Number(old.metadata.entry.conversionRate)) : qty
      keep.set(input.lineKey, { ...old, targetQty, retained: true })
    } else fresh.push(input)
  }
  const [[customer]] = await conn.query('SELECT id,name,is_active,price_level,price_list_id FROM sale_customers WHERE id=? AND deleted_at IS NULL'+lockSql, [customerId])
  if (!customer || Number(customer.is_active) !== 1) throw new AppError('客户不存在或已停用', 400, 'KIT_CUSTOMER_UNAVAILABLE')
  const whIds = [...new Set([Number(warehouseId), ...commercialGroups.map(g => Number(g.warehouseId || warehouseId))])]
  const [whRows] = await conn.query('SELECT id,name,is_active,deleted_at FROM inventory_warehouses WHERE id IN (?) ORDER BY id'+lockSql, [whIds])
  const warehouses = new Map(whRows.map(w => [Number(w.id), w]))
  for (const id of whIds) {
    assertInScope(scopeWarehouseIds, id, '销售单')
    const w = warehouses.get(id)
    if (!w || !Number(w.is_active) || w.deleted_at) throw new AppError('仓库不存在或已停用', 400, 'KIT_WAREHOUSE_UNAVAILABLE')
  }
  const versionIds = [...new Set(fresh.filter(g => g.kind === 'kit').map(g => Number(g.kitVersionId)))]
  const versions = await loadVersions(conn, versionIds)
  const masterIds = [...new Set([...versions.values()].map(v => v.kitId))]
  const [masterRows] = masterIds.length ? await conn.query('SELECT * FROM kit_definitions WHERE id IN (?) ORDER BY id'+lockSql, [masterIds]) : [[]]
  const masters = new Map(masterRows.map(m => [Number(m.id), m]))
  const productIds = [...new Set([...fresh.flatMap(g => g.kind === 'kit' ? (versions.get(Number(g.kitVersionId))?.components.map(c => c.productId) || []) : [Number(g.productId)]), ...saved.filter(g => keep.has(g.lineKey)).flatMap(g => g.components.map(c => c.productId))])]
  const [productRows] = productIds.length ? await conn.query('SELECT id,code,name,unit,article_number,spec,color,allow_decimal_qty,is_active,deleted_at,sale_price_a,sale_price_b,sale_price_c,sale_price_d FROM product_items WHERE id IN (?) ORDER BY id'+lockSql, [productIds]) : [[]]
  const products = new Map(productRows.map(p => [Number(p.id), p]))
  for (const id of productIds) { const p = products.get(id); if (!p || !Number(p.is_active) || p.deleted_at) throw new AppError('组件商品不存在或已停用', 400, 'KIT_COMPONENT_UNAVAILABLE') }
  const ordinaryIds = fresh.filter(g => g.kind === 'ordinary').map(g => Number(g.productId)), listPrices = new Map()
  if (customer.price_list_id && ordinaryIds.length) {
    const [prices] = await conn.query('SELECT product_id,sale_price FROM price_list_items WHERE list_id=? AND product_id IN (?)', [customer.price_list_id, ordinaryIds])
    for (const p of prices) listPrices.set(Number(p.product_id), Number(p.sale_price))
  }
  const prepared = fresh.map(g => {
    if (g.kind === 'kit') {
      const v = versions.get(Number(g.kitVersionId)), m = v && masters.get(v.kitId)
      if (!v || !m) throw new AppError('套件版本不存在', 404, 'KIT_VERSION_NOT_FOUND')
      if (Number(m.current_version_id) !== v.id) throw new AppError('套件组成已更新，请保留输入并重新核对版本', 409, 'KIT_VERSION_CHANGED')
      const reasons = disabledReasons(definitionView(m, v)); if (reasons.length) throw new AppError(reasons[0].message, 400, reasons[0].code)
      const price = g.priceSource === 'manual' ? assertPrice(g.unitPrice) : v.referenceUnitPrice
      if (formal && !(price > 0)) throw new AppError('正式销售成交价必须大于零', 400, 'SALE_PRICE_REQUIRED')
      return { ...g, price, version: v, master: m }
    }
    const p = products.get(Number(g.productId))
    const reference = listPrices.get(Number(g.productId)) ?? Number(({ A:p.sale_price_a,B:p.sale_price_b,C:p.sale_price_c,D:p.sale_price_d }[String(customer.price_level || 'A').toUpperCase()] ?? p.sale_price_a) || 0)
    const price = g.priceSource === 'manual' ? assertPrice(g.unitPrice) : assertPrice(reference)
    if (formal && !(price > 0)) throw new AppError('正式销售成交价必须大于零', 400, 'SALE_PRICE_REQUIRED')
    return { ...g, price,product:p,referencePrice:reference,resolvedPriceSource:listPrices.has(Number(g.productId))?'price_list':'price_level',resolvedPriceLevel:customer.price_level||'A',priceListId:customer.price_list_id||null }
  })
  const ordinary = prepared.filter(g => g.kind === 'ordinary')
  const folded = await foldEntryItemsBatch(conn, ordinary.map(g => ({ ...g, unit: g.product.unit, unitPrice: g.price, priceIsBase:g.priceSource!=='manual' })))
  const foldedByKey = new Map(folded.map(g => [g.lineKey, g]))
  const freshByKey = new Map(prepared.map(g => {
    const entry = foldedByKey.get(g.lineKey)
    const gross = entry ? entry.amount : amountFromPriceQuantity(g.price,g.quantity)
    if(gross>9999999999.99)throw new AppError('成交金额超出允许范围',400,'KIT_AMOUNT_OVERFLOW')
    const components = g.kind === 'kit' ? g.version.components : [{ productId: Number(g.productId), baseQty: 1, sortNo: 0, referencePrice: g.referencePrice, amountWeight: '1.000000' }]
    const amounts = g.kind === 'kit' ? allocateCents(gross, components) : [gross]
    const group = { lineKey: g.lineKey, kind: g.kind, warehouseId: g.warehouseId, kitVersionId: g.kitVersionId || null, kitCode: g.master?.code || null, kitName: g.master?.name || null, originalQty: entry?.quantity ?? g.quantity, targetQty: entry?.quantity ?? g.quantity, unitPrice: entry?.unitPrice ?? g.price, priceSource: g.priceSource || (g.kind === 'kit' ? 'kit_default' : 'default'), grossAmount: gross, metadata: { quote:g.kind==='ordinary'?{referenceUnitPrice:g.referencePrice,resolvedPriceSource:g.resolvedPriceSource,resolvedPriceLevel:g.resolvedPriceLevel,priceListId:g.priceListId}:null,referenceSnapshotAt:g.version?.referenceSnapshotAt ?? null,versionCreatedAt:g.version?.createdAt ?? null,referenceBasisExplanation:g.version?.referenceBasisExplanation ?? null,priceCustomerId:Number(customerId), input: fresh.find(f => f.lineKey === g.lineKey), entry: entry ? { entryUnit: entry.entryUnit, entryQty: entry.entryQty, conversionRate: entry.conversionRate, entryUnitPrice: entry.entryUnitPrice } : null }, components: components.map((c,n) => { const p = products.get(c.productId); return { ...c, requiredQty: g.kind === 'kit' ? roundQty(c.baseQty*g.quantity) : entry.quantity, allocatedAmount: amounts[n], productCode:p.code,productName:p.name,unit:p.unit,articleNumber:p.article_number,spec:p.spec,color:p.color } }) }
    return [g.lineKey, group]
  }))
  const result = materialize(commercialGroups.map(g => keep.get(g.lineKey) || freshByKey.get(g.lineKey)), products, warehouses)
  await assertQtyPrecision(conn, result.items.map(i => ({ productId:i.productId,qty:i.quantity,label:'套内配件需求数量' })))
  return { ...result, customerName: customer.name, warehouseName: warehouses.get(Number(warehouseId)).name }
}
module.exports = { resolve, snapshot, materialize }
