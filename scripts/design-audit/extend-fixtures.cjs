'use strict'
// Only synthetic fixture facts from the owned loopback runtime; credentials never print.
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
async function main() {
  const dir = process.env.FLOWCUBE_DESIGN_AUDIT_PRIVATE_DIR
  if (!dir || !path.isAbsolute(dir) || (fs.statSync(dir).mode & 0o077)) throw Error('private fixture directory required')
  const facts = JSON.parse(fs.readFileSync(path.join(dir, 'facts.json')))
  const auth = JSON.parse(fs.readFileSync(path.join(dir, 'auth.json'))).state
  if (new URL(facts.api).hostname !== '127.0.0.1' || !facts.customer.name.startsWith('验收合成')) throw Error('owned synthetic loopback fixture required')
  if (facts.pendingInbound) return
  async function api(method, route, body) {
    const r = await fetch(facts.api + '/api' + route, { method, headers: { Authorization: 'Bearer ' + auth.token, 'Content-Type': 'application/json', 'X-Client-Id': 'design-audit-fixtures', 'X-Request-Key': randomUUID() }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const result = await r.json()
    if (!r.ok || !result.success) throw Error(route + ' ' + r.status + ' ' + result.message)
    return result.data
  }
  const product = facts.products[1]
  const po = await api('POST', '/purchase', { supplierId: facts.supplier.id, supplierName: facts.supplier.name, warehouseId: facts.warehouse.id, warehouseName: facts.warehouse.name, remark: '验收合成：待收货详情', items: [{ productId: product.id, productCode: product.code, productName: product.name, unit: product.unit, quantity: 2, unitPrice: 12.3456 }] })
  await api('POST', `/purchase/${po.id}/confirm`, {})
  const inbound = await api('POST', '/inbound-tasks', { poId: po.id })
  await api('POST', `/inbound-tasks/${inbound.taskId}/submit`, {})
  facts.pendingInbound = { ...inbound, purchaseId: po.id, quantity: 2, product }
  fs.writeFileSync(path.join(dir, 'facts.json'), JSON.stringify(facts, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ pendingInbound: facts.pendingInbound }))
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
