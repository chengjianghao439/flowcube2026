'use strict'
// Fill remaining legal read-only design scenarios using synthetic API drafts.
// No confirmation, picking, transfer execution, funds, or carrier requests.
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
async function main() {
  const dir = process.env.FLOWCUBE_DESIGN_AUDIT_PRIVATE_DIR
  if (!dir || !path.isAbsolute(dir) || (fs.statSync(dir).mode & 0o077)) throw Error('private fixture directory required')
  const file = path.join(dir, 'facts.json'), facts = JSON.parse(fs.readFileSync(file))
  const auth = JSON.parse(fs.readFileSync(path.join(dir, 'auth.json'))).state
  if (new URL(facts.api).hostname !== '127.0.0.1' || !facts.customer.name.startsWith('验收合成')) throw Error('owned synthetic loopback required')
  const save = () => fs.writeFileSync(file, JSON.stringify(facts, null, 2), { mode: 0o600 })
  async function api(method, route, body) {
    const response = await fetch(facts.api + '/api' + route, { method, headers: { Authorization: 'Bearer ' + auth.token, 'Content-Type': 'application/json', 'X-Client-Id': 'design-audit-fixtures', 'X-Request-Key': randomUUID() }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const result = await response.json()
    if (!response.ok || !result.success) throw Error(route + ' ' + response.status + ' ' + result.message)
    return result.data
  }
  if (!facts.targetWarehouse && !facts.transferBlocked) { facts.targetWarehouse = await api('POST', '/warehouses', { name: '验收合成调入仓', type: 1, remark: '仅本批隔离实例，调拨草稿，不执行库存。' }); save() }
  try { if (facts.targetWarehouse) facts.targetWarehouse = await api('GET', '/warehouses/' + facts.targetWarehouse.id) }
  catch (error) {
    if (!error.message.includes('403')) throw error
    // Fixture users have an intentional warehouse scope. Preserve it and use
    // an existing admitted synthetic warehouse rather than widening access.
    const warehouses = await api('GET', '/warehouses/active')
    const target = warehouses.find(w => w.id !== facts.warehouse.id && w.name.startsWith('验收合成'))
    facts.unusedTargetWarehouseId = facts.targetWarehouse.id
    facts.targetWarehouse = target || null
    if (!target) facts.transferBlocked = '本批账号仅有原仓库范围；新仓真实403，不扩大权限以制造调拨详情'
  }
  save()
  if (!facts.transfer && facts.targetWarehouse) {
    const p = await api('GET', '/products/' + facts.products[0].id)
    facts.transfer = await api('POST', '/transfer', { fromWarehouseId: facts.warehouse.id, fromWarehouseName: facts.warehouse.name, toWarehouseId: facts.targetWarehouse.id, toWarehouseName: facts.targetWarehouse.name, remark: '验收合成调拨草稿长备注。'.repeat(10), items: [{ productId: p.id, productCode: p.code, productName: p.name, unit: p.unit, articleNumber: p.articleNumber, spec: p.spec, color: p.color, quantity: 1.25, remark: '不确认，不调出，不调入。' }] }); save()
  }
  if (!facts.policyProduct) {
    const p = await api('GET', '/products/' + facts.products[0].id)
    if (!p.categoryId && !facts.policyCategory) { facts.policyCategory = await api('POST', '/categories', { name: '验收合成补货分类' }); save() }
    facts.policyProduct = await api('POST', '/products', { name: '验收合成补货策略商品', categoryId: p.categoryId || facts.policyCategory.id, supplierId: facts.supplier.id, unit: '个', spec: '验收合成型号-PLAN', color: '银白色', articleNumber: '验收合成供应商型号-PLAN', costPrice: 12.3456, salePriceA: 20, safetyStock: 5, reorderPoint: 5, allowDecimalQty: true }); save()
  }
  if (!facts.plan) { facts.plan = await api('POST', '/procurement/plans', { name: '验收合成安全库存采购计划', warehouseId: facts.warehouse.id, horizon: 7, window: 30, forecastMethod: 'sma', remark: '真实合成主档安全库存产生合法未覆盖需求；不转换采购。' }); facts.planBlocked = null; save() }
  const destination = path.resolve(__dirname, '../../docs/design-audit-2026-10-08/dynamic-fixtures.json')
  const targets = JSON.parse(fs.readFileSync(destination))
  for (const [route, id] of [['/transfer/:id', facts.transfer?.id], ['/procurement/:id', facts.plan.id]]) {
    if (!id) continue
    if (!targets.some(item => item.route === route)) targets.push({ route, path: route.replace(':id', id), boundary: 'after-only legal synthetic draft; no execution/write-flow acceptance' })
  }
  fs.writeFileSync(destination, JSON.stringify(targets, null, 2) + '\n')
  console.log(JSON.stringify({ transferId: facts.transfer?.id, transferBlocked: facts.transferBlocked, planId: facts.plan.id, dynamicTargets: targets.length }))
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
