'use strict'
// Creates only synthetic drafts through existing authenticated loopback APIs.
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
async function main() {
  const dir = process.env.FLOWCUBE_DESIGN_AUDIT_PRIVATE_DIR
  if (!dir || !path.isAbsolute(dir) || (fs.statSync(dir).mode & 0o077)) throw Error('private fixture directory required')
  const file = path.join(dir, 'facts.json'), facts = JSON.parse(fs.readFileSync(file))
  const auth = JSON.parse(fs.readFileSync(path.join(dir, 'auth.json'))).state
  if (new URL(facts.api).hostname !== '127.0.0.1' || !facts.customer.name.startsWith('验收合成')) throw Error('owned synthetic loopback fixture required')
  const save = () => fs.writeFileSync(file, JSON.stringify(facts, null, 2), { mode: 0o600 })
  async function api(method, route, body) {
    const r = await fetch(facts.api + '/api' + route, { method, headers: { Authorization: 'Bearer ' + auth.token, 'Content-Type': 'application/json', 'X-Client-Id': 'design-audit-fixtures', 'X-Request-Key': randomUUID() }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const result = await r.json()
    if (!r.ok || !result.success) throw Error(route + ' ' + r.status + ' ' + result.message)
    return result.data
  }
  if (!facts.requisition) { facts.requisition = await api('POST', '/purchase-requisitions', { title: '验收合成多明细请购草稿', warehouseId: facts.warehouse.id, remark: '验收合成长备注。'.repeat(12), items: facts.products.map(product => ({ productId: product.id, quantity: 2, estimatedPrice: 12.3456, remark: '验收合成明细，不提交审批' })) }); save() }
  if (!facts.plan && !facts.planBlocked) { try { facts.plan = await api('POST', '/procurement/plans', { name: '验收合成采购计划草稿', warehouseId: facts.warehouse.id, horizon: 7, window: 30, forecastMethod: 'sma', remark: '验收合成，不转换采购。' }); } catch (e) { if (!e.message.includes('409 当前需求')) throw e; facts.planBlocked = '真实需求已覆盖，409拒绝生成，不为截图绕过需求规则'; } save() }
  if (!facts.saleReturn) { facts.saleReturn = await api('POST', '/returns/sale', { customerId: facts.customer.id, customerName: facts.customer.name, warehouseId: facts.warehouse.id, warehouseName: facts.warehouse.name, remark: '验收合成人工退货草稿；不确认、不收货、不改应收。', items: facts.products.slice(0, 3).map(product => ({ productId: product.id, productCode: product.code, productName: product.name, unit: product.unit, quantity: 1.25, unitPrice: 12.3456 })) }); save() }
  // The isolated migration fixture contains legacy label bodies that fail the
  // current layout contract. Leave them intact; create a separate valid document.
  if (!facts.printTemplate) { facts.printTemplate = await api('POST', '/print-templates', { name: '验收合成单据画布', type: 1, paperSize: 'A4', layout: { elements: [{ id: 'title', type: 'title', fieldKey: 'orderNo', label: '验收合成销售单', x: 10, y: 10, width: 180, height: 12, fontSize: 18, fontWeight: 'bold', textAlign: 'center', border: false }], canvasWidthMm: 210, canvasHeightMm: 297 } }); save() }
  const targets = [
    ['/sale/:id', '/sale/' + facts.sales[0].id], ['/purchase/:id', '/purchase/' + facts.purchase.id],
    ['/returns/purchase/:id', '/returns/purchase/' + facts.returned.id], ['/returns/sale/:id', '/returns/sale/' + facts.saleReturn.id],
    ['/inbound-tasks/:id', '/inbound-tasks/' + facts.pendingInbound.taskId], ['/products/:id', '/products/' + facts.products[0].id],
    ['/payments/ledger/customer/:id', '/payments/ledger/customer/' + facts.customer.id], ['/payments/ledger/supplier/:id', '/payments/ledger/supplier/' + facts.supplier.id],
    ['/purchase-requisitions/:id', '/purchase-requisitions/' + facts.requisition.id], ...(facts.plan ? [['/procurement/:id', '/procurement/' + facts.plan.id]] : []),
    ['/settings/print-templates/:id', '/settings/print-templates/' + facts.printTemplate.id],
  ].map(([route, actualPath]) => ({ route, path: actualPath, boundary: 'after-only synthetic fixture; resource exists; no confirmation/write-flow acceptance' }))
  fs.writeFileSync(path.resolve(__dirname, '../../docs/design-audit-2026-10-08/dynamic-fixtures.json'), JSON.stringify(targets, null, 2) + '\n')
  console.log(JSON.stringify({ draftResources: [facts.requisition.id, facts.plan?.id, facts.saleReturn.id], dynamicTargets: targets.length }))
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
